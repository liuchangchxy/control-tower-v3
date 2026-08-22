import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { VLLMProcess, ProfileConfig, ProgressEvent } from '../types.js';
import { loadState, saveState, clearState } from './state.js';
import { parseLine, interpolateProgress, isErrorLine, extractProgressPercent, type LogStage } from './logParser.js';
import { analyzeError } from './errorAnalyzer.js';
import { startMetricsScraping, stopMetricsScraping } from './vllmMetrics.js';

const execAsync = promisify(exec);

const HOME = process.env.CONTROL_TOWER_HOME || process.cwd();
const LOG_DIR = path.join(HOME, 'run-logs');
const SAFE_NAME_RE = /[^a-zA-Z0-9_-]/g;
const MAX_LOG_SIZE = 50 * 1024 * 1024; // 50MB per log file
const MAX_ROTATED_LOGS = 3; // keep most recent 3 rotated files

// ── Concurrency lock (H2) ──────────────────────────────────────────────────

let busy = false;
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('Operation already in progress');
  busy = true;
  try { return await fn(); } finally { busy = false; }
}

// ── State ───────────────────────────────────────────────────────────────────

let processState: VLLMProcess = {
  pid: null,
  profile: null,
  profilePath: null,
  status: 'stopped',
  startedAt: null,
  uptime: 0,
  healthDetail: '',
  progress: 0,
  logFile: null,
  error: null,
  errorDiagnosis: null,
  servedName: null,
  port: 8000,
};

const emitter = new EventEmitter();
let logTailer: { stop: () => void } | null = null;
let stageEnteredAt: number = 0;
let lastStage: LogStage | null = null;
let recoveryPollInterval: ReturnType<typeof setInterval> | null = null;
const recentLines: string[] = [];
const MAX_RECENT_LINES = 50;

export function getStatus(): VLLMProcess {
  const uptime = processState.startedAt
    ? Math.floor((Date.now() - processState.startedAt) / 1000)
    : 0;
  return { ...processState, uptime };
}

export function onProgress(callback: (event: ProgressEvent) => void): () => void {
  emitter.on('progress', callback);
  return () => emitter.off('progress', callback);
}

export function onLogLine(callback: (line: string) => void): () => void {
  emitter.on('log', callback);
  return () => emitter.off('log', callback);
}

// ── Restart ────────────────────────────────────────────────────────────────

export async function restart(): Promise<void> {
  return withLock(async () => {
    const profile = processState.profile;
    if (!profile) throw new Error('No profile to restart with');
    await _stop();
    // Wait for GPU memory to be released (CUDA processes take a moment)
    for (let i = 0; i < 15; i++) {
      if (await isGPUClean()) break;
      await new Promise(r => setTimeout(r, 2000));
    }
    await _start(profile);
  });
}

// ── Command building ────────────────────────────────────────────────────────

interface BuiltCommand {
  cmd: string;
  args: string[];
  env: Record<string, string>;
  fullCmd: string; // for PID recycling check (M4)
}

