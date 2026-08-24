import fs from 'node:fs';
import path from 'node:path';

export interface ConfigSnapshot {
  home: string;
  port: number;
  launcherDir: string;
  modelDir: string;
  logDir: string;
  stateFile: string;
  cudaHome?: string;
}

export interface RawControlTowerConfig {
  port?: number;
  launcherDir: string;
  modelDir: string;
  logDir?: string;
  stateFile?: string;
  cudaHome?: string;
}

export interface ResolveConfigOptions {
  /** Profile-only callers may resolve launcher paths before a model is configured. */
  allowIncomplete?: boolean;
}

export function resolveConfig(
  home = process.env.CONTROL_TOWER_HOME || process.cwd(),
  options: ResolveConfigOptions = {},
): ConfigSnapshot {
  const configPath = path.join(home, 'config.json');
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as RawControlTowerConfig;
  if (!raw.launcherDir || (!raw.modelDir && !options.allowIncomplete)) throw new Error('launcherDir and modelDir are required');
  const resolve = (value: string) => path.isAbsolute(value) ? value : path.resolve(home, value);
  const port = raw.port ?? 9090;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be between 1 and 65535');
  return {
    home,
    port,
    launcherDir: resolve(raw.launcherDir),
    modelDir: raw.modelDir ?? '',
    logDir: resolve(raw.logDir ?? 'run-logs'),
    stateFile: resolve(raw.stateFile ?? 'state.json'),
    cudaHome: raw.cudaHome,
  };
}

export function readRawConfig(home = process.env.CONTROL_TOWER_HOME || process.cwd()): RawControlTowerConfig {
  return JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')) as RawControlTowerConfig;
}
