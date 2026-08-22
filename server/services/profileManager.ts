import fs from 'node:fs';
import path from 'node:path';
import type { ProfileConfig, ProfileSummary } from '../types.js';
import { readEnvFile, writeEnvFileToDisk } from '../utils.js';

// ── Validation ───────────────────────────────────────────────────────────────

/** Known allowed string values for enum-like fields. */
const VALID_MODEL_VARIANTS = new Set(['int4', 'fp8']);
const VALID_KV_CACHE_DTYPES = new Set(['auto', 'int8_per_token_head', 'fp8', 'fp16']);
const VALID_COMPATIBLE_MODES = new Set(['normal', 'mm', 'all']);

/**
 * Validate a partial profile config. Returns an array of human-readable
 * error strings. An empty array means the config is valid.
 *
 * Every field in ProfileConfig is checked here. When new fields are added
 * to the interface, add a corresponding rule below so the two stay in sync.
 */
export function validateProfile(config: Partial<ProfileConfig>): string[] {
  const errors: string[] = [];

  // ── Required string fields ────────────────────────────────────────────
  if (!config.SERVED_NAME || String(config.SERVED_NAME).trim() === '') {
    errors.push('SERVED_NAME is required');
  }
  if (!config.MODEL_FAMILY || String(config.MODEL_FAMILY).trim() === '') {
    errors.push('MODEL_FAMILY is required');
  }
  if (!config.PROFILE_GROUP || String(config.PROFILE_GROUP).trim() === '') {
    errors.push('PROFILE_GROUP is required');
  }
  if (!config.MODEL_VARIANT || String(config.MODEL_VARIANT).trim() === '') {
    errors.push('MODEL_VARIANT is required');
  }

  // ── Enum / allowed-value checks ───────────────────────────────────────
  if (config.MODEL_VARIANT !== undefined && !VALID_MODEL_VARIANTS.has(String(config.MODEL_VARIANT))) {
    errors.push(`MODEL_VARIANT must be one of: ${[...VALID_MODEL_VARIANTS].join(', ')}`);
  }
  if (config.KV_CACHE_DTYPE !== undefined && !VALID_KV_CACHE_DTYPES.has(String(config.KV_CACHE_DTYPE))) {
    errors.push(`KV_CACHE_DTYPE must be one of: ${[...VALID_KV_CACHE_DTYPES].join(', ')}`);
  }
  if (config.COMPATIBLE_MODES !== undefined && !VALID_COMPATIBLE_MODES.has(String(config.COMPATIBLE_MODES))) {
    errors.push(`COMPATIBLE_MODES must be one of: ${[...VALID_COMPATIBLE_MODES].join(', ')}`);
  }

  // ── Numeric range checks ──────────────────────────────────────────────
  if (config.GPU_UTIL !== undefined) {
    const v = Number(config.GPU_UTIL);
    if (Number.isNaN(v) || v < 0.5 || v > 0.99) {
      errors.push('GPU_UTIL must be between 0.5 and 0.99');
    }
  }
  if (config.MAX_MODEL_LEN !== undefined) {
    const v = Number(config.MAX_MODEL_LEN);
    if (!Number.isFinite(v) || v < 1 || !Number.isInteger(v)) {
      errors.push('MAX_MODEL_LEN must be a positive integer');
    }
  }
  if (config.MAX_BATCHED_TOKENS !== undefined) {
    const v = Number(config.MAX_BATCHED_TOKENS);
    if (!Number.isFinite(v) || v < 1 || !Number.isInteger(v)) {
      errors.push('MAX_BATCHED_TOKENS must be a positive integer');
    }
  }
  if (config.MAX_NUM_SEQS !== undefined) {
    const v = Number(config.MAX_NUM_SEQS);
    if (!Number.isFinite(v) || v < 1 || !Number.isInteger(v)) {
      errors.push('MAX_NUM_SEQS must be a positive integer');
    }
  }
  if (config.TP_SIZE !== undefined) {
    const v = Number(config.TP_SIZE);
    if (!Number.isFinite(v) || v < 1 || !Number.isInteger(v)) {
      errors.push('TP_SIZE must be a positive integer');
    }
  }
  if (config.MTP_K !== undefined) {
    const v = Number(config.MTP_K);
    if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
      errors.push('MTP_K must be a non-negative integer');
    }
  }
  if (config.PORT !== undefined) {
    const v = Number(config.PORT);
    if (!Number.isFinite(v) || v < 1 || v > 65535 || !Number.isInteger(v)) {
      errors.push('PORT must be an integer between 1 and 65535');
    }
  }

  // ── Boolean-as-number checks (0 | 1) ─────────────────────────────────
  const booleanFields: Array<{ key: keyof ProfileConfig; label: string }> = [
    { key: 'VLLM_INT8KV_FA_PREFILL', label: 'VLLM_INT8KV_FA_PREFILL' },
    { key: 'VLLM_INT8KV_FA_CONTINUATION_DEQUANT', label: 'VLLM_INT8KV_FA_CONTINUATION_DEQUANT' },
    { key: 'VLLM_INT8KV_FA_CASCADE_DEQUANT', label: 'VLLM_INT8KV_FA_CASCADE_DEQUANT' },
    { key: 'ENABLE_AUTO_TOOL_CHOICE', label: 'ENABLE_AUTO_TOOL_CHOICE' },
    { key: 'LANGUAGE_MODEL_ONLY', label: 'LANGUAGE_MODEL_ONLY' },
    { key: 'SKIP_MM_PROFILING', label: 'SKIP_MM_PROFILING' },
  ];
  for (const { key, label } of booleanFields) {
    const v = config[key];
    if (v !== undefined && (v !== 0 && v !== 1)) {
      errors.push(`${label} must be 0 or 1`);
    }
  }

  // ── Optional positive integer fields ──────────────────────────────────
  if (config.VLLM_INT8KV_FA_CASCADE_TILE_TOKENS !== undefined) {
    const v = Number(config.VLLM_INT8KV_FA_CASCADE_TILE_TOKENS);
    if (!Number.isFinite(v) || v < 1 || !Number.isInteger(v)) {
      errors.push('VLLM_INT8KV_FA_CASCADE_TILE_TOKENS must be a positive integer');
    }
  }

  return errors;
}

