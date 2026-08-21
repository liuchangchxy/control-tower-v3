import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { GPUInfo } from '../types.js';

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
  });
}

/**
 * Detect processes that have an open handle on /dev/nvidia* (display processes).
 * Returns an array of { gpu, pid, name } for each detected process.
 */
export async function detectDisplayProcesses(): Promise<
  Array<{ gpu: number; pid: number; name: string }>
> {
  const processes: Array<{ gpu: number; pid: number; name: string }> = [];
  const gpuCount = 2; // detect up to 2 GPUs

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
      callback(data);
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
