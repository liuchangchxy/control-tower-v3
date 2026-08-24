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
    delta?: { content?: string; reasoning_content?: string };
    finish_reason?: string | null;
  }>;
}

const THINKING_EFFORTS = ['low', 'medium', 'high'] as const;
type ThinkingEffort = typeof THINKING_EFFORTS[number];

export function ChatPage() {
  const { data: status } = useServerStatus();
  const isReady = status?.status === 'ready' || (status?.status === 'unknown' && status.apiAvailable === true && status.runtimeEvidence?.modelMatches === true);

  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [enableThinking, setEnableThinking] = useState(true);
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>('medium');
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const stop = () => {
    abortRef.current?.abort();
  };

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
    let reasoningBuffer = '';

    try {
      abortRef.current = new AbortController();
      const body: Record<string, unknown> = {
        model: status?.servedName || 'vllm',
        messages: [...messages.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: text }],
        stream: true,
      };

      if (enableThinking) {
        body.chat_template_kwargs = { enable_thinking: true };
        body.reasoning_effort = thinkingEffort;
      } else {
        body.chat_template_kwargs = { enable_thinking: false };
      }

      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.reasoning_content) {
              if (firstTokenTime === null) firstTokenTime = Date.now();
              tokenCount++;
              reasoningBuffer += delta.reasoning_content;
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantMsg.id ? { ...m, reasoning: reasoningBuffer } : m
                )
              );
            }
            if (delta?.content) {
              if (firstTokenTime === null) firstTokenTime = Date.now();
              tokenCount++;
              buffer += delta.content;
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
        const cancelContent = buffer
          ? `${buffer}\n\n_(stopped)${reasoningBuffer ? '' : '_'}`
          : '_(stopped)_';
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
      if (isStreaming) stop(); else send();
    }
  };

  const model = status?.servedName || 'model';
  const apiUrl = `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:8000/v1`;

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-3rem)]">
      <Card className="flex-1 flex flex-col overflow-hidden">
        {/* API endpoint info */}
        {isReady && (
          <div className="flex items-center gap-2 px-1 pb-2 text-xs text-text-muted border-b border-border/50 mb-3">
            <span>API:</span>
            <code className="bg-bg-primary px-1.5 py-0.5 rounded font-mono text-text-secondary select-all">{apiUrl}</code>
            <span className="text-text-muted/50">model: </span>
            <code className="bg-bg-primary px-1.5 py-0.5 rounded font-mono text-text-secondary select-all">{model}</code>
          </div>
        )}
        <div ref={containerRef} className="flex-1 overflow-y-auto space-y-3 mb-4 p-1" aria-live="polite" aria-label="Chat messages">
          {messages.length === 0 && (
            <div className="text-text-muted text-sm text-center mt-20">
              {isReady ? 'Start a conversation with the model.' : status?.status === 'unknown' ? 'Runtime identity is not safe for lifecycle control; chat is unavailable until it is reconciled.' : 'Start a conversation with the model. The server must be in ready state.'}
            </div>
          )}
          {messages.map(msg => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Thinking controls */}
        <div className="flex items-center gap-3 px-1 pb-2 border-t border-border/50 mb-2">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enableThinking}
              onChange={e => setEnableThinking(e.target.checked)}
              className="accent-accent w-3.5 h-3.5"
            />
            <span className="text-text-secondary">💭 Thinking</span>
          </label>
          {enableThinking && (
            <div className="flex items-center gap-1 text-xs">
              <span className="text-text-muted">Depth:</span>
              {THINKING_EFFORTS.map(level => (
                <button
                  key={level}
                  onClick={() => setThinkingEffort(level)}
                  className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
                    thinkingEffort === level
                      ? 'bg-accent text-white'
                      : 'bg-bg-tertiary text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="flex gap-2">
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
          {isStreaming ? (
            <Button onClick={stop} variant="secondary" className="min-w-[4rem]">
              ⏹ Stop
            </Button>
          ) : (
            <Button
              onClick={send}
              disabled={!input.trim() || !isReady}
            >
              Send
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