/**
 * Walk the profiles directory and return all .env files with parsed key fields.
 */
export async function listProfiles(): Promise<ProfileSummary[]> {
  const profilesDir = getProfilesDir();
  const userDir = getUserDir();
  const results: ProfileSummary[] = [];

  if (!fs.existsSync(profilesDir)) return results;

  // Resolve real path of userDir once for comparison (handles symlinks on Windows)
  const realUserDir = fs.realpathSync(userDir);

  walkDir(profilesDir, new Set(), (fullPath) => {
    if (!fullPath.endsWith('.env')) return;
    const name = path.relative(profilesDir, fullPath).replace(/\\/g, '/');
    const realFullPath = fs.realpathSync(fullPath);
    const writable = realFullPath.startsWith(realUserDir + path.sep);
    const fields = readEnvFile(fullPath);
    results.push({ name, path: fullPath, writable, fields: fields as Partial<ProfileConfig> });
  });

  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

function walkDir(dir: string, visited: Set<string>, callback: (filePath: string) => void): void {
  if (!fs.existsSync(dir)) return;
  const realpath = fs.realpathSync(dir);
  const stat = fs.statSync(realpath);
  const inoKey = `${realpath}:${stat.ino}`;
  if (visited.has(inoKey)) return;
  visited.add(inoKey);

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, visited, callback);
    } else if (entry.isFile()) {
      callback(full);
    }
  }
}

/**
 * Get a profile by relative path (e.g. "qwen27b/normal/int4/sample.env").
 */
export async function getProfile(relPath: string): Promise<ProfileConfig> {
  const fullPath = resolveProfilePath(relPath);
  const fields = readEnvFile(fullPath);
  return fields as unknown as ProfileConfig;
}

function getProfilesDir(): string {
  return path.join(getLauncherDir(), 'profiles');
}

function getUserDir(): string {
  return path.join(getProfilesDir(), 'user');
}

