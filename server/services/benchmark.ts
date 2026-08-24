import { type BenchmarkResult } from '../types.js';
import { getStatus } from './processManager.js';

// ── Standard benchmark presets (input_tokens / output_tokens) ────────────────

export interface BenchmarkPreset {
  id: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  description: string;
}

export const BENCHMARK_PRESETS: BenchmarkPreset[] = [
  { id: 'quick',   label: 'Quick',   inputTokens: 128,  outputTokens: 64,   description: '128in/64out — 短问答' },
  { id: 'chat',    label: 'Chat',    inputTokens: 512,  outputTokens: 256,  description: '512in/256out — 对话场景' },
  { id: 'summary', label: 'Summary', inputTokens: 2048, outputTokens: 512,  description: '2048in/512out — 长文摘要' },
  { id: 'longgen', label: 'LongGen', inputTokens: 1024, outputTokens: 2048, description: '1024in/2048out — 长文生成' },
  { id: 'stress',  label: 'Stress',  inputTokens: 4096, outputTokens: 1024, description: '4096in/1024out — 压力测试' },
];

// Legacy prompts for backward compatibility
export const BENCHMARK_PROMPTS: Record<string, string> = {
  short: 'What is 2+2?',
  medium: 'Explain the concept of quantum computing in detail, covering superposition, entanglement, and potential applications.',
  long: `You are a technical writer producing a comprehensive reference guide. Write a detailed explanation of how modern large language models work, covering transformers, training, quantization, inference optimization, multi-GPU serving, evaluation benchmarks, and deployment considerations. Include concrete examples and practical advice.`,
};

// ── Random prompt generation ─────────────────────────────────────────────────

const WORDS = [
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could', 'of', 'in', 'to',
  'for', 'with', 'on', 'at', 'from', 'by', 'about', 'as', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between',
  'this', 'that', 'these', 'those', 'it', 'its', 'he', 'she', 'they',
  'we', 'you', 'I', 'me', 'him', 'her', 'them', 'us', 'my', 'your',
  'his', 'our', 'their', 'what', 'which', 'who', 'when', 'where', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 'just', 'because', 'but', 'and', 'or', 'if', 'while',
  'technology', 'system', 'data', 'process', 'model', 'network', 'algorithm',
  'function', 'method', 'approach', 'analysis', 'development', 'research',
  'information', 'application', 'implementation', 'performance', 'optimization',
  'machine', 'learning', 'artificial', 'intelligence', 'neural', 'deep',
  'training', 'inference', 'parameter', 'layer', 'attention', 'transformer',
];

/** Generate a prompt with approximately the given number of tokens. */
export function generatePrompt(inputTokens: number): string {
  const wordCount = Math.ceil(inputTokens / 1.3);
  const parts: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    parts.push(WORDS[Math.floor(Math.random() * WORDS.length)]);
  }
  return parts.join(' ');
}

