import { type VLLMMetrics } from '../types.js';

// ── Prometheus histogram parser ──────────────────────────────────────────────

interface HistogramBucket {
  le: number;     // upper bound, +Inf = Infinity
  count: number;  // cumulative count
}

/**
 * Parse Prometheus histogram lines for a given metric prefix.
 * Expects lines like:
 *   vllm:time_to_first_token_seconds_bucket{le="0.001"} 123
 *   vllm:time_to_first_token_seconds_count 456
 *   vllm:time_to_first_token_seconds_sum 78.9
 */
function parseHistogram(
  lines: string[],
  prefix: string,
): { buckets: HistogramBucket[]; count: number; sum: number } | null {
  const buckets: HistogramBucket[] = [];
  let count = 0;
  let sum = 0;
  let found = false;

  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue;

    // Match bucket: vllm:..._bucket{le="0.001"} 123
    const bucketMatch = line.match(
      new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_bucket\\{le="([^"]+)"\\}\\s+(\\d+)`),
    );
    if (bucketMatch) {
      found = true;
      const le = bucketMatch[1] === '+Inf' ? Infinity : parseFloat(bucketMatch[1]);
      const countVal = parseInt(bucketMatch[2], 10);
      buckets.push({ le, count: countVal });
      continue;
    }

    // Match count: vllm:..._count 456
    const countMatch = line.match(
      new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_count\\s+(\\d+)`),
    );
    if (countMatch) {
      found = true;
      count = parseInt(countMatch[1], 10);
      continue;
    }

    // Match sum: vllm:..._sum 78.9
    const sumMatch = line.match(
      new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_sum\\s+(.+)$`),
    );
    if (sumMatch) {
      found = true;
      sum = parseFloat(sumMatch[1]);
    }
  }

  if (!found || buckets.length === 0) return null;

  // Sort buckets by le ascending
  buckets.sort((a, b) => a.le - b.le);

  return { buckets, count, sum };
}

/**
 * Compute quantile from sorted histogram buckets using standard linear interpolation.
 * Returns 0 if no data.
 */
function computeQuantile(
  buckets: HistogramBucket[],
  totalCount: number,
  quantile: number,
): number {
  if (totalCount === 0 || buckets.length === 0) return 0;

  const target = quantile * totalCount;

  // Find the two buckets that bracket the target count
  let prevCount = 0;
  for (const bucket of buckets) {
    if (bucket.count >= target) {
      // Linear interpolation within this bucket
      const range = bucket.count - prevCount;
      if (range === 0) return bucket.le === Infinity ? buckets[buckets.length - 2]?.le ?? 0 : bucket.le;
      const fraction = (target - prevCount) / range;
      const prevLe = prevCount === 0 ? 0 : buckets[buckets.indexOf(bucket) - 1]?.le ?? 0;
      return prevLe + fraction * (bucket.le - prevLe);
    }
    prevCount = bucket.count;
  }

  // Target exceeds all buckets — return last finite le
  const lastFinite = buckets.filter((b) => b.le !== Infinity).pop();
  return lastFinite?.le ?? 0;
}

// ── Prometheus parser ───────────────────────────────────────────────────────

