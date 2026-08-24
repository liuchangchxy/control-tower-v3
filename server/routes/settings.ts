import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { ApiResponse } from '../types.js';
import { resolveConfig } from '../config.js';

interface ConfigField { type: 'number' | 'string'; description: string; }
const CONFIG_FIELDS: Record<string, ConfigField> = {
  port: { type: 'number', description: 'Server listen port' },
  launcherDir: { type: 'string', description: 'Path to canonical vLLM launcher directory' },
  modelDir: { type: 'string', description: 'Default model directory' },
  logDir: { type: 'string', description: 'Launcher log directory' },
  stateFile: { type: 'string', description: 'Tower reconnect state file' },
  cudaHome: { type: 'string', description: 'Optional host CUDA toolkit override' },
};
function home() { return process.env.CONTROL_TOWER_HOME || process.cwd(); }
function configPath() { return path.join(home(), 'config.json'); }
function readConfig() { return JSON.parse(fs.readFileSync(configPath(), 'utf8')) as Record<string, unknown>; }
function writeConfig(value: Record<string, unknown>) {
  const file = configPath(); fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8'); fs.renameSync(tmp, file);
}

export const settingsRouter = Router();
let configBusy = false;
settingsRouter.get('/', (_req, res) => {
  try { const config = readConfig(); res.json({ ok: true, data: { config, fields: CONFIG_FIELDS } } satisfies ApiResponse<{ config: Record<string, unknown>; fields: Record<string, ConfigField> }>); }
  catch (err: any) { res.status(500).json({ ok: false, error: `Failed to read config.json: ${err.message}` }); }
});
settingsRouter.put('/', (req, res) => {
  if (configBusy) return res.status(409).json({ ok: false, error: 'Config update already in progress' });
  configBusy = true;
  try {
    const { config: newConfig } = req.body as { config?: Record<string, unknown> };
    if (!newConfig || typeof newConfig !== 'object') return res.status(400).json({ ok: false, error: 'config object required' });
    const errors: string[] = [];
    for (const [key, value] of Object.entries(newConfig)) {
      const field = CONFIG_FIELDS[key];
      if (!field) { errors.push(`Unknown field: ${key}`); continue; }
      if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || (key === 'port' && (!Number.isInteger(value) || value < 1 || value > 65535)))) errors.push(`${key} must be a valid number`);
      if (field.type === 'string' && (typeof value !== 'string' || value.includes('..'))) errors.push(`${key} must be a valid path without '..' segments`);
    }
    if (errors.length) return res.status(400).json({ ok: false, error: errors.join('; ') });
    const merged = { ...readConfig(), ...newConfig };
    try { resolveConfig(home()); } catch (err: any) { return res.status(400).json({ ok: false, error: err.message }); }
    writeConfig(merged);
    res.json({ ok: true, data: merged } satisfies ApiResponse<Record<string, unknown>>);
  } catch (err: any) { res.status(500).json({ ok: false, error: `Failed to write config.json: ${err.message}` }); }
  finally { configBusy = false; }
});
