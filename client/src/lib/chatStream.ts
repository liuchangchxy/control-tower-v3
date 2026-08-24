export interface ChatStreamDelta {
  content?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
}

export interface ChatStreamEvent {
  delta: ChatStreamDelta;
  usage?: { completion_tokens?: number } | null;
  done?: boolean;
  error?: string;
}

export interface ChatStreamParser {
  push(chunk: string): ChatStreamEvent[];
  finish(): ChatStreamEvent[];
}

function parseData(data: string): ChatStreamEvent | null {
  if (!data.trim()) return null;
  if (data.trim() === '[DONE]') return { delta: {}, done: true };
  try {
    const payload = JSON.parse(data) as {
      choices?: Array<{ delta?: ChatStreamDelta; message?: ChatStreamDelta }>;
      usage?: { completion_tokens?: number } | null;
      error?: { message?: string } | string;
    };
    if (payload.error) return { delta: {}, error: typeof payload.error === 'string' ? payload.error : payload.error.message || 'Stream failed' };
    const choice = payload.choices?.[0];
    return { delta: choice?.delta ?? choice?.message ?? {}, usage: payload.usage };
  } catch {
    return { delta: {}, error: 'Malformed stream event' };
  }
}

export function createChatStreamParser(): ChatStreamParser {
  let buffer = '';
  const consume = (flush: boolean): ChatStreamEvent[] => {
    const events: ChatStreamEvent[] = [];
    const normalized = buffer.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const parts = normalized.split('\n\n');
    buffer = flush ? '' : (parts.pop() ?? '');
    for (const part of parts) {
      const data = part.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      const event = parseData(data);
      if (event) events.push(event);
    }
    if (flush && buffer.trim()) {
      const data = buffer.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      const event = parseData(data);
      if (event) events.push(event);
    }
    return events;
  };
  return {
    push(chunk) { buffer += chunk; return consume(false); },
    finish() { return consume(true); },
  };
}