export function parsePrometheusMetrics(raw: string): Partial<VLLMMetrics> {
  const result: Partial<VLLMMetrics> = {};
  const lines = raw.split('\n');

  // Scalar gauges
  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue;
    const match = line.match(/^([^\s{}]+)\s+(.+)$/);
    if (!match) continue;
    const [, name, value] = match;
    const num = parseFloat(value);
    if (isNaN(num)) continue;
    switch (name) {
      case 'vllm:num_requests_running': result.numRequestsRunning = num; break;
      case 'vllm:num_requests_waiting': result.numRequestsWaiting = num; break;
      case 'vllm:kv_cache_usage_perc': result.kvCacheUsagePerc = num; break;
      case 'vllm:prompt_tokens': result.promptTokens = num; break;
      case 'vllm:generation_tokens': result.generationTokens = num; break;
      case 'vllm:num_preemptions': result.numPreemptions = num; break;
      case "vllm:prefix_cache_hit_rate": result.prefixCacheHitRate = num; break;
    }
  }

  // Histogram metrics
  const histPrefixes = [
    { prefix: 'vllm:time_to_first_token_seconds', key: 'ttft' },
    { prefix: 'vllm:inter_token_latency_seconds', key: 'itl' },
    { prefix: 'vllm:e2e_request_latency_seconds', key: 'e2e' },
  ];

  for (const { prefix, key } of histPrefixes) {
    const hist = parseHistogram(lines, prefix);
    if (hist) {
      const p50 = computeQuantile(hist.buckets, hist.count, 0.5);
      const p90 = computeQuantile(hist.buckets, hist.count, 0.9);
      const p99 = computeQuantile(hist.buckets, hist.count, 0.99);
      if (key === 'ttft') {
        result.ttftP50 = p50;
        result.ttftP90 = p90;
        result.ttftP99 = p99;
      }
      // ITL and e2e can be added to VLLMMetrics later if needed
    }
  }

  return result;
}

// ── Throughput helper ───────────────────────────────────────────────────────

let lastGenTokens = 0;
let lastTimestamp = 0;

function computeTokPerSec(parsed: Partial<VLLMMetrics>, now: number): number {
  const genTokens = parsed.generationTokens ?? 0;
  if (lastTimestamp === 0) {
    lastGenTokens = genTokens;
    lastTimestamp = now;
    return 0;
  }
  const elapsed = (now - lastTimestamp) / 1000;
  const deltaTokens = genTokens - lastGenTokens;
  lastGenTokens = genTokens;
  lastTimestamp = now;
  if (elapsed <= 0 || deltaTokens < 0) return 0;
  return deltaTokens / elapsed;
}

// ── Scraping lifecycle ─────────────────────────────────────────────────────

const METRICS_HISTORY_SIZE = 150; // 5 min at 2s intervals
let metricsHistory: VLLMMetrics[] = [];
let scrapingInterval: ReturnType<typeof setInterval> | null = null;

export function startMetricsScraping(port: number = 8000): void {
  if (scrapingInterval) return;
  scrapingInterval = setInterval(async () => {
    try {
      const res = await fetch(`http://localhost:${port}/metrics`);
      const raw = await res.text();
      const parsed = parsePrometheusMetrics(raw);
      const now = Date.now();
      const kvCacheUsagePerc = parsed.kvCacheUsagePerc ?? 0;
      const metric: VLLMMetrics = {
        numRequestsRunning: parsed.numRequestsRunning ?? 0,
        numRequestsWaiting: parsed.numRequestsWaiting ?? 0,
        kvCacheUsagePerc,
        kvCacheWarning: kvCacheUsagePerc > 0.85,
        promptTokens: parsed.promptTokens ?? 0,
        generationTokens: parsed.generationTokens ?? 0,
        tokPerSec: computeTokPerSec(parsed, now),
        ttftP50: parsed.ttftP50 ?? 0,
        ttftP90: parsed.ttftP90 ?? 0,
        ttftP99: parsed.ttftP99 ?? 0,
        prefixCacheHitRate: parsed.prefixCacheHitRate ?? 0,
        numPreemptions: parsed.numPreemptions ?? 0,
        timestamp: now,
      };
      metricsHistory.push(metric);
      if (metricsHistory.length > METRICS_HISTORY_SIZE) metricsHistory.shift();
    } catch (_err) {
      // vLLM not ready yet, skip
    }
  }, 2000);
}

export function stopMetricsScraping(): void {
  if (scrapingInterval) {
    clearInterval(scrapingInterval);
    scrapingInterval = null;
  }
}

export function getLatestMetrics(): VLLMMetrics | null {
  return metricsHistory.length > 0 ? metricsHistory[metricsHistory.length - 1] : null;
}

export function getMetricsHistory(): VLLMMetrics[] {
  return [...metricsHistory];
}
