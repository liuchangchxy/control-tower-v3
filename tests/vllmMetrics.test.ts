import { describe, it, expect } from 'vitest';
import { parsePrometheusMetrics } from '../server/services/vllmMetrics.js';

describe('vLLM metrics parser', () => {
  it('parses Prometheus exposition format', () => {
    const input = `# HELP vllm:num_requests_running Number of running requests
# TYPE vllm:num_requests_running gauge
vllm:num_requests_running 2
# HELP vllm:kv_cache_usage_perc KV cache usage
# TYPE vllm:kv_cache_usage_perc gauge
vllm:kv_cache_usage_perc 0.75`;
    const result = parsePrometheusMetrics(input);
    expect(result.numRequestsRunning).toBe(2);
    expect(result.kvCacheUsagePerc).toBe(0.75);
  });

  it('parses TTFT histogram buckets and computes percentiles', () => {
    // Simulate cumulative buckets: 10 at 0.01s, 50 at 0.05s, 90 at 0.1s, 100 at +Inf
    const input = `# TYPE vllm:time_to_first_token_seconds histogram
vllm:time_to_first_token_seconds_bucket{le="0.01"} 10
vllm:time_to_first_token_seconds_bucket{le="0.05"} 50
vllm:time_to_first_token_seconds_bucket{le="0.1"} 90
vllm:time_to_first_token_seconds_bucket{le="+Inf"} 100
vllm:time_to_first_token_seconds_count 100
vllm:time_to_first_token_seconds_sum 7.5`;
    const result = parsePrometheusMetrics(input);
    expect(result.ttftP50).toBeGreaterThan(0);
    expect(result.ttftP90).toBeGreaterThan(0);
    expect(result.ttftP99).toBeGreaterThan(0);
    // p50 should be around 0.05 (at bucket 50/100)
    expect(result.ttftP50!).toBeCloseTo(0.05, 2);
    // p90 should be around 0.1 (at bucket 90/100)
    expect(result.ttftP90!).toBeCloseTo(0.1, 2);
  });

  it('parses ITL histogram without crashing', () => {
    const input = `# TYPE vllm:inter_token_latency_seconds histogram
vllm:inter_token_latency_seconds_bucket{le="0.001"} 5
vllm:inter_token_latency_seconds_bucket{le="0.01"} 80
vllm:inter_token_latency_seconds_bucket{le="0.1"} 99
vllm:inter_token_latency_seconds_bucket{le="+Inf"} 100
vllm:inter_token_latency_seconds_count 100
vllm:inter_token_latency_seconds_sum 2.0`;
    const result = parsePrometheusMetrics(input);
    // ITL doesn't map to ttft fields, just ensure no crash
    expect(result).toBeDefined();
  });

  it('parses e2e request latency histogram without crashing', () => {
    const input = `# TYPE vllm:e2e_request_latency_seconds histogram
vllm:e2e_request_latency_seconds_bucket{le="0.1"} 20
vllm:e2e_request_latency_seconds_bucket{le="1.0"} 95
vllm:e2e_request_latency_seconds_bucket{le="+Inf"} 100
vllm:e2e_request_latency_seconds_count 100
vllm:e2e_request_latency_seconds_sum 50.0`;
    const result = parsePrometheusMetrics(input);
    expect(result).toBeDefined();
  });

  it('handles missing histogram gracefully', () => {
    const input = `vllm:num_requests_running 3`;
    const result = parsePrometheusMetrics(input);
    expect(result.numRequestsRunning).toBe(3);
    expect(result.ttftP50).toBeUndefined();
    expect(result.ttftP90).toBeUndefined();
    expect(result.ttftP99).toBeUndefined();
  });
});
