import { Router } from 'express';
import * as profileMgr from '../services/profileManager.js';
import type { ApiResponse } from '../types.js';

export const profilesRouter = Router();

profilesRouter.get('/', async (_req, res) => {
  try {
    const profiles = await profileMgr.listProfiles();
    res.json({ ok: true, data: profiles } satisfies ApiResponse<typeof profiles>);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

profilesRouter.get('/templates', async (_req, res) => {
  // Templates are just profiles in the templates/ directory
  const all = await profileMgr.listProfiles();
  const templates = all.filter(p => p.name.startsWith('templates/'));
  res.json({ ok: true, data: templates });
});

profilesRouter.get('/:path(*)', async (req, res) => {
  try {
    const profile = await profileMgr.getProfile(req.params.path);
    res.json({ ok: true, data: profile });
  } catch (err: any) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

profilesRouter.post('/', async (req, res) => {
  try {
    const { name, config } = req.body;
    if (!name || !config) {
      return res.status(400).json({ ok: false, error: 'name and config required' });
    }
    const path = await profileMgr.createProfile(name, config);
    res.json({ ok: true, data: { path } });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

profilesRouter.put('/:path(*)', async (req, res) => {
  try {
    await profileMgr.updateProfile(req.params.path, req.body);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(403).json({ ok: false, error: err.message });
  }
});

profilesRouter.delete('/:path(*)', async (req, res) => {
  try {
    await profileMgr.deleteProfile(req.params.path);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(403).json({ ok: false, error: err.message });
  }
});

// ── Validate ─────────────────────────────────────────────────────────────────

profilesRouter.post('/validate', async (req, res) => {
  try {
    const errors = profileMgr.validateProfile(req.body);
    res.json({ ok: true, data: { valid: errors.length === 0, errors } });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});
