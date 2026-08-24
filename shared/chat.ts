export interface ChatMessageRecord {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  ttftMs?: number;
  tokPerSec?: number;
  tokenCount?: number;
}

export interface ChatConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string | null;
  profile: string | null;
  messages: ChatMessageRecord[];
}

export interface ChatHistoryStore {
  list(): Promise<ChatConversation[]>;
  get(id: string): Promise<ChatConversation | null>;
  save(conversation: ChatConversation): Promise<ChatConversation>;
  remove(id: string): Promise<boolean>;
}
