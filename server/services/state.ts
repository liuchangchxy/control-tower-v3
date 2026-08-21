import fs from 'node:fs';
import path from 'node:path';
import type { PersistedState } from '../types.js';

function getStateFile(): string {
  const HOME = process.env.CONTROL_TOWER_HOME || process.cwd();
  return path.join(HOME, 'state.json');
}

export function loadState(): PersistedState | null {
  if (!fs.existsSync(getStateFile())) return null;
  try {
    const raw = fs.readFileSync(getStateFile(), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      pid: parsed.pid ?? null,
      profile: parsed.profile ?? null,
      profilePath: parsed.profilePath ?? null,
      logFile: parsed.logFile ?? null,
      startedAt: parsed.startedAt ?? null,
      servedName: parsed.servedName ?? null,
      port: parsed.port ?? 8000,
    };
  } catch (err) {
    console.error('Failed to load state:', err);
    return null;
  }
}

export function saveState(state: PersistedState): void {
  const tmp = getStateFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmp, getStateFile());
}

export function clearState(): void {
  const f = getStateFile();
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
