import { useState } from 'react';
import { Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './common/Button';
import { Card } from './common/Card';
import { Spinner } from './common/Spinner';
import { useToast } from './common/Toast';
import { useCreateProfile, useUpdateProfile, useValidateProfile } from '../hooks/useProfiles';
import type { ProfileConfig } from '../types';

interface Props {
  mode: 'create' | 'edit';
  initialName?: string;
  initialConfig?: Partial<ProfileConfig>;
  editPath?: string;
}

// ── Field definitions grouped by category ─────────────────────────────────────

type FieldDef = {
  key: keyof ProfileConfig;
  label: string;
  type: 'text' | 'number' | 'select' | 'textarea' | 'boolean';
  options?: { label: string; value: string | number }[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  description?: string;
};

const CORE_FIELDS: FieldDef[] = [
  { key: 'SERVED_NAME', label: 'Served Name', type: 'text', placeholder: 'e.g. qwen36-27b-int4', description: 'Name used by the model server' },
  { key: 'MODEL_FAMILY', label: 'Model Family', type: 'select', options: [
    { label: 'Qwen', value: 'qwen' },
    { label: 'Llama', value: 'llama' },
    { label: 'Mistral', value: 'mistral' },
    { label: 'DeepSeek', value: 'deepseek' },
    { label: 'Other', value: 'other' },
  ]},
  { key: 'MODEL_VARIANT', label: 'Model Variant', type: 'select', options: [
    { label: 'int4', value: 'int4' },
    { label: 'fp8', value: 'fp8' },
  ]},
  { key: 'GPU_UTIL', label: 'GPU Utilization', type: 'number', min: 0.5, max: 0.99, step: 0.01, description: 'Fraction of GPU memory for KV cache' },
  { key: 'MAX_MODEL_LEN', label: 'Max Model Length', type: 'select', options: [
    { label: '16K', value: 16384 },
    { label: '32K', value: 32768 },
    { label: '64K', value: 65536 },
    { label: '128K', value: 131072 },
    { label: '256K', value: 262144 },
  ]},
  { key: 'MTP_K', label: 'MTP K (Speculative)', type: 'number', min: 0, max: 10, step: 1, description: '0 = disabled' },
];

const METADATA_FIELDS: FieldDef[] = [
  { key: 'PROFILE_GROUP', label: 'Profile Group', type: 'text', placeholder: 'e.g. qwen36-27b-int4' },
  { key: 'MODEL_PATH', label: 'Model Path', type: 'text', placeholder: '/path/to/model' },
  { key: 'TP_SIZE', label: 'Tensor Parallel Size', type: 'number', min: 1, max: 8, step: 1, description: 'Default: 2' },
  { key: 'PORT', label: 'Port', type: 'number', min: 1, max: 65535, step: 1, description: 'Default: 8000' },
  { key: 'COMPATIBLE_MODES', label: 'Compatible Modes', type: 'select', options: [
    { label: 'normal', value: 'normal' },
    { label: 'mm (multimodal)', value: 'mm' },
    { label: 'all', value: 'all' },
  ]},
];

const ADVANCED_FIELDS: FieldDef[] = [
  // Memory
  { key: 'KV_CACHE_DTYPE', label: 'KV Cache Dtype', type: 'select', options: [
    { label: 'auto', value: 'auto' },
    { label: 'int8_per_token_head', value: 'int8_per_token_head' },
    { label: 'fp8', value: 'fp8' },
    { label: 'fp16', value: 'fp16' },
  ]},
  { key: 'MAX_BATCHED_TOKENS', label: 'Max Batched Tokens', type: 'number', min: 512, max: 65536, step: 256 },
  { key: 'MAX_NUM_SEQS', label: 'Max Num Seqs', type: 'number', min: 1, max: 2048, step: 1 },
  { key: 'GPU_MEMORY_UTILIZATION', label: 'GPU Memory Utilization', type: 'number', min: 0.0, max: 1.0, step: 0.01, placeholder: '0.9 (default)' },
  { key: 'CPU_OFFLOAD_GB', label: 'CPU Offload (GB)', type: 'number', min: 0, max: 1000, step: 1, placeholder: '0 (disabled)' },
  { key: 'MAX_SWA_LEN', label: 'Max SWA Length', type: 'number', min: 1, max: 1048576, step: 1 },
  { key: 'BLOCK_SIZE', label: 'Block Size', type: 'number', min: 1, max: 4096, step: 1, placeholder: '16 (default)' },

  // Scheduling
  { key: 'MAX_SCHEDULING_BATCH_TOKENS', label: 'Max Scheduling Batch Tokens', type: 'number', min: 1, max: 1048576, step: 256 },
  { key: 'SCHEDULER_POLICY', label: 'Scheduler Policy', type: 'select', options: [
    { label: '(not set)', value: '' },
    { label: 'fcfs', value: 'fcfs' },
    { label: 'priority', value: 'priority' },
  ]},
  { key: 'PREEMPTION_MODE', label: 'Preemption Mode', type: 'select', options: [
    { label: '(not set)', value: '' },
    { label: 'swap', value: 'swap' },
    { label: 'recompute', value: 'recompute' },
  ]},
  { key: 'SWAP_SPACE_GB', label: 'Swap Space (GB)', type: 'number', min: 0, max: 1000, step: 1 },
  { key: 'SWAP_SPACE_CPU', label: 'Swap Space CPU (GB)', type: 'number', min: 0, max: 1000, step: 1 },
  { key: 'PRIORITY_FAIROFF_ENABLED', label: 'Priority Fairoff', type: 'boolean' },
  { key: 'PRIORITY_SCALEDOWN_ENABLED', label: 'Priority Scaledown', type: 'boolean' },

  // Attention
  { key: 'VLLM_INT8KV_FA_PREFILL', label: 'INT8KV FA Prefill', type: 'boolean' },
  { key: 'VLLM_INT8KV_FA_CONTINUATION_DEQUANT', label: 'INT8KV FA Continuation Dequant', type: 'boolean' },
  { key: 'VLLM_INT8KV_FA_CASCADE_DEQUANT', label: 'INT8KV FA Cascade Dequant', type: 'boolean' },
  { key: 'VLLM_INT8KV_FA_CASCADE_TILE_TOKENS', label: 'INT8KV FA Cascade Tile Tokens', type: 'number', min: 1, max: 65536, step: 1 },
  { key: 'ATTENTION_BACKEND', label: 'Attention Backend', type: 'select', options: [
    { label: '(not set)', value: '' },
    { label: 'FLASHINFER', value: 'FLASHINFER' },
    { label: 'XFORMERS', value: 'XFORMERS' },
    { label: 'TORCH_SDPA', value: 'TORCH_SDPA' },
    { label: 'FLASHATTN', value: 'FLASHATTN' },
  ]},
  { key: 'PREFIX_CACHING', label: 'Prefix Caching', type: 'boolean' },

  // Speculative Decoding
  { key: 'SPECULATIVE_MODEL', label: 'Speculative Model', type: 'text', placeholder: 'path to draft model' },
  { key: 'NUM_SPECULATIVE_TOKENS', label: 'Num Speculative Tokens', type: 'number', min: 1, max: 10, step: 1 },
  { key: 'DRAFT_TENSOR_PARALLEL_SIZE', label: 'Draft TP Size', type: 'number', min: 1, max: 8, step: 1 },
  { key: 'DRAFT_MODEL_TP_SIZE', label: 'Draft Model TP Size', type: 'number', min: 1, max: 8, step: 1 },
  { key: 'SPECULATIVE_DECODE_METHOD', label: 'Speculative Decode Method', type: 'select', options: [
    { label: '(not set)', value: '' },
    { label: 'ngram', value: 'ngram' },
    { label: 'eagle', value: 'eagle' },
    { label: 'medusa', value: 'medusa' },
  ]},

  // Tool Calling
  { key: 'ENABLE_AUTO_TOOL_CHOICE', label: 'Enable Auto Tool Choice', type: 'boolean' },
  { key: 'TOOL_CALL_PARSER', label: 'Tool Call Parser', type: 'select', options: [
    { label: 'hermes', value: 'hermes' },
    { label: 'auto', value: 'auto' },
    { label: 'llama3_json', value: 'llama3_json' },
    { label: 'mistral', value: 'mistral' },
  ]},
  { key: 'TOOL_CALL_PARSER_PATH', label: 'Tool Call Parser Path', type: 'text', placeholder: 'custom parser module path' },
  { key: 'TOOL_CALL_LIMIT', label: 'Tool Call Limit', type: 'number', min: 0, max: 100, step: 1 },

  // Compilation
  { key: 'COMPILATION_CONFIG_JSON', label: 'Compilation Config (JSON)', type: 'textarea', placeholder: '{"splitting_ops": [...], ...}' },
  { key: 'ENABLE_PREFIX_CACHING_COMPILE', label: 'Enable Prefix Caching Compile', type: 'boolean' },
  { key: 'VLLM_ATTENTION_BACKEND_COMPILE', label: 'Attention Backend Compile', type: 'select', options: [
    { label: '(not set)', value: '' },
    { label: 'FLASHINFER', value: 'FLASHINFER' },
    { label: 'XFORMERS', value: 'XFORMERS' },
    { label: 'TORCH_SDPA', value: 'TORCH_SDPA' },
  ]},
  { key: 'TORCH_COMPILE_CACHE_DIR', label: 'Torch Compile Cache Dir', type: 'text', placeholder: '/tmp/torch_compile_cache' },
  { key: 'DISABLE_COMPILE_CACHE', label: 'Disable Compile Cache', type: 'boolean' },

  // System
  { key: 'LANGUAGE_MODEL_ONLY', label: 'Language Model Only', type: 'boolean' },
  { key: 'SKIP_MM_PROFILING', label: 'Skip MM Profiling', type: 'boolean' },
  { key: 'SYSTEM_PROMPT', label: 'System Prompt', type: 'textarea', placeholder: 'Custom system prompt for the model' },
  { key: 'CHAT_TEMPLATE', label: 'Chat Template', type: 'text', placeholder: 'Jinja template string or path' },
  { key: 'TRUST_REMOTE_CODE', label: 'Trust Remote Code', type: 'boolean' },

  // Runtime
  { key: 'CUDA_VISIBLE_DEVICES', label: 'CUDA Visible Devices', type: 'text', placeholder: '0,1,2,3' },
  { key: 'VLLM_HOST_IP', label: 'VLLM Host IP', type: 'text', placeholder: '0.0.0.0' },
  { key: 'VLLM_RPC_BASE_URL', label: 'VLLM RPC Base URL', type: 'text', placeholder: 'http://...' },
  { key: 'RAY_ADDRESS', label: 'Ray Address', type: 'text', placeholder: 'auto' },
  { key: 'RAY_OBJECT_STORE_MEMORY', label: 'Ray Object Store Memory', type: 'number', min: 0, max: 999999999, step: 1 },

  // Logging & API
  { key: 'VLLM_LOGGING_LEVEL', label: 'Logging Level', type: 'select', options: [
    { label: '(not set)', value: '' },
    { label: 'DEBUG', value: 'DEBUG' },
    { label: 'INFO', value: 'INFO' },
    { label: 'WARNING', value: 'WARNING' },
    { label: 'ERROR', value: 'ERROR' },
  ]},
  { key: 'ENABLE_REQUEST_LOGGING', label: 'Enable Request Logging', type: 'boolean' },
  { key: 'LOG_STATS', label: 'Log Stats', type: 'boolean' },
  { key: 'ENABLE_PROMPT_TOKEN_COUNTS', label: 'Enable Prompt Token Counts', type: 'boolean' },
  { key: 'API_KEY', label: 'API Key', type: 'text', placeholder: 'sk-...' },

  // Misc
  { key: 'MULTI_VLM', label: 'Multi VLM', type: 'boolean' },
  { key: 'VLM_INPUT_TYPE', label: 'VLM Input Type', type: 'select', options: [
    { label: '(not set)', value: '' },
    { label: 'default', value: 'default' },
    { label: 'interleaved', value: 'interleaved' },
  ]},
  { key: 'SKIP_MODEL_INIT', label: 'Skip Model Init', type: 'boolean' },
  { key: 'LOAD_FORMAT', label: 'Load Format', type: 'select', options: [
    { label: '(not set)', value: '' },
    { label: 'auto', value: 'auto' },
    { label: 'safetensors', value: 'safetensors' },
    { label: 'pt', value: 'pt' },
    { label: 'npz', value: 'npz' },
    { label: 'bitsandbytes', value: 'bitsandbytes' },
    { label: 'gguf', value: 'gguf' },
  ]},
  { key: 'QUANTIZATION', label: 'Quantization', type: 'select', options: [
    { label: '(not set)', value: '' },
    { label: 'auto', value: 'auto' },
    { label: 'fp8', value: 'fp8' },
    { label: 'gptq', value: 'gptq' },
    { label: 'awq', value: 'awq' },
    { label: 'squeezellm', value: 'squeezellm' },
    { label: 'bitsandbytes', value: 'bitsandbytes' },
  ]},
];

const ALL_GROUPS = [
  { label: 'Core', fields: CORE_FIELDS },
  { label: 'Metadata', fields: METADATA_FIELDS },
  { label: 'Advanced', fields: ADVANCED_FIELDS },
];

const DEFAULT_CONFIG: Partial<ProfileConfig> = {
  MODEL_FAMILY: 'qwen',
  PROFILE_GROUP: 'qwen36-27b-int4',
  MODEL_VARIANT: 'int4',
  SERVED_NAME: '',
  KV_CACHE_DTYPE: 'int8_per_token_head',
  GPU_UTIL: 0.88,
  MAX_MODEL_LEN: 256000,
  MAX_BATCHED_TOKENS: 2048,
  MAX_NUM_SEQS: 2,
  MTP_K: 0,
  VLLM_INT8KV_FA_PREFILL: 1,
  VLLM_INT8KV_FA_CONTINUATION_DEQUANT: 1,
  VLLM_INT8KV_FA_CASCADE_DEQUANT: 1,
  COMPATIBLE_MODES: 'normal',
  LANGUAGE_MODEL_ONLY: 1,
  SKIP_MM_PROFILING: 1,
  ENABLE_AUTO_TOOL_CHOICE: 1,
  TOOL_CALL_PARSER: 'hermes',
};

export function ProfileForm({ mode, initialName = '', initialConfig, editPath }: Props) {
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [config, setConfig] = useState<Partial<ProfileConfig>>(
    initialConfig ?? DEFAULT_CONFIG
  );
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    Core: false,
    Metadata: true,
    Advanced: true,
  });

  const createMut = useCreateProfile();
  const updateMut = useUpdateProfile();
  const validateMut = useValidateProfile();
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);

  const setField = (key: keyof ProfileConfig, value: unknown) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const toggleGroup = (label: string) => {
    setCollapsed(prev => ({ ...prev, [label]: !prev[label] }));
  };

  const handleSubmit = async () => {
    if (mode === 'create') {
      const trimmedName = name.trim();
      if (!trimmedName || /[/\\:*?"<>|]/.test(trimmedName)) {
        toast.addToast('error', 'Profile name contains invalid characters');
        return;
      }
      try {
        await createMut.mutateAsync({ name: trimmedName, config });
        navigate('/profiles');
      } catch (err) {
        // Error is handled by React Query error state
      }
    } else if (editPath) {
      try {
        await updateMut.mutateAsync({ path: editPath, config });
        navigate('/profiles');
      } catch (err) {
        // Error is handled by React Query error state
      }
    }
  };

  const handleValidate = async () => {
    setValidationErrors(null);
    try {
      const result = await validateMut.mutateAsync(config);
      if (result.valid) {
        setValidationErrors([]);
      } else {
        setValidationErrors(result.errors);
      }
    } catch (err) {
      setValidationErrors([(err as Error).message]);
    }
  };

  const renderField = (field: FieldDef) => {
    const value = config[field.key];
    const isBool = field.type === 'boolean';
    const isEnabled = isBool && (value === 1 || value === true);
    const displayValue = isBool
      ? isEnabled
        ? '1'
        : '0'
      : value ?? '';

    return (
      <div key={String(field.key)} className="flex flex-col gap-1">
        <label className="text-xs text-text-secondary">
          {field.label}
          {field.description && (
            <span className="ml-1 text-text-muted">{field.description}</span>
          )}
        </label>
        {field.type === 'boolean' ? (
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 accent-accent bg-bg-tertiary border border-border rounded"
              checked={isEnabled}
              onChange={e => setField(field.key, e.target.checked ? 1 : 0)}
            />
            <span className="text-sm text-text-secondary">{isEnabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        ) : field.type === 'select' ? (
          <select
            className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5 font-mono text-sm"
            value={String(displayValue)}
            onChange={e => setField(field.key, e.target.value)}
          >
            {field.options?.map(opt => (
              <option key={String(opt.value)} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        ) : field.type === 'textarea' ? (
          <textarea
            className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5 font-mono text-sm min-h-[60px]"
            value={String(displayValue)}
            onChange={e => setField(field.key, e.target.value)}
            placeholder={field.placeholder}
          />
        ) : (
          <input
            type={field.type === 'number' ? 'number' : 'text'}
            step={field.step}
            min={field.min}
            max={field.max}
            className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5 font-mono text-sm"
            value={displayValue}
            onChange={e => {
              const raw = e.target.value;
              const v = field.type === 'number' ? parseFloat(raw) : raw;
              setField(field.key, field.type === 'number' && (raw === '' || isNaN(v as number)) ? undefined : v);
            }}
            placeholder={field.placeholder}
          />
        )}
      </div>
    );
  };

  const isPending = createMut.isPending || updateMut.isPending || validateMut.isPending;

  return (
    <Card>
      <div className="space-y-4" onChange={() => {
        if (createMut.isError) createMut.reset();
        if (updateMut.isError) updateMut.reset();
      }}>
        {/* Profile name (create mode) */}
        {mode === 'create' && (
          <div>
            <label className="block text-sm text-text-secondary mb-1">Profile Name</label>
            <input
              type="text"
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5 font-mono"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="my-profile"
            />
          </div>
        )}

        {/* Field groups */}
        {ALL_GROUPS.map(group => (
          <div key={group.label} className="border border-border rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => toggleGroup(group.label)}
              aria-expanded={!collapsed[group.label]}
              aria-controls={`group-${group.label}`}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-bg-tertiary hover:bg-bg-hover transition-colors"
            >
              <span className="text-sm font-medium text-text-primary">
                {group.label}
                <span className="ml-2 text-xs text-text-muted">({group.fields.length})</span>
              </span>
              <span className="text-text-muted text-xs">
                {collapsed[group.label] ? 'expand' : 'collapse'}
              </span>
            </button>
            {!collapsed[group.label] && (
              <div id={`group-${group.label}`} className="p-4 grid grid-cols-2 gap-3">
                {group.fields.map(field => renderField(field))}
              </div>
            )}
          </div>
        ))}

        {/* .env preview */}
        <div>
          <label className="block text-sm text-text-secondary mb-1">.env Preview</label>
          <pre className="bg-bg-tertiary border border-border rounded p-3 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto">
{Object.entries(config)
  .filter(([, v]) => v !== undefined)
  .map(([k, v]) => `${k}=${v}`)
  .join('\n')}
          </pre>
        </div>

        {/* Validation result */}
        {validationErrors !== null && (
          <div role="alert" className={`rounded-lg p-3 text-sm ${validationErrors.length === 0 ? 'bg-green-900/20 text-green-400 border border-green-700/50' : 'bg-red-900/20 text-red-400 border border-red-700/50'}`}>
            {validationErrors.length === 0 ? (
              <div className="flex items-center gap-2">
                <span>&#10003;</span> Configuration is valid. Ready to save.
              </div>
            ) : (
              <div>
                <div className="font-medium mb-1">Validation errors ({validationErrors.length}):</div>
                <ul className="list-disc list-inside space-y-0.5">
                  {validationErrors.map((err, i) => (
                    <li key={i} className="text-red-300">{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Mutations error */}
        {(createMut.error || updateMut.error) && (
          <div className="text-red-400 text-sm">
            {((createMut.error ?? updateMut.error) as Error).message}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => navigate('/profiles')}>Cancel</Button>
          <Button
            variant="secondary"
            onClick={handleValidate}
            disabled={isPending}
          >
            {validateMut.isPending ? (
              <><Spinner size="sm" className="mr-1" /> Validating...</>
            ) : (
              'Validate'
            )}
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={createMut.isPending || updateMut.isPending}
            disabled={mode === 'create' && !name}
          >
            {mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
