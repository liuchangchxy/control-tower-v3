import { describe, expect, it } from 'vitest';
import { normalizeReasoningEffort } from '../server/app.js';

describe('reasoning effort compatibility', () => {
  it('maps Claude Code high to vLLM xhigh', () => {
    expect(normalizeReasoningEffort({ reasoning_effort: 'high', model: 'qwen' })).toEqual({
      reasoning_effort: 'xhigh',
      model: 'qwen',
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
