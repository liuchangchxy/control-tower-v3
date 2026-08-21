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
    return [];
  }
}

export function recordExperiment(exp: Experiment): void {
  const file = getExperimentsFile();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const experiments = loadExperiments();
  experiments.push(exp);
  fs.writeFileSync(file, JSON.stringify(experiments, null, 2), 'utf-8');
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
  const file = getExperimentsFile();
  fs.writeFileSync(file, JSON.stringify(experiments, null, 2), 'utf-8');
  return true;
}
