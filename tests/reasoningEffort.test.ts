import { describe, expect, it } from 'vitest';
import { normalizeReasoningEffort } from '../server/app.js';

describe('reasoning effort compatibility', () => {
  it('maps Claude Code high to vLLM xhigh', () => {
    expect(normalizeReasoningEffort({ reasoning_effort: 'high', model: 'qwen' })).toEqual({
      reasoning_effort: 'xhigh',
      model: 'qwen',
    });
  });

  it('maps Anthropic output_config high to vLLM xhigh', () => {
    expect(normalizeReasoningEffort({ output_config: { effort: 'high', format: { type: 'json_schema' } } })).toEqual({
      output_config: { effort: 'xhigh', format: { type: 'json_schema' } },
    });
  });

  it('preserves supported values and non-object bodies', () => {
    expect(normalizeReasoningEffort({ reasoning_effort: 'low' })).toEqual({ reasoning_effort: 'low' });
    expect(normalizeReasoningEffort({ reasoning_effort: 'medium' })).toEqual({ reasoning_effort: 'medium' });
    expect(normalizeReasoningEffort({ reasoning_effort: 'xhigh' })).toEqual({ reasoning_effort: 'xhigh' });
    expect(normalizeReasoningEffort(null)).toBeNull();
    expect(normalizeReasoningEffort('high')).toBe('high');
  });
});
