import { Fragment } from 'react';
import type { ProfileConfig } from '../types';

interface Props {
  oldConfig: Partial<ProfileConfig>;
  newConfig: Partial<ProfileConfig>;
  onClose: () => void;
}

/** Group labels: Core (6), Metadata (5), Advanced (54) */
const GROUPS: { label: string; keys: (keyof ProfileConfig)[] }[] = [
  {
    label: 'Core',
    keys: [
      'SERVED_NAME', 'MODEL_FAMILY', 'MODEL_VARIANT', 'GPU_UTIL',
      'MAX_MODEL_LEN', 'MTP_K',
    ],
  },
  {
    label: 'Metadata',
    keys: [
      'PROFILE_GROUP', 'MODEL_PATH', 'TP_SIZE', 'PORT', 'COMPATIBLE_MODES',
    ],
  },
  {
    label: 'Advanced',
    keys: [
      // Memory
      'KV_CACHE_DTYPE', 'MAX_BATCHED_TOKENS', 'MAX_NUM_SEQS',
      'GPU_MEMORY_UTILIZATION', 'CPU_OFFLOAD_GB', 'MAX_SWA_LEN', 'BLOCK_SIZE',
      // Scheduling
      'MAX_SCHEDULING_BATCH_TOKENS', 'SCHEDULER_POLICY', 'PREEMPTION_MODE',
      'SWAP_SPACE_GB', 'SWAP_SPACE_CPU', 'PRIORITY_FAIROFF_ENABLED',
      'PRIORITY_SCALEDOWN_ENABLED',
      // Attention
      'VLLM_INT8KV_FA_PREFILL', 'VLLM_INT8KV_FA_CONTINUATION_DEQUANT',
      'VLLM_INT8KV_FA_CASCADE_DEQUANT', 'VLLM_INT8KV_FA_CASCADE_TILE_TOKENS',
      'ATTENTION_BACKEND', 'PREFIX_CACHING',
      // Speculative Decoding
      'SPECULATIVE_MODEL', 'NUM_SPECULATIVE_TOKENS', 'DRAFT_TENSOR_PARALLEL_SIZE',
      'DRAFT_MODEL_TP_SIZE', 'SPECULATIVE_DECODE_METHOD',
      // Tool Calling
      'ENABLE_AUTO_TOOL_CHOICE', 'TOOL_CALL_PARSER', 'TOOL_CALL_PARSER_PATH',
      'TOOL_CALL_LIMIT',
      // Compilation
      'COMPILATION_CONFIG_JSON', 'ENABLE_PREFIX_CACHING_COMPILE',
      'VLLM_ATTENTION_BACKEND_COMPILE', 'TORCH_COMPILE_CACHE_DIR',
      'DISABLE_COMPILE_CACHE',
      // System
      'LANGUAGE_MODEL_ONLY', 'SKIP_MM_PROFILING', 'SYSTEM_PROMPT',
      'CHAT_TEMPLATE', 'TRUST_REMOTE_CODE',
      // Runtime
      'CUDA_VISIBLE_DEVICES', 'VLLM_HOST_IP', 'VLLM_RPC_BASE_URL',
      'RAY_ADDRESS', 'RAY_OBJECT_STORE_MEMORY',
      // Logging & API
      'VLLM_LOGGING_LEVEL', 'ENABLE_REQUEST_LOGGING', 'LOG_STATS',
      'ENABLE_PROMPT_TOKEN_COUNTS', 'API_KEY',
      // Misc
      'MULTI_VLM', 'VLM_INPUT_TYPE', 'SKIP_MODEL_INIT', 'LOAD_FORMAT',
      'QUANTIZATION',
    ],
  },
];

function val(v: string | number | undefined): string {
  if (v === undefined || v === '') return '(not set)';
  return String(v);
}

function rowStyle(oldVal: string, newVal: string): string {
  if (oldVal === newVal) return 'text-text-muted';
  return 'bg-yellow-900/20 text-yellow-300 font-medium';
}

export function ProfileDiff({ oldConfig, newConfig, onClose }: Props) {
  // Collect changed keys
  const allKeys = new Set<string>();
  for (const group of GROUPS) {
    for (const k of group.keys) allKeys.add(k as string);
  }
  const changedCount = [...allKeys].filter(k => {
    const o = oldConfig[k as keyof ProfileConfig];
    const n = newConfig[k as keyof ProfileConfig];
    return val(o) !== val(n);
  }).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text-primary">
          Profile Diff
          {changedCount > 0 && (
            <span className="ml-2 text-sm text-yellow-400 font-normal">
              {changedCount} change{changedCount !== 1 ? 's' : ''}
            </span>
          )}
        </h3>
        <button
          onClick={onClose}
          className="text-text-secondary hover:text-text-primary text-sm"
        >
          Close
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-3 text-text-secondary font-medium">Parameter</th>
              <th className="text-left py-2 px-3 text-text-secondary font-medium">Before</th>
              <th className="text-left py-2 px-3 text-text-secondary font-medium">After</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map(group => {
              const visibleKeys = group.keys.filter(k => {
                const o = oldConfig[k];
                const n = newConfig[k];
                return val(o) !== val(n);
              });
              if (visibleKeys.length === 0) return null;
              return (
                <Fragment key={group.label}>
                  <tr>
                    <td
                      colSpan={3}
                      className="py-2 px-3 text-xs text-text-muted uppercase tracking-wider border-t border-border/50"
                    >
                      {group.label}
                    </td>
                  </tr>
                  {visibleKeys.map(k => {
                    const ov = val(oldConfig[k]);
                    const nv = val(newConfig[k]);
                    return (
                      <tr key={String(k)} className={rowStyle(ov, nv)}>
                        <td className="py-1.5 px-3 font-mono text-xs">{String(k)}</td>
                        <td className="py-1.5 px-3 font-mono text-xs">{ov}</td>
                        <td className="py-1.5 px-3 font-mono text-xs">{nv}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
