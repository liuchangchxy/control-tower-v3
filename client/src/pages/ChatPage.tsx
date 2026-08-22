import { useState, useRef, useEffect } from 'react';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { ChatMessage, type ChatMessageData } from '../components/ChatMessage';
import { useServerStatus } from '../hooks/useServer';

let nextId = 0;
function genId() {
  return `msg-${Date.now()}-${nextId++}`;
}

interface SSEChunk {
  choices?: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
}

export function ChatPage() {
  const { data: status } = useServerStatus();
  const isReady = status?.status === 'ready';

  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Only auto-scroll if user is already near the bottom (within 150px)
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Abort any in-flight stream when the user navigates away
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || isStreaming || !isReady) return;

    const userMsg: ChatMessageData = { id: genId(), role: 'user', content: text };
    const assistantMsg: ChatMessageData = { id: genId(), role: 'assistant', content: '' };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setIsStreaming(true);

    const requestSentAt = Date.now();
    let firstTokenTime: number | null = null;
    let tokenCount = 0;
    let buffer = '';

    try {
      abortRef.current = new AbortController();
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'vllm',
          messages: [...messages.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: text }],
          stream: true,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let sseBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (!trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') break;

          try {
            const chunk: SSEChunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              if (firstTokenTime === null) {
                firstTokenTime = Date.now();
              }
              tokenCount++;
              buffer += delta;
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantMsg.id ? { ...m, content: buffer } : m
                )
              );
            }
          } catch {
            // skip malformed JSON lines
          }
        }
      }

      // Finalize stats
      const ttft = firstTokenTime !== null ? firstTokenTime - requestSentAt : 0;
      const elapsed = firstTokenTime !== null ? (Date.now() - firstTokenTime) : 0;
      const tokPerSec = elapsed > 0 ? (tokenCount / (elapsed / 1000)) : 0;

      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsg.id
            ? { ...m, ttftMs: ttft, tokPerSec, tokenCount }
            : m
        )
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // user cancelled — show cancel indicator
        const cancelContent = buffer
          ? `${buffer}\n\n_(cancelled)_`
          : '_(cancelled)_';
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsg.id ? { ...m, content: cancelContent } : m
          )
        );
      } else {
        const errorMsg = err instanceof Error ? err.message : 'Stream failed';
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsg.id ? { ...m, content: buffer || `[Error: ${errorMsg}]` } : m
          )
        );
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-3rem)]">
      <Card className="flex-1 flex flex-col overflow-hidden">
        <div ref={containerRef} className="flex-1 overflow-y-auto space-y-3 mb-4 p-1" aria-live="polite" aria-label="Chat messages">
          {messages.length === 0 && (
            <div className="text-text-muted text-sm text-center mt-20">
              Start a conversation with the model. The server must be in ready state.
            </div>
          )}
          {messages.map(msg => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="flex gap-2 border-t border-border pt-3">
          <div className="flex-1">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isReady ? 'Type a message...' : 'Server not ready'}
              disabled={isStreaming || !isReady}
              rows={1}
              aria-label="Chat message"
              aria-describedby="chat-hint"
              className="w-full bg-bg-tertiary border border-border rounded-[var(--radius)] px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent disabled:opacity-50"
            />
            <span id="chat-hint" className="sr-only">Press Enter to send, Shift+Enter for new line</span>
          </div>
          <Button
            onClick={send}
            disabled={!input.trim() || isStreaming || !isReady}
            loading={isStreaming}
          >
            Send
          </Button>
        </div>
      </Card>
    </div>
  );
}
