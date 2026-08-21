import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runBenchmark,
  runWarmup,
  estimateTokens,
  BENCHMARK_PROMPTS,
} from '../server/services/benchmark.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a fake SSE response body that yields `count` chunks. */
function fakeSSEBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const parts = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n`);
  parts.push('data: [DONE]\n');
  return new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(part));
      }
      controller.close();
    },
  });
}

/** Build a minimal fake Response with a body that emits SSE chunks. */
function fakeResponse(chunks: string[], status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    body: fakeSSEBody(chunks),
    headers: new Headers(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    clone: () => fakeResponse(chunks, status),
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    json: async => ({}),
    text: async () => '',
  } as unknown as Response;
}

// ── Mocks ───────────────────────────────────────────────────────────────────

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue(fakeResponse(['hello', ' world']));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('1234')).toBe(1);
    expect(estimateTokens('12345678')).toBe(2);
    expect(estimateTokens('hello')).toBe(2); // 5 chars -> ceil(1.25) = 2
  });
});

describe('BENCHMARK_PROMPTS', () => {
  it('has short, medium, long keys', () => {
    expect(BENCHMARK_PROMPTS).toHaveProperty('short');
    expect(BENCHMARK_PROMPTS).toHaveProperty('medium');
    expect(BENCHMARK_PROMPTS).toHaveProperty('long');
  });

  it('short prompt is short', () => {
    expect(BENCHMARK_PROMPTS.short.length).toBeLessThan(100);
  });

  it('long prompt is substantial', () => {
    expect(BENCHMARK_PROMPTS.long.length).toBeGreaterThan(500);
  });
});

describe('runWarmup', () => {
  it('sends a POST to /v1/chat/completions', async () => {
    await runWarmup(9999);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain('localhost:9999/v1/chat/completions');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(1);
  });

  it('does not throw on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(runWarmup()).resolves.toBeUndefined();
  });
});

describe('runBenchmark', () => {
  it('returns a valid BenchmarkResult', async () => {
    const result = await runBenchmark('test prompt', 1, 1234);

    expect(result).toMatchObject({
      size: 'custom',
      promptTokens: estimateTokens('test prompt'),
      rounds: 1,
    });
    expect(result.tokPerSec).toBeGreaterThanOrEqual(0);
    expect(result.ttftMs).toBeGreaterThanOrEqual(0);
    expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.generationTokens).toBeGreaterThanOrEqual(0);
  });

  it('calls fetch the correct number of rounds', async () => {
    await runBenchmark('hi', 3, 5555);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('passes prompt and stream options to fetch', async () => {
    await runBenchmark('my prompt', 1, 42);
    const [, opts] = fetchSpy.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.messages[0].content).toBe('my prompt');
    expect(body.stream).toBe(true);
  });

  it('throws on invalid rounds', async () => {
    await expect(runBenchmark('hi', 0)).rejects.toThrow('rounds must be >= 1');
  });

  it('throws when vLLM returns non-200', async () => {
    fetchSpy.mockResolvedValueOnce(fakeResponse([], 500));
    await expect(runBenchmark('hi', 1)).rejects.toThrow('vLLM returned 500');
  });

  it('throws when response body is null', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: null,
    } as unknown as Response);
    await expect(runBenchmark('hi', 1)).rejects.toThrow('no body');
  });

  it('averages results across multiple rounds', async () => {
    // First round: 2 tokens, second round: 4 tokens
    fetchSpy
      .mockResolvedValueOnce(fakeResponse(['a', 'b']))
      .mockResolvedValueOnce(fakeResponse(['a', 'b', 'c', 'd']));

    const result = await runBenchmark('test', 2, 8080);
    expect(result.rounds).toBe(2);
    expect(result.generationTokens).toBe(3); // avg of 2 and 4 = 3
  });

  it('defaults port to 8000', async () => {
    await runBenchmark('hi', 1);
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('localhost:8000');
  });
});
