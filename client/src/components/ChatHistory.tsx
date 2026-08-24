import { useState } from 'react';
import { Modal } from './common/Modal';
import { useChatHistory, useDeleteChat } from '../hooks/useChatHistory';
import { Button } from './common/Button';
import type { ChatConversation } from '../../../shared/chat';

export function ChatHistory({ selectedId, onSelect, onNew }: { selectedId: string | null; onSelect: (conversation: ChatConversation) => void; onNew: () => void }) {
  const { data: conversations = [] } = useChatHistory();
  const remove = useDeleteChat();
  const [pendingDelete, setPendingDelete] = useState<ChatConversation | null>(null);
  return <aside className="w-56 shrink-0 border-r border-border pr-3 mr-3 overflow-y-auto">
    <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-text-secondary">History</span><Button size="sm" variant="ghost" onClick={onNew}>New</Button></div>
    <div className="space-y-1">{conversations.map(conversation => <div key={conversation.id} className={`group flex items-center gap-1 rounded px-2 py-1.5 text-xs ${selectedId === conversation.id ? 'bg-bg-hover text-text-primary' : 'text-text-secondary'}`}><button className="min-w-0 flex-1 truncate text-left" onClick={() => onSelect(conversation)}>{conversation.title || 'Untitled chat'}</button><button className="hidden group-hover:block text-red-400" aria-label={`Delete ${conversation.title}`} onClick={() => setPendingDelete(conversation)}>×</button></div>)}</div>
    <Modal open={pendingDelete !== null} onClose={() => setPendingDelete(null)} title="Delete conversation">
      <p className="text-sm text-text-secondary mb-4">Delete “{pendingDelete?.title || 'Untitled chat'}”? This cannot be undone.</p>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setPendingDelete(null)}>Cancel</Button><Button variant="danger" loading={remove.isPending} onClick={async () => { if (pendingDelete) await remove.mutateAsync(pendingDelete.id); setPendingDelete(null); }}>Delete</Button></div>
    </Modal>
  </aside>;
}
