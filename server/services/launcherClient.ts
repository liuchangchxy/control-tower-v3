import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveConfig } from '../config.js';

const execFileAsync = promisify(execFile);

import { parseLauncherHandoff, type LauncherHandoff, type LauncherRequest } from './launcherProtocol.js';

export type { LauncherHandoff } from './launcherProtocol.js';
export type LauncherOverrides = LauncherRequest;

function config() {
  return resolveConfig();
}

function launcherArgs(action: string, overrides?: LauncherOverrides): string[] {
  const c = config();
  const logDir = overrides?.logDir ?? c.logDir;
  const values: Array<[string, string]> = [
    ['LOG_DIR', logDir],
  ];
  if (overrides) {
    values.push(['PROFILE_FILE', path.isAbsolute(overrides.profile) ? overrides.profile : path.join(c.launcherDir, 'profiles', overrides.profile)]);
    values.push(['MODEL_DIR', overrides.modelDir]);
    values.push(['MODE', overrides.mode ?? 'fast']);
    values.push(['GPU_DEVICES', overrides.gpuDevices ?? '0,1']);
    values.push(['TP_SIZE', String(overrides.tpSize ?? 2)]);
    values.push(['PORT', String(overrides.port ?? 8000)]);
    values.push(['SERVICE_SCOPE', overrides.serviceScope ?? 'local']);
    if (overrides.startTimeout !== undefined) values.push(['START_TIMEOUT', String(overrides.startTimeout)]);
    if (overrides.skipStartupSmoke !== undefined) values.push(['SKIP_STARTUP_SMOKE', overrides.skipStartupSmoke ? '1' : '0']);
  }
  return [action, '--json', '--non-interactive', ...values.flatMap(([key, value]) => ['--set', `${key}=${value}`])];
}

function parseHandoff(stdout: string): LauncherHandoff {
  return parseLauncherHandoff(stdout);
}

async function invoke(action: string, overrides?: LauncherOverrides): Promise<LauncherHandoff> {
  const c = config();
  const launcher = path.join(c.launcherDir, 'launcher.sh');
  if (!fs.existsSync(launcher)) throw new Error(`Canonical launcher not found: ${launcher}`);
  try {
    const result = await execFileAsync(launcher, launcherArgs(action, overrides), {
      cwd: c.launcherDir,
      env: { ...process.env, CONTROL_TOWER_JSON: '1', ...(c.cudaHome ? { CUDA_HOME: c.cudaHome } : {}) },
      maxBuffer: 1024 * 1024,
      timeout: Math.max(30_000, (overrides?.startTimeout ?? 900) * 1000 + 30_000),
    });
    return parseHandoff(result.stdout);
  } catch (err: any) {
    const stdout = String(err.stdout ?? '');
    if (stdout) {
      try { return parseHandoff(stdout); } catch { /* preserve process error */ }
    }
    if (err.code === 'ENOENT') throw new Error(`Canonical launcher is not executable: ${launcher}`);
    throw new Error(`Launcher ${action} failed: ${String(err.stderr || err.message).trim()}`);
  }
}

export function getLauncherHandoffPath(logDir?: string): string {
  const home = process.env.CONTROL_TOWER_HOME || process.cwd();
  return path.join(logDir ?? path.resolve(home, config().logDir ?? 'run-logs'), 'control-tower.state.json');
}

export const launcherClient = {
  start: (overrides: LauncherOverrides) => invoke('start', overrides),
  status: () => invoke('status'),
  stop: () => invoke('stop'),
  kill: () => invoke('kill'),
  restart: (overrides: LauncherOverrides) => invoke('restart', overrides),
};

export { parseHandoff };