function buildVLLMCommand(profile: ProfileConfig, modelDir: string): BuiltCommand {
  const port = profile.PORT ?? 8000;
  const args = [
    '-m', 'vllm.entrypoints.openai.api_server',
    '--model', modelDir,
    '--served-model-name', profile.SERVED_NAME,
    '--host', '0.0.0.0',
    '--port', String(port),
    '--max-model-len', String(profile.MAX_MODEL_LEN || 131072),
    '--gpu-memory-utilization', String(profile.GPU_UTIL ?? 0.9),
    '--max-num-seqs', String(profile.MAX_NUM_SEQS ?? 2),
    '--max-num-batched-tokens', String(profile.MAX_BATCHED_TOKENS ?? 2048),
    '--tensor-parallel-size', String(profile.TP_SIZE ?? 2),
    '--kv-cache-dtype', profile.KV_CACHE_DTYPE || 'auto',
  ];

  if (profile.MTP_K && profile.MTP_K > 0) {
    args.push('--speculative-config', JSON.stringify({num_speculative_tokens: profile.MTP_K}));
  }

  args.push('--enable-prefix-caching');

  if (profile.ENABLE_AUTO_TOOL_CHOICE) {
    args.push('--enable-auto-tool-choice', '--tool-call-parser', profile.TOOL_CALL_PARSER || 'hermes');
  }

  if (profile.LANGUAGE_MODEL_ONLY) {
    args.push('--language-model-only');
  }

  if (profile.SKIP_MM_PROFILING) {
    args.push('--skip-mm-profiling');
  }

  // COMPILATION_CONFIG_JSON is a CLI arg (--compilation-config)
  if (profile.COMPILATION_CONFIG_JSON) {
    args.push('--compilation-config', profile.COMPILATION_CONFIG_JSON);
  }

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PYTORCH_CUDA_ALLOC_CONF: 'expandable_segments:True',
    CUDA_DEVICE_ORDER: 'PCI_BUS_ID',
    CUDA_VISIBLE_DEVICES: '0,1',
  };
  if (profile.VLLM_INT8KV_FA_CONTINUATION_DEQUANT) {
    env.VLLM_INT8KV_FA_CONTINUATION_DEQUANT = '1';
  }
  if (profile.VLLM_INT8KV_FA_CASCADE_DEQUANT) {
    env.VLLM_INT8KV_FA_CASCADE_DEQUANT = '1';
  }
  if (profile.VLLM_INT8KV_FA_CASCADE_TILE_TOKENS) {
    env.VLLM_INT8KV_FA_CASCADE_TILE_TOKENS = String(profile.VLLM_INT8KV_FA_CASCADE_TILE_TOKENS);
  }

  const venvPython = path.join(process.env.HOME || '/home/chang', 'vLLM-2080Ti-Definitive', '.venv', 'bin', 'python3');
  const cmd = fs.existsSync(venvPython) ? venvPython : 'python3';
  const fullCmd = `${cmd} ${args.join(' ')}`;
  return { cmd, args, env, fullCmd };
}

// ── Profile resolution ─────────────────────────────────────────────────────

function resolveModelDir(): string {
  const configPath = path.join(HOME, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return config.modelDir;
}

// ── Pre-start checks ────────────────────────────────────────────────────────

async function isVLLMRunning(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("pgrep -x python3 -f vllm.entrypoints.openai.api_server");
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function isGPUClean(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits'
    );
    const maxMem = Math.max(...stdout.trim().split('\n').map(l => parseInt(l.trim(), 10) || 0));
    return maxMem < 500;
  } catch {
    return false;
  }
}

// ── Start ───────────────────────────────────────────────────────────────────

export async function start(profileRelPath: string): Promise<void> {
  return withLock(() => _start(profileRelPath));
}

