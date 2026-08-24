import fs from 'node:fs';
import path from 'node:path';
import type { PersistedState } from '../types.js';
import { resolveConfig } from '../config.js';

function getStateFile(): string {
  const home = process.env.CONTROL_TOWER_HOME || process.cwd();
  const configPath = path.join(home, 'config.json');
  if (!fs.existsSync(configPath)) return path.join(home, 'state.json');
  return resolveConfig(home).stateFile;
}

function parsePersistedState(value: unknown): PersistedState | null {
  if (!value || typeof value !== 'object') return null;
  const parsed = value as Partial<PersistedState>;
  const validPid = parsed.pid === null || (typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) && parsed.pid > 1);
  const validPgid = parsed.pgid === null || parsed.pgid === undefined || (typeof parsed.pgid === 'number' && Number.isInteger(parsed.pgid) && parsed.pgid > 1);
  const validPort = typeof parsed.port === 'number' && Number.isInteger(parsed.port) && parsed.port >= 1 && parsed.port <= 65535;
  const validStartedAt = parsed.startedAt === null || (typeof parsed.startedAt === 'number' && Number.isFinite(parsed.startedAt) && parsed.startedAt >= 0);
  if (!validPid || !validPgid || !validPort || !validStartedAt) return null;
  const strings = [parsed.profile, parsed.profilePath, parsed.logFile, parsed.servedName];
  if (strings.some(value => value !== null && value !== undefined && typeof value !== 'string')) return null;
  return {
    pid: parsed.pid ?? null,
    pgid: parsed.pgid ?? null,
    profile: parsed.profile ?? null,
    profilePath: parsed.profilePath ?? null,
    logFile: parsed.logFile ?? null,
    startedAt: parsed.startedAt ?? null,
    servedName: parsed.servedName ?? null,
    port: parsed.port!,
  };
}

export function loadState(): PersistedState | null {
  const file = getStateFile();
  if (!fs.existsSync(file)) return null;
  try {
    return parsePersistedState(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    console.error('Failed to load state:', err);
    return null;
  }
}

export function saveState(state: PersistedState): void {
  const file = getStateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function clearState(): void {
  const file = getStateFile();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