function getLauncherDir(): string {
  // Lazy-read CONTROL_TOWER_HOME to avoid ESM module-level caching issues
  const home = process.env.CONTROL_TOWER_HOME ?? process.cwd();
  const configPath = path.join(home, 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error(`config.json not found at ${configPath}`);
    throw new Error('Server configuration not found'); // L7: don't leak path
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { launcherDir: string };
  return config.launcherDir;
}

function resolveProfilePath(relPath: string): string {
  const profilesDir = getProfilesDir();
  const fullPath = path.resolve(profilesDir, relPath);

  // Prevent path traversal — use trailing separator to avoid prefix collision (H4)
  // Also resolve symlinks to prevent symlink escape (H5)
  let realFullPath: string;
  try {
    realFullPath = fs.realpathSync(fullPath);
  } catch {
    // File doesn't exist yet — realpathSync throws ENOENT
    // Fall back to logical path check
    if (!fullPath.startsWith(profilesDir + path.sep) && fullPath !== profilesDir) {
      throw new Error('Invalid profile path');
    }
    throw new Error(`Profile not found: ${relPath}`);
  }

  const realProfilesDir = fs.realpathSync(profilesDir);
  if (!realFullPath.startsWith(realProfilesDir + path.sep) && realFullPath !== realProfilesDir) {
    throw new Error('Invalid profile path');
  }
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Profile not found: ${relPath}`);
  }
  return fullPath;
}

/**
 * Create a new profile in user/ directory. Returns absolute path.
 */
export async function createProfile(name: string, config: Partial<ProfileConfig>): Promise<string> {
  const userDir = getUserDir();
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

  // Sanitize name — reject if nothing alphanumeric remains
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (safeName === '' || safeName.startsWith('_')) {
    throw new Error('Profile name must contain at least one alphanumeric character');
  }
  const filePath = path.join(userDir, `${safeName}.env`);

  const defaults: Partial<ProfileConfig> = {
    MODEL_FAMILY: 'qwen',
    PROFILE_GROUP: 'qwen36-27b-int4',
    MODEL_VARIANT: 'int4',
    KV_CACHE_DTYPE: 'int8_per_token_head',
    GPU_UTIL: 0.88,
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

  // M11: Filter to known keys only — prevent arbitrary env var injection
  const KNOWN_KEYS = new Set([
    ...Object.keys(defaults),
    'SERVED_NAME', // required field, not in defaults
    'MODEL_PATH', 'TP_SIZE', 'PORT', 'MAX_MODEL_LEN',
    'VLLM_INT8KV_FA_CASCADE_TILE_TOKENS', 'COMPILATION_CONFIG_JSON',
    'TOOL_CALL_PARSER', 'SPECULATIVE_MODEL', 'NUM_SPECULATIVE_TOKENS',
    'DRAFT_TENSOR_PARALLEL_SIZE', 'DRAFT_MODEL_TP_SIZE', 'SPECULATIVE_DECODE_METHOD',
    'TOOL_CALL_PARSER_PATH', 'TOOL_CALL_LIMIT',
    'ENABLE_PREFIX_CACHING_COMPILE', 'VLLM_ATTENTION_BACKEND_COMPILE',
    'TORCH_COMPILE_CACHE_DIR', 'DISABLE_COMPILE_CACHE',
    'SYSTEM_PROMPT', 'CHAT_TEMPLATE', 'TRUST_REMOTE_CODE',
    'CUDA_VISIBLE_DEVICES', 'VLLM_HOST_IP', 'VLLM_RPC_BASE_URL',
    'RAY_ADDRESS', 'RAY_OBJECT_STORE_MEMORY',
    'VLLM_LOGGING_LEVEL', 'ENABLE_REQUEST_LOGGING', 'LOG_STATS',
    'ENABLE_PROMPT_TOKEN_COUNTS', 'API_KEY',
    'MULTI_VLM', 'VLM_INPUT_TYPE', 'SKIP_MODEL_INIT',
    'LOAD_FORMAT', 'QUANTIZATION',
    'GPU_MEMORY_UTILIZATION', 'CPU_OFFLOAD_GB', 'MAX_SWA_LEN', 'BLOCK_SIZE',
    'MAX_SCHEDULING_BATCH_TOKENS', 'SCHEDULER_POLICY', 'PREEMPTION_MODE',
    'SWAP_SPACE_GB', 'SWAP_SPACE_CPU', 'PRIORITY_FAIROFF_ENABLED', 'PRIORITY_SCALEDOWN_ENABLED',
    'ATTENTION_BACKEND', 'PREFIX_CACHING',
  ]);
  const filtered: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(config)) {
    if (KNOWN_KEYS.has(k) && v !== undefined) filtered[k] = v as string | number;
  }
  const merged = { ...defaults, ...filtered };

  const validationErrors = validateProfile(merged);
  if (validationErrors.length > 0) {
    throw new Error(`Validation failed:\n${validationErrors.join('\n')}`);
  }

  // M12: Use exclusive create flag to prevent TOCTOU race
  try {
    const content = (await import('../utils.js')).writeEnvFile(merged as Record<string, string | number | undefined>);
    fs.writeFileSync(filePath, content, { flag: 'wx', encoding: 'utf-8' });
  } catch (err: any) {
    if (err.code === 'EEXIST') {
      throw new Error(`Profile already exists: ${safeName}.env`);
    }
    throw err;
  }
  return filePath;
}

/**
 * Update an existing user profile.
 */
export async function updateProfile(relPath: string, config: Partial<ProfileConfig>): Promise<void> {
  const fullPath = resolveProfilePath(relPath);

  // M13: Check writability first (before reading/validating)
  const realUserDir = fs.realpathSync(getUserDir());
  const realFullPath = fs.realpathSync(fullPath);
  if (!realFullPath.startsWith(realUserDir + path.sep) && realFullPath !== realUserDir) {
    throw new Error(`Profile is read-only: ${relPath}. Only profiles in user/ can be modified.`);
  }

  // M11 (mirror): Filter to known keys only — prevent arbitrary env var injection via PUT
  const KNOWN_KEYS = new Set([
    'SERVED_NAME', 'MODEL_FAMILY', 'MODEL_VARIANT', 'PROFILE_GROUP',
    'MODEL_PATH', 'TP_SIZE', 'PORT', 'MAX_MODEL_LEN', 'COMPATIBLE_MODES',
    'KV_CACHE_DTYPE', 'MAX_BATCHED_TOKENS', 'MAX_NUM_SEQS',
    'GPU_MEMORY_UTILIZATION', 'CPU_OFFLOAD_GB', 'MAX_SWA_LEN', 'BLOCK_SIZE',
    'GPU_UTIL', 'MTP_K',
    'MAX_SCHEDULING_BATCH_TOKENS', 'SCHEDULER_POLICY', 'PREEMPTION_MODE',
    'SWAP_SPACE_GB', 'SWAP_SPACE_CPU', 'PRIORITY_FAIROFF_ENABLED', 'PRIORITY_SCALEDOWN_ENABLED',
    'VLLM_INT8KV_FA_PREFILL', 'VLLM_INT8KV_FA_CONTINUATION_DEQUANT',
    'VLLM_INT8KV_FA_CASCADE_DEQUANT', 'VLLM_INT8KV_FA_CASCADE_TILE_TOKENS',
    'ATTENTION_BACKEND', 'PREFIX_CACHING',
    'SPECULATIVE_MODEL', 'NUM_SPECULATIVE_TOKENS', 'DRAFT_TENSOR_PARALLEL_SIZE',
    'DRAFT_MODEL_TP_SIZE', 'SPECULATIVE_DECODE_METHOD',
    'ENABLE_AUTO_TOOL_CHOICE', 'TOOL_CALL_PARSER', 'TOOL_CALL_PARSER_PATH', 'TOOL_CALL_LIMIT',
    'COMPILATION_CONFIG_JSON', 'ENABLE_PREFIX_CACHING_COMPILE',
    'VLLM_ATTENTION_BACKEND_COMPILE', 'TORCH_COMPILE_CACHE_DIR', 'DISABLE_COMPILE_CACHE',
    'LANGUAGE_MODEL_ONLY', 'SKIP_MM_PROFILING', 'SYSTEM_PROMPT', 'CHAT_TEMPLATE',
    'TRUST_REMOTE_CODE',
    'CUDA_VISIBLE_DEVICES', 'VLLM_HOST_IP', 'VLLM_RPC_BASE_URL',
    'RAY_ADDRESS', 'RAY_OBJECT_STORE_MEMORY',
    'VLLM_LOGGING_LEVEL', 'ENABLE_REQUEST_LOGGING', 'LOG_STATS',
    'ENABLE_PROMPT_TOKEN_COUNTS', 'API_KEY',
    'MULTI_VLM', 'VLM_INPUT_TYPE', 'SKIP_MODEL_INIT',
    'LOAD_FORMAT', 'QUANTIZATION',
  ]);
  const filtered: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(config)) {
    if (KNOWN_KEYS.has(k) && v !== undefined) filtered[k] = v as string | number;
  }

  const existing = readEnvFile(fullPath);
  const merged = { ...existing, ...filtered };

  const validationErrors = validateProfile(merged);
  if (validationErrors.length > 0) {
    throw new Error(`Validation failed:\n${validationErrors.join('\n')}`);
  }

  writeEnvFileToDisk(fullPath, merged as Record<string, string | number | undefined>);
}

/**
 * Delete a user profile.
 */
export async function deleteProfile(relPath: string): Promise<void> {
  const fullPath = resolveProfilePath(relPath);
  // Re-check writability right before delete (TOCTOU protection, same as updateProfile)
  const realUserDir = fs.realpathSync(getUserDir());
  const realFullPath = fs.realpathSync(fullPath);
  if (!realFullPath.startsWith(realUserDir + path.sep) && realFullPath !== realUserDir) {
    throw new Error(`Profile is read-only: ${relPath}. Only profiles in user/ can be modified.`);
  }
  fs.unlinkSync(fullPath);
}
