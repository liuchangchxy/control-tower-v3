import { memo } from 'react';
import { cn } from '../lib/cn';

export interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ttftMs?: number;
  tokPerSec?: number;
  tokenCount?: number;
}

interface Props {
  message: ChatMessageData;
}

export const ChatMessage = memo(function ChatMessage({ message }: Props) {
  const isUser = message.role === 'user';

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
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
        {!isUser && message.ttftMs !== undefined && (
          <div className="mt-1.5 text-xs text-text-muted font-mono border-t border-border/50 pt-1.5">
            TTFT: {message.ttftMs.toFixed(0)}ms | {message.tokPerSec?.toFixed(1) ?? '?'} tok/s | {message.tokenCount ?? '?'} tokens
          </div>
        )}
      </div>
    </div>
  );
});