/** Rough token count estimate (~4 chars per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Detailed metrics ─────────────────────────────────────────────────────────

export interface DetailedBenchmarkResult {
  presetId: string;
  inputTokens: number;
  outputTokensRequested: number;

  // Core metrics (vLLM standard)
  ttftMs: number;
  tpotMs: number;
  e2eLatencyMs: number;
  throughputTokPerSec: number;

  actualOutputTokens: number;
  promptTokens: number;

  // ITL distribution
  itl: {
    meanMs: number;
    p50Ms: number;
    p90Ms: number;
    p99Ms: number;
    maxMs: number;
  };

  rounds: number;
  perRound: Array<{
    ttftMs: number;
    tpotMs: number;
    e2eLatencyMs: number;
    outputTokens: number;
    itlSamples: number[];
  }>;
}

// ── High-resolution timer ────────────────────────────────────────────────────

function perfCounter(): number {
  const hr = process.hrtime();
  return hr[0] + hr[1] / 1e9;
}

// ── SSE streaming with timing ────────────────────────────────────────────────

interface StreamingMetrics {
  ttftMs: number;
  itlMs: number[];
  totalTokens: number;
  e2eLatencyMs: number;
  generatedText: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function streamWithTiming(
  port: number,
  model: string,
  prompt: string,
  maxTokens: number,
): Promise<StreamingMetrics> {
  const start = perfCounter();

  const response = await fetch(`http://localhost:${port}/v1/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(300_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      ignore_eos: true,
      temperature: 0,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });

  if (!response.ok) {
    throw new Error(`vLLM returned ${response.status}: ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error('vLLM response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ttftMs = 0;
  let lastTokenTime = start;
  const itlMs: number[] = [];
  let totalTokens = 0;
  let generatedText = '';
  let usage: StreamingMetrics['usage'];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;

        try {
          const parsed = JSON.parse(data);
          if (parsed.usage) usage = parsed.usage;
          if (parsed.usage?.completion_tokens !== undefined) totalTokens = parsed.usage.completion_tokens;
          const content = parsed.choices?.[0]?.delta?.content;
          if (typeof content !== 'string' || content.length === 0) continue;

          const now = perfCounter();
          totalTokens++;

          if (ttftMs === 0) {
            ttftMs = (now - start) * 1000;
          } else {
            itlMs.push((now - lastTokenTime) * 1000);
          }
          lastTokenTime = now;
          generatedText += content;
        } catch {
          // skip malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const e2eLatencyMs = (perfCounter() - start) * 1000;
  return { ttftMs, itlMs, totalTokens, e2eLatencyMs, generatedText, usage };
}

// ── Percentile helper ────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ── Warmup ──────────────────────────────────────────────────────────────────

export async function runWarmup(port: number = 8000): Promise<void> {
  try {
    const resp = await fetch(`http://localhost:${port}/v1/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: getStatus().servedName || 'default',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false,
      }),
    });
    await resp.text();
  } catch {
    // best-effort; ignore failures
  }
}

// ── Main benchmark runner ────────────────────────────────────────────────────

export async function runBenchmark(params: {
  presetId?: string;
  inputTokens?: number;
  outputTokens?: number;
  customPrompt?: string;
  rounds?: number;
  port?: number;
}): Promise<DetailedBenchmarkResult> {
  const {
    presetId = 'chat',
    inputTokens: inputTokensParam,
    outputTokens: outputTokensParam,
    customPrompt,
    rounds = 1,
    port = 8000,
  } = params;

  const preset = BENCHMARK_PRESETS.find(p => p.id === presetId);
  const inputTokens = inputTokensParam ?? preset?.inputTokens ?? 512;
  const outputTokens = outputTokensParam ?? preset?.outputTokens ?? 256;
  const model = getStatus().servedName || 'default';
  const prompt = customPrompt || generatePrompt(inputTokens);

  const perRound: DetailedBenchmarkResult['perRound'] = [];
  const usagePromptTokens: number[] = [];

  for (let i = 0; i < rounds; i++) {
    const m = await streamWithTiming(port, model, prompt, outputTokens);
    if (m.usage?.prompt_tokens !== undefined) usagePromptTokens.push(m.usage.prompt_tokens);
    perRound.push({
      ttftMs: m.ttftMs,
      tpotMs: m.totalTokens > 1
        ? (m.e2eLatencyMs - m.ttftMs) / (m.totalTokens - 1)
        : 0,
      e2eLatencyMs: m.e2eLatencyMs,
      outputTokens: m.totalTokens,
      itlSamples: m.itlMs,
    });
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const ttftMs = avg(perRound.map(r => r.ttftMs));
  const e2eLatencyMs = avg(perRound.map(r => r.e2eLatencyMs));
  const actualOutputTokens = Math.round(avg(perRound.map(r => r.outputTokens)));

  const allItl = perRound.flatMap(r => r.itlSamples);
  const sortedItl = [...allItl].sort((a, b) => a - b);

  const tpotMs = actualOutputTokens > 1
    ? (e2eLatencyMs - ttftMs) / (actualOutputTokens - 1)
    : 0;
  const throughputTokPerSec = e2eLatencyMs > 0
    ? (actualOutputTokens / (e2eLatencyMs / 1000))
    : 0;

  return {
    presetId: preset?.id ?? 'custom',
    inputTokens,
    outputTokensRequested: outputTokens,
    ttftMs: Math.round(ttftMs * 10) / 10,
    tpotMs: Math.round(tpotMs * 10) / 10,
    e2eLatencyMs: Math.round(e2eLatencyMs),
    throughputTokPerSec: Math.round(throughputTokPerSec * 10) / 10,
    actualOutputTokens,
    promptTokens: usagePromptTokens.length > 0 ? Math.round(avg(usagePromptTokens)) : estimateTokens(prompt),
    rounds,
    perRound,
    itl: {
      meanMs: sortedItl.length > 0 ? Math.round(avg(sortedItl) * 10) / 10 : 0,
      p50Ms: Math.round(percentile(sortedItl, 50) * 10) / 10,
      p90Ms: Math.round(percentile(sortedItl, 90) * 10) / 10,
      p99Ms: Math.round(percentile(sortedItl, 99) * 10) / 10,
      maxMs: sortedItl.length > 0 ? Math.round(sortedItl[sortedItl.length - 1] * 10) / 10 : 0,
    },
  };
}

// ── Legacy runner (backward compat) ──────────────────────────────────────────

export async function runBenchmarkLegacy(
  prompt: string,
  rounds: number,
  port: number = 8000,
): Promise<BenchmarkResult> {
  const result = await runBenchmark({
    customPrompt: prompt,
    outputTokens: 512,
    rounds,
    port,
  });

  return {
    size: 'custom',
    promptTokens: result.promptTokens,
    generationTokens: result.actualOutputTokens,
    tokPerSec: result.throughputTokPerSec,
    ttftMs: result.ttftMs,
    totalTimeMs: result.e2eLatencyMs,
    rounds: result.rounds,
  };
}
