import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import type { GPUInfo, SystemInfo } from '../types.js';

const execAsync = promisify(exec);

/**
 * Parse throttle reasons from `nvidia-smi -q` output for a given GPU.
 * Returns an array of active throttle reason strings.
 */
export function parseThrottleReasons(
  smiOutput: string,
  gpuIndex: number
): string[] {
  const reasons: string[] = [];
  const gpuBlocks = smiOutput.split(/(?=GPU \d+\n)/);
  const block = gpuBlocks.find(b => b.startsWith(`GPU ${gpuIndex}\n`));
  if (!block) return reasons;

  const throttleSection = block.split(/Clocks Throttle Reasons/)[1];
  if (!throttleSection) return reasons;

  // Stop at the next major section (indented key-value pairs end at next section header)
  const lines = throttleSection.split('\n').slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    // Lines like:  "            Idle                 : Not Active" or "            Sw Power Cap         : Active"
    const match = line.match(/^\s*(.+?)\s+:\s*(Active|Not Active)\s*$/);
    if (!match) break; // left the throttle section
    const [, reason, status] = match;
    if (status === 'Active') {
      reasons.push(reason.trim());
    }
  }
  return reasons;
}

/**
 * Query nvidia-smi for current GPU stats, including throttle reasons
 * from the full nvidia-smi -q output. Throws if nvidia-smi fails.
 */
export async function getGPUSnapshot(): Promise<GPUInfo[]> {
  const query = [
    'index',
    'name',
    'temperature.gpu',
    'power.draw',
    'power.limit',
    'clocks.sm',
    'memory.used',
    'memory.total',
    'utilization.gpu',
    'utilization.memory',
    'ecc.errors.uncorrected.aggregate.total',
  ].join(',');

  const { stdout: csvOut } = await execAsync(
    `nvidia-smi --query-gpu=${query} --format=csv,noheader,nounits`,
    { timeout: 5000 }
  );

  // Also grab full -q output for throttle reasons (best-effort)
  let smiFull = '';
  try {
    const { stdout } = await execAsync('nvidia-smi -q', { timeout: 5000 });
    smiFull = stdout;
  } catch {
    // Throttle reasons are best-effort; proceed without them
  }

  return csvOut.trim().split('\n').map(line => {
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 10) return null; // validate column count (L5)
    const idx = parseInt(parts[0], 10);
    return {
      index: idx,
      name: parts[1],
      temperature: parseFloat(parts[2]),
      powerDraw: parseFloat(parts[3]),
      powerLimit: parseFloat(parts[4]),
      smClock: parseFloat(parts[5]),
      memoryUsed: parseFloat(parts[6]),
      memoryTotal: parseFloat(parts[7]),
      utilization: parseFloat(parts[8]),
      eccErrors: parseFloat(parts[9]),
      throttleReasons: smiFull ? parseThrottleReasons(smiFull, idx) : [],
    };
  }).filter(Boolean) as GPUInfo[];
}

/**
 * Detect processes that have an open handle on /dev/nvidia* (display processes).
 * Returns an array of { gpu, pid, name } for each detected process.
 */
export async function detectDisplayProcesses(): Promise<
  Array<{ gpu: number; pid: number; name: string }>
> {
  const processes: Array<{ gpu: number; pid: number; name: string }> = [];

  // Dynamically detect GPU count instead of hardcoding (H13)
  let gpuCount = 2;
  try {
    const { stdout: gpuList } = await execAsync('nvidia-smi -L', { timeout: 3000 });
    const detected = (gpuList.match(/GPU \d+:/g) ?? []).length;
    if (detected > 0) gpuCount = detected;
  } catch { /* fallback to 2 */ }

  for (let i = 0; i < gpuCount; i++) {
    let stdout: string;
    try {
      const result = await execAsync(
        `fuser /dev/nvidia${i} 2>/dev/null || true`,
        { timeout: 3000 }
      );
      stdout = result.stdout;
    } catch {
      continue;
    }

    // fuser outputs space-separated PIDs (one per line or all on one line)
    const pids = stdout
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(s => parseInt(s, 10))
      .filter(n => !isNaN(n));

    for (const pid of pids) {
      let name = 'unknown';
      try {
        const { stdout: comm } = await execAsync(
          `cat /proc/${pid}/comm 2>/dev/null || true`,
          { timeout: 2000 }
        );
        name = comm.trim() || 'unknown';
      } catch {
        // fallback to 'unknown'
      }
      processes.push({ gpu: i, pid, name });
    }
  }

  return processes;
}

