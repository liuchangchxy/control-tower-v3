import fs from 'node:fs';
import path from 'node:path';
import type { Experiment } from '../types.js';

function getExperimentsFile(): string {
  const HOME = process.env.CONTROL_TOWER_HOME || process.cwd();
  return path.join(HOME, 'run-logs', 'experiments.json');
}

export function loadExperiments(): Experiment[] {
  const file = getExperimentsFile();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    // Corrupted file — back up and return empty (L6)
    try {
      const backup = file + '.corrupted.' + Date.now();
      fs.renameSync(file, backup);
      console.error(`Corrupted experiments.json backed up to ${backup}`);
    } catch { /* ignore */ }
    return [];
  }
}

function atomicWrite(file: string, data: unknown): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpFile = file + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpFile, file);
}

export function recordExperiment(exp: Experiment): void {
  const file = getExperimentsFile();
  const experiments = loadExperiments();
  experiments.push(exp);
  atomicWrite(file, experiments);
}

export function getExperimentById(id: string): Experiment | undefined {
  const experiments = loadExperiments();
  return experiments.find((e) => e.id === id);
}

export function addNotes(id: string, notes: string): boolean {
  const experiments = loadExperiments();
  const exp = experiments.find((e) => e.id === id);
  if (!exp) return false;
  exp.notes = notes;
  atomicWrite(getExperimentsFile(), experiments);
  return true;
}
