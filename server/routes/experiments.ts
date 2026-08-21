import { Router } from 'express';
import {
  loadExperiments,
  getExperimentById,
  recordExperiment,
  addNotes,
} from '../services/experimentTracker.js';
import { getStatus } from '../services/processManager.js';
import type { Experiment } from '../types.js';

export const experimentsRouter = Router();

// GET /api/experiments — list all experiments
experimentsRouter.get('/', (_req, res) => {
  try {
    const experiments = loadExperiments();
    res.json({ ok: true, data: experiments });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/experiments/:id — get a single experiment
experimentsRouter.get('/:id', (req, res) => {
  const exp = getExperimentById(req.params.id);
  if (!exp) {
    return res.status(404).json({ ok: false, error: 'Experiment not found' });
  }
  res.json({ ok: true, data: exp });
});

// POST /api/experiments — record a new experiment
experimentsRouter.post('/', (req, res) => {
  try {
    const status = getStatus();

    const experiment: Experiment = {
      id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      profilePath: req.body.profilePath ?? status.profile ?? 'unknown',
      profileSnapshot: req.body.profileSnapshot ?? {},
      startDurationSec: req.body.startDurationSec ?? 0,
      status: req.body.status ?? status.status as Experiment['status'],
      errorMessage: req.body.errorMessage ?? status.error ?? undefined,
      benchmarkResults: req.body.benchmarkResults ?? [],
      notes: req.body.notes,
    };

    recordExperiment(experiment);
    res.json({ ok: true, data: experiment });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /api/experiments/:id/notes — add notes to an experiment
experimentsRouter.patch('/:id/notes', (req, res) => {
  const { notes } = req.body;
  if (typeof notes !== 'string') {
    return res.status(400).json({ ok: false, error: 'notes must be a string' });
  }

  const ok = addNotes(req.params.id, notes);
  if (!ok) {
    return res.status(404).json({ ok: false, error: 'Experiment not found' });
  }

  const exp = getExperimentById(req.params.id);
  res.json({ ok: true, data: exp });
});
