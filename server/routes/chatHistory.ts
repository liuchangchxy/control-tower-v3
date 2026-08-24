import { Router } from 'express';
import { chatHistory } from '../services/chatHistory.js';

export const chatHistoryRouter = Router();
chatHistoryRouter.get('/', async (_req, res) => res.json({ ok: true, data: await chatHistory.list() }));
chatHistoryRouter.get('/:id', async (req, res) => {
  const item = await chatHistory.get(req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Conversation not found' });
  return res.json({ ok: true, data: item });
});
chatHistoryRouter.put('/:id', async (req, res) => {
  const item = req.body;
  if (!item || item.id !== req.params.id || !Array.isArray(item.messages)) return res.status(400).json({ ok: false, error: 'Invalid conversation' });
  return res.json({ ok: true, data: await chatHistory.save(item) });
});
chatHistoryRouter.delete('/:id', async (req, res) => res.json({ ok: true, data: await chatHistory.remove(req.params.id) }));