async function _start(profileRelPath: string): Promise<void> {
  if (processState.status !== 'stopped') {
    throw new Error(`Cannot start: status is ${processState.status}`);
  }
  if (await isVLLMRunning()) {
    throw new Error('vLLM already running. Stop it first.');
  }
  if (!(await isGPUClean())) {
    throw new Error('GPU memory not clean. Kill residual processes first.');
  }

  const profilesDir = path.join(JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf-8')).launcherDir, 'profiles');
  const profilePath = path.resolve(profilesDir, profileRelPath);
  if (!profilePath.startsWith(profilesDir + path.sep)) throw new Error('Invalid profile path');
  if (!fs.existsSync(profilePath)) throw new Error(`Profile not found: ${profileRelPath}`);

  const { readEnvFile } = await import('../utils.js');
  const profile = readEnvFile(profilePath) as unknown as ProfileConfig;
  if (!profile.SERVED_NAME) {
    throw new Error('Profile is missing SERVED_NAME');
  }
  const modelDir = resolveModelDir();
  const port = profile.PORT ?? 8000;

  // Prepare log + pid files
  recentLines.length = 0;  // Clear stale lines from previous run
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const safeName = profile.SERVED_NAME.replace(SAFE_NAME_RE, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logFile = path.join(LOG_DIR, `vllm-${safeName}-${timestamp}.log`);
  const pidFile = path.join(LOG_DIR, `vllm-${safeName}-${timestamp}.pid`);

  const { cmd, args, env, fullCmd } = buildVLLMCommand(profile, modelDir);

  updateState({ status: 'starting', profile: profileRelPath, profilePath, logFile, startedAt: Date.now(), servedName: profile.SERVED_NAME, port, progress: 0, healthDetail: 'spawning process' });

  let child: ReturnType<typeof spawn> | null = null;
  let logStream: fs.WriteStream | null = null;

  try {
    child = spawn(cmd, args, {
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: HOME,
    });

    const childPid = child.pid;
    if (!childPid) throw new Error('Failed to get child PID after spawn');
    fs.writeFileSync(pidFile, String(childPid));

    // Stream stdout/stderr to log file with rotation support
    logStream = fs.createWriteStream(logFile, { flags: 'a' });
    let currentLogSize = 0;

    const rotateLogIfNeeded = (chunkSize: number) => {
      currentLogSize += chunkSize;
      if (currentLogSize < MAX_LOG_SIZE) return;
      // Rotate: close current, create new, clean up old
      logStream!.end();
      const safeNameRot = profile.SERVED_NAME.replace(SAFE_NAME_RE, '_');
      const tsRot = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const newLogFile = path.join(LOG_DIR, `vllm-${safeNameRot}-${tsRot}.log`);
      logStream = fs.createWriteStream(newLogFile, { flags: 'a' });
      currentLogSize = 0;
      updateState({ logFile: newLogFile });
      cleanupOldLogs(safeNameRot);
    };

    // Write manually instead of pipe — enables rotation tracking
    const writeToLog = (chunk: Buffer) => {
      rotateLogIfNeeded(chunk.length);
      logStream!.write(chunk);
    };
    child!.stdout!.on('data', writeToLog);
    child!.stderr!.on('data', writeToLog);

    // Pipe lines through our event emitter
    let buffer = '';
    const handleChunk = (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        emitter.emit('log', line);
        handleLogLine(line);
      }
    };
    child!.stdout!.on('data', handleChunk);
    child!.stderr!.on('data', handleChunk);

    // Capture PID for exit handler staleness check (H3)
    const myPid = child.pid;

    child.on('exit', (code, signal) => {
      // Stale exit from old process — ignore (H3)
      if (processState.pid !== myPid) return;

      logStream!.end();
      stopMetricsScraping();
      if (code === 0) {
        updateState({ status: 'stopped', error: null, errorDiagnosis: null, progress: 0 });
        emitter.emit('progress', {
          stage: lastStage?.id ?? 'stopped',
          label: 'Stopped',
          progress: 0,
          status: 'completed',
          message: 'Process exited cleanly',
          timestamp: Date.now(),
        });
      } else if (signal !== null) {
        updateState({ status: 'stopped', error: null, errorDiagnosis: null, progress: 0 });
        emitter.emit('progress', {
          stage: lastStage?.id ?? 'stopped',
          label: 'Stopped',
          progress: 0,
          status: 'completed',
          message: `Process terminated by signal ${signal}`,
          timestamp: Date.now(),
        });
      } else {
        updateState({ status: 'error', error: `Process exited with code ${code}`, progress: 0 });
        emitter.emit('progress', {
          stage: lastStage?.id ?? 'error',
          label: 'Error',
          progress: 0,
          status: 'error',
          message: `Exit code ${code}`,
          timestamp: Date.now(),
        });
      }
    });

    // Handle spawn errors (M1) — e.g., binary not executable, missing shared lib
    child.on('error', (err) => {
      if (processState.pid !== myPid) return;
      updateState({ status: 'error', error: `Process error: ${err.message}`, progress: 0 });
      emitter.emit('progress', {
        stage: 'error',
        label: 'Error',
        progress: 0,
        status: 'error',
        message: err.message,
        timestamp: Date.now(),
      });
      stopMetricsScraping();
      logStream!.end();
    });

    updateState({ pid: child.pid ?? null, status: 'loading', healthDetail: 'loading model', progress: 5 });

    // Save state for restart recovery (include fullCmd for M4)
    saveState({
      pid: child.pid ?? null,
      profile: profileRelPath,
      profilePath,
      logFile,
      startedAt: Date.now(),
      servedName: profile.SERVED_NAME,
      port,
    });
  } catch (err) {
    // Kill orphan child if it was spawned
    if (child && !child.killed) {
      try { child.kill('SIGKILL'); } catch {}
    }
    if (logStream) {
      try { logStream.end(); } catch {}
    }
    processState.pid = null;
    processState.status = 'error';
    updateState({
      status: 'error',
      pid: null,
      progress: 0,
      error: `Failed to spawn: ${err instanceof Error ? err.message : String(err)}`,
    });
    // Clean up PID file if partially written
    if (fs.existsSync(pidFile)) { try { fs.unlinkSync(pidFile); } catch {} };
    throw err;
  }
}

function handleLogLine(line: string): void {
  // Maintain rolling buffer of recent lines for error context
  recentLines.push(line);
  if (recentLines.length > MAX_RECENT_LINES) {
    recentLines.shift();
  }

  // Error detection with diagnosis
  if (isErrorLine(line)) {
    const diagnosis = analyzeError([...recentLines]);
    updateState({ error: diagnosis.message, errorDiagnosis: diagnosis });
    emitter.emit('progress', {
      stage: 'error',
      label: 'Error',
      progress: processState.progress,
      status: 'error',
      message: diagnosis.message,
      timestamp: Date.now(),
    });
    return;
  }

  // Stage detection
  const stage = parseLine(line);
  if (stage) {
    if (!lastStage || stage.id !== lastStage.id) {
      lastStage = stage;
      stageEnteredAt = Date.now();
    }
    const secondsInStage = (Date.now() - stageEnteredAt) / 1000;
    const realPct = extractProgressPercent(line);
    const progress = interpolateProgress(stage, secondsInStage, realPct);
    updateState({ progress, healthDetail: stage.label });
    emitter.emit('progress', {
      stage: stage.id,
      label: stage.label,
      progress,
      status: 'active',
      timestamp: Date.now(),
    });

    // Server-ready is special: start metrics scraping after health check
    if (stage.id === 'server') {
      // Capture PID at scheduling time to avoid stale health check (M2)
      const gen = processState.pid;
      setTimeout(() => checkHealth().then(ready => {
        if (processState.pid !== gen) return; // stale — new process started (M2)
        if (ready) {
          updateState({ status: 'ready', progress: 100, healthDetail: 'ready' });
          startMetricsScraping(processState.port);
          emitter.emit('progress', {
            stage: 'ready',
            label: 'Ready',
            progress: 100,
            status: 'completed',
            timestamp: Date.now(),
          });
        }
      }), 2000);
    }
  }
}

async function checkHealth(): Promise<boolean> {
  if (!processState.port) return false;
  try {
    const res = await fetch(`http://localhost:${processState.port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

function updateState(partial: Partial<VLLMProcess>): void {
  processState = { ...processState, ...partial };
}

// ── Stop ────────────────────────────────────────────────────────────────────

export async function stop(): Promise<void> {
  return withLock(() => _stop());
}

async function _stop(): Promise<void> {
  // If we're still spawning, kill everything forcefully
  if (processState.status === 'starting') {
    return _kill();
  }

  if (processState.pid === null) {
    clearState();
    return;
  }

  // Verify PID is still alive before sending signal (M4)
  if (!isProcessAlive(processState.pid)) {
    await cleanup();
    return;
  }

  // SIGTERM to process group
  if (processState.pid && processState.pid > 1) {
    try { process.kill(-processState.pid, 'SIGTERM'); } catch {}
  }

  // Wait up to 30s for graceful exit
  const start = Date.now();
  while (Date.now() - start < 30000) {
    if (!isProcessAlive(processState.pid)) break;
    await new Promise(r => setTimeout(r, 500));
  }

  // SIGKILL if still alive
  if (isProcessAlive(processState.pid)) {
    if (processState.pid && processState.pid > 1) {
      try { process.kill(-processState.pid, 'SIGKILL'); } catch {}
    }
  }

  await killResidualWorkers();
  await cleanup();
}

export async function kill(): Promise<void> {
  return withLock(() => _kill());
}

async function _kill(): Promise<void> {
  if (processState.pid !== null && processState.pid > 1) {
    try { process.kill(-processState.pid, 'SIGKILL'); } catch {}
  }
  await killResidualWorkers();
  await cleanup();
}

async function killResidualWorkers(): Promise<void> {
  if (processState.pid === null) return;
  try {
    // Only kill children if the parent PID is still our vLLM process (M4)
    const { stdout } = await execAsync(`ps -p ${processState.pid} -o args= 2>/dev/null || true`);
    if (stdout.includes('vllm') || stdout.includes('python3')) {
      await execAsync(`pkill -9 -P ${processState.pid} || true`);
    }
  } catch {}
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function cleanup(): Promise<void> {
  stopMetricsScraping();
  if (processState.logFile && fs.existsSync(processState.logFile)) {
    // Keep log file, just clean up pid file
    const dir = path.dirname(processState.logFile);
    const base = path.basename(processState.logFile, '.log');
    const pidFile = path.join(dir, `${base}.pid`);
    if (fs.existsSync(pidFile)) { try { fs.unlinkSync(pidFile); } catch {} };
  }
  if (logTailer) {
    logTailer.stop();
    logTailer = null;
  }
  clearState();
  processState = {
    pid: null,
    profile: null,
    profilePath: null,
    status: 'stopped',
    startedAt: null,
    uptime: 0,
    healthDetail: '',
    progress: 0,
    logFile: null,
    error: null,
    errorDiagnosis: null,
    servedName: null,
    port: processState.port,
  };
}

// ── Recovery: check if a vLLM process exists from a previous session ────────

export async function recoverFromState(): Promise<void> {
  const persisted = loadState();
  if (!persisted || !persisted.pid) return;

  if (isProcessAlive(persisted.pid)) {
    const ready = await checkHealth();
    processState = {
      pid: persisted.pid,
      profile: persisted.profile,
      profilePath: persisted.profilePath,
      logFile: persisted.logFile,
      startedAt: persisted.startedAt,
      servedName: persisted.servedName,
      port: persisted.port,
      status: ready ? 'ready' : 'loading',
      healthDetail: 'recovered from previous session',
      progress: 0,
      uptime: 0,
      error: null,
      errorDiagnosis: null,
    };
    if (processState.logFile && fs.existsSync(processState.logFile)) {
      startLogTailer(processState.logFile);
    }
    if (ready) {
      startMetricsScraping(processState.port);
    }

    // Start liveness polling for recovered processes (H1)
    // Without the child process handle, we can't attach an exit handler.
    // Poll every 10s to detect if the recovered process dies.
    startRecoveryPoll();
  } else {
    clearState();
  }
}

function startRecoveryPoll(): void {
  if (recoveryPollInterval) {
    clearInterval(recoveryPollInterval);
  }
  recoveryPollInterval = setInterval(async () => {
    if (processState.pid === null || processState.status === 'stopped') {
      if (recoveryPollInterval) {
        clearInterval(recoveryPollInterval);
        recoveryPollInterval = null;
      }
      return;
    }
    if (!isProcessAlive(processState.pid)) {
      if (recoveryPollInterval) {
        clearInterval(recoveryPollInterval);
        recoveryPollInterval = null;
      }
      try {
        await cleanup();
      } catch (err) {
        console.error('Recovery cleanup failed:', err);
        // Force state reset even if cleanup failed
        processState.status = 'stopped';
        processState.pid = null;
      }
      // Always emit progress regardless
      emitter.emit('progress', {
        stage: 'stopped',
        label: 'Stopped',
        progress: 0,
        status: 'completed',
        message: 'Recovered process died unexpectedly',
        timestamp: Date.now(),
      });
    }
  }, 10000);
}

/**
 * Clean up old rotated log files, keeping only the most recent MAX_ROTATED_LOGS.
 */
function cleanupOldLogs(safeName: string): void {
  try {
    if (!fs.existsSync(LOG_DIR)) return;
    const prefix = `vllm-${safeName}-`;
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith(prefix) && f.endsWith('.log'))
      .sort() // ISO timestamps sort lexicographically
      .reverse(); // newest first

    // Skip the current log file (first in list) and keep MAX_ROTATED_LOGS more
    const toDelete = files.slice(1 + MAX_ROTATED_LOGS);
    for (const f of toDelete) {
      try { fs.unlinkSync(path.join(LOG_DIR, f)); } catch { /* ignore */ }
    }
  } catch { /* ignore cleanup errors */ }
}

function startLogTailer(logFile: string): void {
  // Prevent watcher leak: stop any existing tailer first
  if (logTailer) {
    logTailer.stop();
    logTailer = null;
  }

  let buffer = '';
  let position = 0;

  const readNewLines = () => {
    if (!fs.existsSync(logFile)) return;
    const stats = fs.statSync(logFile);
    if (stats.size <= position) return;

    const stream = fs.createReadStream(logFile, {
      start: position,
      end: stats.size,
      encoding: 'utf-8',
    });

    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        emitter.emit('log', line);
        handleLogLine(line);
      }
    });

    stream.on('end', () => {
      position = stats.size;
    });

    stream.on('error', (err) => {
      console.error('Log tailer error:', err);
    });
  };

  // Initial read
  readNewLines();

  const watcher = fs.watch(logFile, () => readNewLines());

  logTailer = {
    stop: () => {
      watcher.close();
    },
  };
}