/**
 * Stream GPU data to a callback every `intervalMs` milliseconds.
 * Returns a stop function.
 */
export function startGPUStream(
  callback: (data: GPUInfo[]) => void,
  intervalMs: number = 2000
): () => void {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const data = await getGPUSnapshot();
      try { callback(data); } catch (cbErr) {
        console.error('GPU stream callback error:', cbErr);
      }
    } catch (err) {
      console.error('GPU monitor error:', err);
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };

  tick();

  return () => {
    stopped = true;
  };
}

/**
 * Get a snapshot of system CPU and memory stats.
 * CPU usage is sampled over a short interval using os.cpus().
 * CPU temperature is read from /sys/class/thermal/thermal_zone0/temp if available.
 */
export async function getSystemSnapshot(): Promise<SystemInfo> {
  // CPU usage: sample os.cpus() twice with a short delay to compute delta
  const cpus1 = os.cpus();
  await new Promise(resolve => setTimeout(resolve, 200));
  const cpus2 = os.cpus();

  let totalIdle = 0;
  let totalDelta = 0;
  for (let i = 0; i < cpus2.length; i++) {
    const idle1 = cpus1[i].times.idle;
    const idle2 = cpus2[i].times.idle;
    const total1 =
      cpus1[i].times.user + cpus1[i].times.nice + cpus1[i].times.sys +
      cpus1[i].times.irq + cpus1[i].times.idle;
    const total2 =
      cpus2[i].times.user + cpus2[i].times.nice + cpus2[i].times.sys +
      cpus2[i].times.irq + cpus2[i].times.idle;
    totalIdle += idle2 - idle1;
    totalDelta += total2 - total1;
  }
  const cpuUsage = totalDelta > 0
    ? Math.round(((totalDelta - totalIdle) / totalDelta) * 100 * 10) / 10
    : 0;

  // CPU temperature: try Linux thermal zone
  let cpuTemp: number | null = null;
  try {
    const raw = await fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf-8');
    cpuTemp = Math.round(parseInt(raw.trim(), 10) / 100) / 10; // millidegrees to degrees
  } catch {
    // not available on this system
  }

  // Memory
  const totalMem = os.totalmem() / (1024 * 1024);
  const freeMem = os.freemem() / (1024 * 1024);
  const usedMem = totalMem - freeMem;

  // Swap: use /proc/meminfo on Linux for accurate swap data
  let swapTotal = 0;
  let swapUsed = 0;
  try {
    const meminfo = await fs.readFile('/proc/meminfo', 'utf-8');
    const swapTotalMatch = meminfo.match(/SwapTotal:\s+(\d+)\s+kB/);
    const swapFreeMatch = meminfo.match(/SwapFree:\s+(\d+)\s+kB/);
    if (swapTotalMatch) swapTotal = Math.round(parseInt(swapTotalMatch[1], 10) / 1024);
    if (swapFreeMatch) {
      const swapFree = Math.round(parseInt(swapFreeMatch[1], 10) / 1024);
      swapUsed = swapTotal - swapFree;
    }
  } catch {
    // fallback to os-level swap info
    swapTotal = Math.round(os.totalmem() / (1024 * 1024) * 0.1); // rough estimate
  }

  return {
    cpuUsage,
    cpuTemp,
    ramTotal: Math.round(totalMem),
    ramUsed: Math.round(usedMem),
    ramUsage: Math.round((usedMem / totalMem) * 100 * 10) / 10,
    swapTotal,
    swapUsed,
    swapUsage: swapTotal > 0 ? Math.round((swapUsed / swapTotal) * 100 * 10) / 10 : 0,
  };
}
