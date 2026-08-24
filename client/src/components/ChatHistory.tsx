import { useChatHistory, useDeleteChat } from '../hooks/useChatHistory';
import { Button } from './common/Button';
import type { ChatConversation } from '../../../shared/chat';

export function ChatHistory({ selectedId, onSelect, onNew }: { selectedId: string | null; onSelect: (conversation: ChatConversation) => void; onNew: () => void }) {
  const { data: conversations = [] } = useChatHistory();
  const remove = useDeleteChat();
  return <aside className="w-56 shrink-0 border-r border-border pr-3 mr-3 overflow-y-auto">
    <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-text-secondary">History</span><Button size="sm" variant="ghost" onClick={onNew}>New</Button></div>
    <div className="space-y-1">{conversations.map(conversation => <div key={conversation.id} className={`group flex items-center gap-1 rounded px-2 py-1.5 text-xs ${selectedId === conversation.id ? 'bg-bg-hover text-text-primary' : 'text-text-secondary'}`}><button className="min-w-0 flex-1 truncate text-left" onClick={() => onSelect(conversation)}>{conversation.title || 'Untitled chat'}</button><button className="hidden group-hover:block text-red-400" aria-label={`Delete ${conversation.title}`} onClick={() => remove.mutate(conversation.id)}>×</button></div>)}</div>
  </aside>;
}
