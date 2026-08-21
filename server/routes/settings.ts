import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { ApiResponse } from '../types.js';

const HOME = process.env.CONTROL_TOWER_HOME || process.cwd();
const CONFIG_PATH = path.join(HOME, 'config.json');

// Allowed fields in config.json and their types
interface ConfigField {
  type: 'number' | 'string';
  description: string;
}

const CONFIG_FIELDS: Record<string, ConfigField> = {
  port:        { type: 'number', description: 'Server listen port (default 9090)' },
  launcherDir: { type: 'string', description: 'Path to vLLM launcher directory' },
  modelDir:    { type: 'string', description: 'Default model directory' },
  logDir:      { type: 'string', description: 'Log file directory' },
  stateFile:   { type: 'string', description: 'Persisted state filename' },
};

function readConfig(): Record<string, unknown> {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

function writeConfig(config: Record<string, unknown>): void {
  // Atomic write: temp file then rename (M17)
  const tmpPath = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpPath, CONFIG_PATH);
}

export const settingsRouter = Router();

// Concurrency guard for config writes
let configBusy = false;

// GET /api/settings — return current config.json
settingsRouter.get('/', (_req, res) => {
  try {
    const config = readConfig();
    res.json({ ok: true, data: { config, fields: CONFIG_FIELDS } } satisfies ApiResponse<{
      config: Record<string, unknown>;
      fields: Record<string, ConfigField>;
    }>);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: `Failed to read config.json: ${err.message}` });
  }
});

// PUT /api/settings — update config.json
settingsRouter.put('/', (req, res) => {
  try {
    if (configBusy) {
      return res.status(409).json({ ok: false, error: 'Config update already in progress' });
    }
    configBusy = true;

    const { config: newConfig } = req.body as { config?: Record<string, unknown> };
    if (!newConfig || typeof newConfig !== 'object') {
      return res.status(400).json({ ok: false, error: 'config object required' });
    }

    // Validate each field
    const errors: string[] = [];
    for (const [key, value] of Object.entries(newConfig)) {
      if (!(key in CONFIG_FIELDS)) {
        errors.push(`Unknown field: ${key}`);
        continue;
      }
      const field = CONFIG_FIELDS[key];
      if (field.type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push(`${key} must be a number`);
        }
      } else if (field.type === 'string') {
        if (typeof value !== 'string' || value.includes('..')) {
          errors.push(`${key} must be a valid path without '..' segments`);
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ ok: false, error: errors.join('; ') });
    }

    // Merge with existing config to preserve any unknown fields
    const existing = readConfig();
    const merged = { ...existing, ...newConfig };
    writeConfig(merged);

    res.json({ ok: true, data: merged } satisfies ApiResponse<Record<string, unknown>>);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: `Failed to write config.json: ${err.message}` });
  } finally {
    configBusy = false;
  }
});
