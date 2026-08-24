import { memo, useState } from 'react';
import { cn } from '../lib/cn';
import { renderMarkdown } from '../lib/markdown';

export interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  ttftMs?: number;
  tokPerSec?: number;
  tokenCount?: number;
}

interface Props {
  message: ChatMessageData;
}

export const ChatMessage = memo(function ChatMessage({ message }: Props) {
  const isUser = message.role === 'user';
  const [showReasoning, setShowReasoning] = useState(false);
  const hasReasoning = !isUser && !!message.reasoning;

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[70%] rounded-lg px-4 py-2 text-sm',
          isUser
            ? 'bg-accent text-white'
            : 'bg-bg-tertiary text-text-primary border border-border'
        )}
      >
        {hasReasoning && (
          <div className="mb-2">
            <button
              onClick={() => setShowReasoning(!showReasoning)}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              <span className="text-[10px]">{showReasoning ? '▼' : '▶'}</span>
              💭 Thinking{showReasoning ? '' : ' (click to expand)'}
            </button>
            {showReasoning && (
              <div className="mt-1.5 p-2 rounded bg-bg-primary/50 text-xs text-text-muted whitespace-pre-wrap break-words border-l-2 border-accent/30">
                {message.reasoning}
              </div>
            )}
          </div>
        )}
        <div
          className="chat-markdown whitespace-pre-wrap break-words"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content || (message.reasoning ? '' : '…')) }}
        />
        {!isUser && message.ttftMs !== undefined && (
          <div className="mt-1.5 text-xs text-text-muted font-mono border-t border-border/50 pt-1.5">
            TTFT: {message.ttftMs.toFixed(0)}ms | {message.tokPerSec?.toFixed(1) ?? '?'} tok/s | {message.tokenCount ?? '?'} tokens
          </div>
        )}
      </div>
    </div>
  );
});
