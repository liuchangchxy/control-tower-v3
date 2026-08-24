import fs from 'node:fs';
import path from 'node:path';
import type { ChatConversation, ChatHistoryStore } from '../../shared/chat.js';

let queue: Promise<unknown> = Promise.resolve();
const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = queue.then(fn, fn);
  queue = next.then(() => undefined, () => undefined);
  return next;
};

function filePath(): string { return path.join(process.env.CONTROL_TOWER_HOME || process.cwd(), 'run-logs', 'chat-history.json'); }
function validId(id: string): boolean { return /^[a-zA-Z0-9_-]{1,80}$/.test(id); }
function read(): ChatConversation[] {
  try {
    const value = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as { version?: number; conversations?: ChatConversation[] };
    return value.version === 1 && Array.isArray(value.conversations) ? value.conversations : [];
  } catch { return []; }
}
function write(conversations: ChatConversation[]): void {
  const file = filePath(); fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`; fs.writeFileSync(tmp, JSON.stringify({ version: 1, conversations }, null, 2)); fs.renameSync(tmp, file);
}

export const chatHistory: ChatHistoryStore = {
  async list() { return read().sort((a, b) => b.updatedAt - a.updatedAt); },
  async get(id) { if (!validId(id)) return null; return read().find(item => item.id === id) ?? null; },
  async save(conversation) { return withLock(async () => { const all = read().filter(item => item.id !== conversation.id); const bounded = { ...conversation, title: conversation.title.slice(0, 120), messages: conversation.messages.slice(-200).map(message => ({ ...message, content: message.content.slice(0, 200_000), reasoning: message.reasoning?.slice(0, 200_000) })) }; all.push(bounded); write(all); return bounded; }); },
  async remove(id) { return withLock(async () => { const all = read(); const next = all.filter(item => item.id !== id); if (next.length === all.length) return false; write(next); return true; }); },
};
