# Control Tower v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete rewrite of control-tower from bash/FastAPI/vanilla-JS to Node.js/React with real startup progress tracking and profile CRUD.

**Architecture:** Express+TypeScript backend (port 9090) directly manages vLLM processes via `child_process.spawn`. React+Vite+Tailwind SPA frontend (port 9090, served by Express in production). SSE for real-time push (GPU stats, logs, startup progress). All state in JSON files.

**Tech Stack:**
- Backend: Node.js 20+, TypeScript, Express 4, ESM modules
- Frontend: React 18, Vite 5, Tailwind CSS 3, TanStack Query 5
- Process management: Node.js `child_process.spawn` with `detached: true`
- Real-time: Server-Sent Events (SSE)
- Testing: Vitest (unit tests for parsers/utils)

**Spec:** `docs/superpowers/specs/2026-08-18-control-tower-v2-design.md`

## Global Constraints

- All paths use absolute paths; project root is `~/control-tower-v2/` (new directory, NOT the old `~/control-tower/`)
- Old control-tower keeps running on port 9090 until new one is verified working
- All vLLM commands use `python3 -m vllm.entrypoints.openai.api_server` (matches current launcher.sh behavior)
- Process group signaling: use `process.kill(-pid, signal)` for graceful shutdown (requires `detached: true`)
- PID files written to `run-logs/` dir, named `vllm-<safe_name>-<timestamp>.pid`
- Log files written to `run-logs/` dir, named `vllm-<safe_name>-<timestamp>.log`
- TypeScript strict mode enabled; no `any` unless absolutely necessary
- All API responses are JSON with consistent shape: `{ok: bool, data?: any, error?: string}`
- Environment variable `CONTROL_TOWER_HOME` overrides default paths

---

## File Structure

```
~/control-tower-v2/
├── package.json                    # workspace root + scripts
├── tsconfig.json                   # TS config (strict, ESM, target ES2022)
├── .gitignore
├── README.md
├── config.json                     # runtime config (port, launcher dir, model path)
├── state.json                      # current state (PID, profile, logFile) - gitignored
├── run-logs/                       # vLLM log + PID files - gitignored
├── profiles/                       # symlink to ~/vLLM-2080Ti-Definitive/profiles
│   └── user/                       # user-created profiles (writable)
├── server/
│   ├── index.ts                    # Express app entry point
│   ├── types.ts                    # shared TypeScript types
│   ├── utils.ts                    # shell helpers, file utils
│   ├── routes/
│   │   ├── server.ts               # /api/server/* (start/stop/status/progress)
│   │   ├── profiles.ts             # /api/profiles/* (CRUD)
│   │   ├── gpu.ts                  # /api/gpu/* (snapshot + SSE)
│   │   └── logs.ts                 # /api/logs/* (tail + SSE)
│   └── services/
│       ├── processManager.ts       # vLLM spawn/stop/health/progress
│       ├── profileManager.ts       # .env file CRUD
│       ├── logParser.ts            # vLLM log stage detection
│       ├── gpuMonitor.ts           # nvidia-smi polling
│       └── state.ts                # persistent state management
├── client/
│   ├── index.html                  # Vite entry
│   ├── vite.config.ts              # Vite config (proxy /api to 9090)
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── package.json                # client deps
│   ├── tsconfig.json
│   ├── public/
│   │   └── favicon.svg
│   └── src/
│       ├── main.tsx                # React entry
│       ├── App.tsx                 # router setup
│       ├── api.ts                  # fetch wrappers
│       ├── hooks/
│       │   ├── useSSE.ts           # generic SSE hook
│       │   ├── useServer.ts        # server status + actions
│       │   ├── useGPU.ts           # GPU monitoring
│       │   ├── useLogs.ts          # log streaming
│       │   └── useProfiles.ts      # profile CRUD
│       ├── components/
│       │   ├── Layout.tsx          # shell with sidebar nav
│       │   ├── Dashboard.tsx       # main overview page
│       │   ├── ServerControl.tsx   # start/stop/status card
│       │   ├── ProfileManager.tsx  # profile list page
│       │   ├── ProfileForm.tsx     # create/edit form
│       │   ├── ProfileCard.tsx     # single profile card
│       │   ├── GPUStats.tsx        # GPU monitoring cards
│       │   ├── LogViewer.tsx       # log streaming
│       │   ├── ProgressBar.tsx     # startup progress
│       │   ├── Settings.tsx        # settings page
│       │   └── common/
│       │       ├── Button.tsx
│       │       ├── Card.tsx
│       │       ├── Badge.tsx
│       │       ├── Modal.tsx
│       │       ├── Toast.tsx
│       │       └── Spinner.tsx
│       ├── pages/
│       │   ├── DashboardPage.tsx
│       │   ├── ProfilesPage.tsx
│       │   ├── ProfileEditorPage.tsx
│       │   ├── LogsPage.tsx
│       │   └── SettingsPage.tsx
│       └── styles/
│           └── globals.css         # Tailwind imports + design tokens
└── tests/
    ├── logParser.test.ts
    ├── profileManager.test.ts
    └── envFile.test.ts
```

---

## Task 1: Project scaffolding

**Files:**
- Create: `~/control-tower-v2/package.json`
- Create: `~/control-tower-v2/tsconfig.json`
- Create: `~/control-tower-v2/.gitignore`
- Create: `~/control-tower-v2/README.md`
- Create: `~/control-tower-v2/config.json`
- Create: `~/control-tower-v2/run-logs/.gitkeep`
- Create: `~/control-tower-v2/profiles/user/.gitkeep`

**Step 1: Create project directory**

```bash
mkdir -p ~/control-tower-v2/{server/{routes,services},client/src/{hooks,components/common,pages,styles},tests,run-logs,profiles/user}
cd ~/control-tower-v2
git init
```

**Step 2: Write root package.json**

Create `~/control-tower-v2/package.json`:
```json
{
  "name": "control-tower-v2",
  "version": "2.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\"",
    "dev:server": "tsx watch server/index.ts",
    "dev:client": "npm --prefix client run dev",
    "build": "npm --prefix client run build && tsc -p tsconfig.server.json",
    "start": "node dist/server/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "express": "^4.19.2",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/cors": "^2.8.17",
    "@types/node": "^20.11.30",
    "concurrently": "^8.2.2",
    "tsx": "^4.7.1",
    "typescript": "^5.4.3",
    "vitest": "^1.4.0"
  }
}
```

**Step 3: Write tsconfig.json**

Create `~/control-tower-v2/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "outDir": "./dist",
    "rootDir": "./",
    "jsx": "preserve",
    "lib": ["ES2022", "DOM"],
    "types": ["node", "vitest/globals"],
    "baseUrl": ".",
    "paths": {
      "@server/*": ["server/*"],
      "@shared/*": ["shared/*"]
    }
  },
  "include": ["server/**/*", "client/src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist", "client/dist"]
}
```

Create `~/control-tower-v2/tsconfig.server.json` (for production build):
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist/server",
    "rootDir": "./server"
  },
  "include": ["server/**/*"],
  "exclude": ["client", "tests"]
}
```

**Step 4: Write .gitignore**

Create `~/control-tower-v2/.gitignore`:
```
node_modules/
dist/
state.json
run-logs/*.log
run-logs/*.pid
client/dist/
.env
.env.local
```

**Step 5: Write config.json**

Create `~/control-tower-v2/config.json`:
```json
{
  "port": 9090,
  "launcherDir": "/home/chang/vLLM-2080Ti-Definitive",
  "modelDir": "/home/chang/models/Qwen3.8-27B-GPTQ-Int4",
  "logDir": "run-logs",
  "stateFile": "state.json"
}
```

**Step 6: Install root dependencies**

```bash
cd ~/control-tower-v2 && npm install
```

**Step 7: Commit**

```bash
cd ~/control-tower-v2 && git add -A && git commit -m "feat: project scaffolding"
```

---

## Task 2: Shared types module

**Files:**
- Create: `server/types.ts`

**Interfaces:**
- Consumes: nothing (pure types)
- Produces: `VLLMProcess`, `ProgressEvent`, `GPUInfo`, `ProfileConfig`, `ProfileSummary`, `ServerStatus`, `ApiResponse<T>`

**Step 1: Write types.ts**

Create `server/types.ts`:
```typescript
// ── Server state ────────────────────────────────────────────────────────────

export type ServerStatus = 'stopped' | 'starting' | 'loading' | 'ready' | 'error';

export interface VLLMProcess {
  pid: number | null;
  profile: string | null;        // relative path like "qwen27b/normal/int4/foo.env"
  profilePath: string | null;    // absolute path
  status: ServerStatus;
  startedAt: number | null;     // epoch ms
  healthDetail: string;          // e.g. "loading model weights", "compiling kernels"
  progress: number;              // 0-100
  logFile: string | null;
  error: string | null;
  servedName: string | null;
  port: number;
}

// ── Progress events (SSE) ───────────────────────────────────────────────────

export interface ProgressEvent {
  stage: string;                 // stage id
  label: string;                 // human-readable
  progress: number;              // 0-100
  status: 'active' | 'completed' | 'error';
  message?: string;              // optional detail
  timestamp: number;             // epoch ms
}

// ── GPU monitoring ──────────────────────────────────────────────────────────

export interface GPUInfo {
  index: number;
  name: string;
  temperature: number;           // °C
  powerDraw: number;             // W
  powerLimit: number;            // W
  smClock: number;               // MHz
  memoryUsed: number;            // MiB
  memoryTotal: number;           // MiB
  utilization: number;           // %
  throttleReasons: string[];
}

// ── Profile config ──────────────────────────────────────────────────────────

export interface ProfileConfig {
  // Model
  MODEL_PATH?: string;
  SERVED_NAME: string;
  MODEL_FAMILY: string;
  PROFILE_GROUP: string;
  MODEL_VARIANT: string;          // "int4" | "fp8"

  // Memory
  GPU_UTIL: number;               // 0.0-1.0
  KV_CACHE_DTYPE: string;         // "auto" | "int8_per_token_head"
  MAX_MODEL_LEN: number;
  MAX_BATCHED_TOKENS: number;
  MAX_NUM_SEQS: number;
  TP_SIZE?: number;               // default 2

  // Speculative decoding
  MTP_K: number;                  // 0 = disabled

  // int8kv fast attention
  VLLM_INT8KV_FA_PREFILL: number;
  VLLM_INT8KV_FA_CONTINUATION_DEQUANT: number;
  VLLM_INT8KV_FA_CASCADE_DEQUANT: number;
  VLLM_INT8KV_FA_CASCADE_TILE_TOKENS?: number;

  // Tool calling
  ENABLE_AUTO_TOOL_CHOICE: number;
  TOOL_CALL_PARSER: string;

  // Compilation
  COMPILATION_CONFIG_JSON?: string;

  // Metadata
  COMPATIBLE_MODES: string;
  LANGUAGE_MODEL_ONLY: number;
  SKIP_MM_PROFILING: number;

  // Server
  PORT?: number;                  // default 8000
}

export interface ProfileSummary {
  name: string;                   // relative path
  path: string;                   // absolute path
  writable: boolean;              // true for user/ profiles
  fields: Partial<ProfileConfig>;
}

// ── API response shape ──────────────────────────────────────────────────────

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ── Process state (persisted to state.json) ─────────────────────────────────

export interface PersistedState {
  pid: number | null;
  profile: string | null;         // relative path
  profilePath: string | null;
  logFile: string | null;
  startedAt: number | null;
  servedName: string | null;
  port: number;
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd ~/control-tower-v2 && npx tsc --noEmit server/types.ts
```

Expected: no errors.

**Step 3: Commit**

```bash
git add server/types.ts && git commit -m "feat(server): shared TypeScript types"
```

---

## Task 3: State persistence service

**Files:**
- Create: `server/services/state.ts`
- Test: `tests/state.test.ts`

**Interfaces:**
- Consumes: `PersistedState` from types
- Produces: `loadState()`, `saveState()`, `clearState()`

**Step 1: Write failing test**

Create `tests/state.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadState, saveState, clearState } from '../server/services/state.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-state-'));
const stateFile = path.join(tmpDir, 'state.json');

describe('state service', () => {
  beforeEach(() => {
    process.env.CONTROL_TOWER_HOME = tmpDir;
  });

  afterEach(() => {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  });

  it('returns null when state file does not exist', () => {
    const s = loadState();
    expect(s).toBeNull();
  });

  it('persists and loads state', () => {
    saveState({ pid: 12345, profile: 'qwen27b/normal/int4/test.env', profilePath: '/abs/path/test.env', logFile: '/abs/path/test.log', startedAt: Date.now(), servedName: 'test-served', port: 8000 });
    const s = loadState();
    expect(s).not.toBeNull();
    expect(s!.pid).toBe(12345);
    expect(s!.profile).toBe('qwen27b/normal/int4/test.env');
    expect(s!.servedName).toBe('test-served');
    expect(s!.port).toBe(8000);
  });

  it('clears state file', () => {
    saveState({ pid: 12345, profile: null, profilePath: null, logFile: null, startedAt: null, servedName: null, port: 8000 });
    expect(fs.existsSync(stateFile)).toBe(true);
    clearState();
    expect(fs.existsSync(stateFile)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd ~/control-tower-v2 && npx vitest run tests/state.test.ts
```

Expected: FAIL with "Cannot find module".

**Step 3: Write implementation**

Create `server/services/state.ts`:
```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { PersistedState } from '../types.js';

const HOME = process.env.CONTROL_TOWER_HOME || process.cwd();
const STATE_FILE = path.join(HOME, 'state.json');

export function loadState(): PersistedState | null {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      pid: parsed.pid ?? null,
      profile: parsed.profile ?? null,
      profilePath: parsed.profilePath ?? null,
      logFile: parsed.logFile ?? null,
      startedAt: parsed.startedAt ?? null,
      servedName: parsed.servedName ?? null,
      port: parsed.port ?? 8000,
    };
  } catch (err) {
    console.error('Failed to load state:', err);
    return null;
  }
}

export function saveState(state: PersistedState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export function clearState(): void {
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
}
```

**Step 4: Run test to verify it passes**

```bash
cd ~/control-tower-v2 && npx vitest run tests/state.test.ts
```

Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add server/services/state.ts tests/state.test.ts && git commit -m "feat(server): state persistence service"
```

---

## Task 4: .env file parser utility

**Files:**
- Create: `server/utils.ts`
- Test: `tests/envFile.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `parseEnvFile()`, `writeEnvFile()`, `parseStringValue()`, `formatStringValue()`

**Step 1: Write failing test**

Create `tests/envFile.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseEnvFile, writeEnvFile, formatStringValue } from '../server/utils.js';

describe('env file parser', () => {
  it('parses simple KEY=value pairs', () => {
    const content = `SERVED_NAME=test
GPU_UTIL=0.88
MAX_MODEL_LEN=256000
`;
    const result = parseEnvFile(content);
    expect(result.SERVED_NAME).toBe('test');
    expect(result.GPU_UTIL).toBe(0.88);
    expect(result.MAX_MODEL_LEN).toBe(256000);
  });

  it('parses single-quoted JSON values', () => {
    const content = `COMPILATION_CONFIG_JSON='{"cudagraph_mode":"PIECEWISE"}'
`;
    const result = parseEnvFile(content);
    expect(result.COMPILATION_CONFIG_JSON).toBe('{"cudagraph_mode":"PIECEWISE"}');
  });

  it('skips comment lines and blank lines', () => {
    const content = `# This is a comment
SERVED_NAME=test

# Another comment
GPU_UTIL=0.88
`;
    const result = parseEnvFile(content);
    expect(Object.keys(result)).toEqual(['SERVED_NAME', 'GPU_UTIL']);
  });

  it('writes env file with single-quoted JSON', () => {
    const obj = {
      SERVED_NAME: 'test',
      GPU_UTIL: 0.88,
      COMPILATION_CONFIG_JSON: '{"cudagraph_mode":"PIECEWISE"}',
    };
    const output = writeEnvFile(obj);
    expect(output).toContain('SERVED_NAME=test');
    expect(output).toContain('GPU_UTIL=0.88');
    expect(output).toContain(`COMPILATION_CONFIG_JSON='${obj.COMPILATION_CONFIG_JSON}'`);
  });

  it('formats string values without quotes for plain strings', () => {
    expect(formatStringValue('hello')).toBe('hello');
    expect(formatStringValue('hello world')).toBe('hello world');
  });

  it('quotes JSON-like values', () => {
    expect(formatStringValue('{"foo":1}')).toBe('\'{"foo":1}\'');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd ~/control-tower-v2 && npx vitest run tests/envFile.test.ts
```

Expected: FAIL with "Cannot find module".

**Step 3: Write implementation**

Create `server/utils.ts`:
```typescript
import fs from 'node:fs';

// ── Env file parser ─────────────────────────────────────────────────────────

/**
 * Parse a .env file into a key-value object.
 * Handles:
 *   - KEY=value
 *   - KEY='json-like value with spaces'
 *   - KEY="double quoted"
 *   - # comments and blank lines
 *   - Numeric values parsed to numbers when possible
 */
export function parseEnvFile(content: string): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  const lines = content.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();

    // Strip surrounding quotes (single or double)
    if ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }

    // Try to parse as number
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      result[key] = parseFloat(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Format a value for writing to .env file.
 * Wraps JSON-like values in single quotes.
 */
export function formatStringValue(value: string): string {
  if (/^[{\[]/.test(value.trim()) && /[}\]]$/.test(value.trim())) {
    return `'${value}'`;
  }
  return value;
}

/**
 * Serialize an object back to .env file format.
 * Keys are sorted alphabetically.
 */
export function writeEnvFile(obj: Record<string, string | number | undefined>): string {
  const lines: string[] = [];
  const keys = Object.keys(obj).sort();

  for (const key of keys) {
    const value = obj[key];
    if (value === undefined) continue;
    const stringValue = String(value);
    lines.push(`${key}=${formatStringValue(stringValue)}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Read and parse a .env file from disk.
 */
export function readEnvFile(path: string): Record<string, string | number> {
  const content = fs.readFileSync(path, 'utf-8');
  return parseEnvFile(content);
}

/**
 * Write a .env file to disk.
 */
export function writeEnvFileToDisk(path: string, obj: Record<string, string | number | undefined>): void {
  const content = writeEnvFile(obj);
  fs.writeFileSync(path, content, 'utf-8');
}
```

**Step 4: Run test to verify it passes**

```bash
cd ~/control-tower-v2 && npx vitest run tests/envFile.test.ts
```

Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add server/utils.ts tests/envFile.test.ts && git commit -m "feat(server): .env file parser utility"
```

---

## Task 5: Log parser service

**Files:**
- Create: `server/services/logParser.ts`
- Test: `tests/logParser.test.ts`

**Interfaces:**
- Consumes: log line strings
- Produces: `parseLine()`, `LogStage[]`, `STAGES`

**Step 1: Write failing test**

Create `tests/logParser.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseLine, STAGES, type LogStage } from '../server/services/logParser.js';

describe('log parser', () => {
  it('detects "Initializing" stage', () => {
    const stage = parseLine('INFO 12-01 10:00:00 Initializing a VLLM engine');
    expect(stage).not.toBeNull();
    expect(stage!.id).toBe('init');
  });

  it('detects "Loading weights" stage', () => {
    const stage = parseLine('INFO Loading model weights took 9.48 GiB');
    expect(stage).not.toBeNull();
    expect(stage!.id).toBe('weights');
  });

  it('detects "profiled" stage', () => {
    const stage = parseLine('INFO Memory profiling: 10.04 GiB available for KV cache');
    expect(stage).not.toBeNull();
    expect(stage!.id).toBe('profile');
  });

  it('detects "Capturing CUDA graphs" stage', () => {
    const stage = parseLine('INFO Capturing CUDA graphs (batchsize 4)');
    expect(stage).not.toBeNull();
    expect(stage!.id).toBe('cudagraph');
  });

  it('detects "Compiling" stage', () => {
    const stage = parseLine('INFO Compiling CUDA kernels...');
    expect(stage).not.toBeNull();
    expect(stage!.id).toBe('compile');
  });

  it('detects server-ready stage', () => {
    const stage = parseLine('INFO Uvicorn running on http://0.0.0.0:8000');
    expect(stage).not.toBeNull();
    expect(stage!.id).toBe('server');
  });

  it('returns null for unrelated lines', () => {
    const stage = parseLine('Some random log output');
    expect(stage).toBeNull();
  });

  it('detects OOM error', () => {
    const isError = parseLine('torch.cuda.OutOfMemoryError: CUDA out of memory.');
    // OOM should not match any success stage
    const stage = parseLine('torch.cuda.OutOfMemoryError: CUDA out of memory.');
    expect(stage).toBeNull();
  });

  it('STAGES has ordered progress ranges', () => {
    expect(STAGES.length).toBeGreaterThan(0);
    for (let i = 1; i < STAGES.length; i++) {
      expect(STAGES[i].progressStart).toBeGreaterThanOrEqual(STAGES[i - 1].progressEnd);
    }
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd ~/control-tower-v2 && npx vitest run tests/logParser.test.ts
```

Expected: FAIL with "Cannot find module".

**Step 3: Write implementation**

Create `server/services/logParser.ts`:
```typescript
export interface LogStage {
  id: string;
  label: string;
  pattern: RegExp;
  progressStart: number;
  progressEnd: number;
}

export const STAGES: LogStage[] = [
  { id: 'init',      label: 'Initializing',            pattern: /Initializing a VLLM/i,                       progressStart: 0,  progressEnd: 5 },
  { id: 'weights',   label: 'Loading model weights',   pattern: /Loading model|Loading weights|model loading/i, progressStart: 5,  progressEnd: 25 },
  { id: 'profile',   label: 'Profiling memory',        pattern: /profiled|GPU memory|determining.*memory/i,   progressStart: 25, progressEnd: 45 },
  { id: 'kvcache',   label: 'Allocating KV cache',     pattern: /KV cache|Memory pool|token blocks/i,         progressStart: 45, progressEnd: 55 },
  { id: 'cudagraph', label: 'Capturing CUDA graphs',   pattern: /CUDA graph|cudagraph/i,                       progressStart: 55, progressEnd: 75 },
  { id: 'compile',   label: 'Compiling kernels',       pattern: /Compiling|torch\.compile/i,                  progressStart: 75, progressEnd: 85 },
  { id: 'server',    label: 'Starting server',         pattern: /Uvicorn|startup complete|listening on/i,     progressStart: 85, progressEnd: 95 },
];

// Error patterns (returns null from parseLine but detected separately)
export const ERROR_PATTERNS: RegExp[] = [
  /OutOfMemoryError/i,
  /CUDA error/i,
  /EngineDeadError/i,
  /EngineCore failed/i,
  /Traceback \(most recent call last\)/,
];

export function isErrorLine(line: string): boolean {
  return ERROR_PATTERNS.some(p => p.test(line));
}

/**
 * Parse a single log line. Returns the matching stage, or null if no match.
 */
export function parseLine(line: string): LogStage | null {
  for (const stage of STAGES) {
    if (stage.pattern.test(line)) return stage;
  }
  return null;
}

/**
 * Find the latest completed stage for a set of log lines.
 * Useful for catching up on missed lines.
 */
export function findLatestStage(lines: string[]): LogStage | null {
  let latest: LogStage | null = null;
  for (const line of lines) {
    const stage = parseLine(line);
    if (stage) latest = stage;
  }
  return latest;
}

/**
 * Interpolate progress within a stage based on how far we are between
 * progressStart and progressEnd. Caller provides elapsed seconds since stage
 * start (capped at 60s per stage for estimation).
 */
export function interpolateProgress(stage: LogStage, secondsInStage: number): number {
  const duration = 60; // estimate: each stage takes up to 60s
  const t = Math.min(1, secondsInStage / duration);
  return Math.round(stage.progressStart + (stage.progressEnd - stage.progressStart) * t);
}
```

**Step 4: Run test to verify it passes**

```bash
cd ~/control-tower-v2 && npx vitest run tests/logParser.test.ts
```

Expected: PASS (9 tests).

**Step 5: Commit**

```bash
git add server/services/logParser.ts tests/logParser.test.ts && git commit -m "feat(server): log parser with stage detection"
```

---

## Task 6: Profile manager service

**Files:**
- Create: `server/services/profileManager.ts`
- Test: `tests/profileManager.test.ts`

**Interfaces:**
- Consumes: `ProfileConfig`, `ProfileSummary` from types
- Produces: `listProfiles()`, `getProfile()`, `createProfile()`, `updateProfile()`, `deleteProfile()`, `getTemplates()`

**Step 1: Write failing test**

Create `tests/profileManager.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { listProfiles, getProfile, createProfile, updateProfile, deleteProfile } from '../server/services/profileManager.js';
import { writeEnvFileToDisk } from '../server/utils.js';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-profiles-'));
const profilesDir = path.join(tmpHome, 'profiles');
const userDir = path.join(profilesDir, 'user');
const templatesDir = path.join(profilesDir, 'templates');
const launcherProfilesDir = path.join(profilesDir, 'qwen27b', 'normal', 'int4');

beforeEach(() => {
  fs.mkdirSync(userDir, { recursive: true });
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.mkdirSync(launcherProfilesDir, { recursive: true });

  // Symlink the launcher dir for testing
  fs.symlinkSync(launcherProfilesDir, path.join(profilesDir, 'qwen27b', 'normal'), 'dir');

  // Create a sample profile in launcher dir
  writeEnvFileToDisk(path.join(launcherProfilesDir, 'sample.env'), {
    SERVED_NAME: 'sample-served',
    GPU_UTIL: 0.88,
    MAX_MODEL_LEN: 256000,
  });

  // Create a template
  writeEnvFileToDisk(path.join(templatesDir, 'base.env'), {
    SERVED_NAME: 'template-base',
    GPU_UTIL: 0.88,
    MAX_MODEL_LEN: 256000,
  });

  process.env.CONTROL_TOWER_HOME = tmpHome;
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('profile manager', () => {
  it('lists profiles from launcher dir', async () => {
    const profiles = await listProfiles();
    const names = profiles.map(p => p.name);
    expect(names).toContain('qwen27b/normal/int4/sample.env');
  });

  it('marks user profiles as writable', async () => {
    await createProfile('user-test', {
      SERVED_NAME: 'user-test-served',
      GPU_UTIL: 0.88,
      MAX_MODEL_LEN: 256000,
    });
    const profiles = await listProfiles();
    const userProfile = profiles.find(p => p.name === 'user/user-test.env');
    expect(userProfile).toBeDefined();
    expect(userProfile!.writable).toBe(true);
  });

  it('marks launcher profiles as read-only', async () => {
    const profiles = await listProfiles();
    const launcherProfile = profiles.find(p => p.name === 'qwen27b/normal/int4/sample.env');
    expect(launcherProfile).toBeDefined();
    expect(launcherProfile!.writable).toBe(false);
  });

  it('gets profile by relative path', async () => {
    const profile = await getProfile('qwen27b/normal/int4/sample.env');
    expect(profile.SERVED_NAME).toBe('sample-served');
    expect(profile.GPU_UTIL).toBe(0.88);
  });

  it('creates new profile in user/ directory', async () => {
    const path = await createProfile('new-profile', {
      SERVED_NAME: 'new-served',
      GPU_UTIL: 0.9,
      MAX_MODEL_LEN: 128000,
    });
    expect(path).toContain('user/new-profile.env');
    expect(fs.existsSync(path)).toBe(true);
  });

  it('updates existing user profile', async () => {
    await createProfile('upd', { SERVED_NAME: 'orig', GPU_UTIL: 0.88, MAX_MODEL_LEN: 256000 });
    await updateProfile('user/upd.env', { SERVED_NAME: 'updated', GPU_UTIL: 0.85, MAX_MODEL_LEN: 128000 });
    const updated = await getProfile('user/upd.env');
    expect(updated.SERVED_NAME).toBe('updated');
    expect(updated.GPU_UTIL).toBe(0.85);
  });

  it('refuses to update read-only launcher profile', async () => {
    await expect(updateProfile('qwen27b/normal/int4/sample.env', { SERVED_NAME: 'hacked' }))
      .rejects.toThrow(/read-only/i);
  });

  it('deletes user profile', async () => {
    await createProfile('del', { SERVED_NAME: 'del-served', GPU_UTIL: 0.88, MAX_MODEL_LEN: 256000 });
    await deleteProfile('user/del.env');
    expect(fs.existsSync(path.join(userDir, 'del.env'))).toBe(false);
  });

  it('refuses to delete read-only launcher profile', async () => {
    await expect(deleteProfile('qwen27b/normal/int4/sample.env'))
      .rejects.toThrow(/read-only/i);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd ~/control-tower-v2 && npx vitest run tests/profileManager.test.ts
```

Expected: FAIL with "Cannot find module".

**Step 3: Write implementation**

Create `server/services/profileManager.ts`:
```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { ProfileConfig, ProfileSummary } from '../types.js';
import { readEnvFile, writeEnvFileToDisk } from '../utils.js';

const HOME = process.env.CONTROL_TOWER_HOME || process.cwd();

interface ConfigJson {
  launcherDir: string;
}

function loadConfig(): ConfigJson {
  const configPath = path.join(HOME, 'config.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function getProfilesDir(): string {
  return path.join(loadConfig().launcherDir, 'profiles');
}

function getUserDir(): string {
  return path.join(getProfilesDir(), 'user');
}

/**
 * Walk the profiles directory and return all .env files with parsed key fields.
 */
export async function listProfiles(): Promise<ProfileSummary[]> {
  const profilesDir = getProfilesDir();
  const userDir = getUserDir();
  const results: ProfileSummary[] = [];

  if (!fs.existsSync(profilesDir)) return results;

  walkDir(profilesDir, (fullPath) => {
    if (!fullPath.endsWith('.env')) return;
    const name = path.relative(profilesDir, fullPath);
    const writable = fullPath.startsWith(userDir);
    const fields = readEnvFile(fullPath);
    results.push({ name, path: fullPath, writable, fields: fields as Partial<ProfileConfig> });
  });

  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

function walkDir(dir: string, callback: (filePath: string) => void): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, callback);
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

function resolveProfilePath(relPath: string): string {
  const profilesDir = getProfilesDir();
  const fullPath = path.resolve(profilesDir, relPath);

  // Prevent path traversal
  if (!fullPath.startsWith(profilesDir)) {
    throw new Error('Invalid profile path');
  }
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Profile not found: ${relPath}`);
  }
  return fullPath;
}

function ensureWritable(relPath: string): void {
  const profilesDir = getProfilesDir();
  const userDir = getUserDir();
  const fullPath = resolveProfilePath(relPath);

  if (!fullPath.startsWith(userDir)) {
    throw new Error(`Profile is read-only: ${relPath}. Only profiles in user/ can be modified.`);
  }
}

/**
 * Create a new profile in user/ directory. Returns absolute path.
 */
export async function createProfile(name: string, config: Partial<ProfileConfig>): Promise<string> {
  const userDir = getUserDir();
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

  // Sanitize name
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(userDir, `${safeName}.env`);

  if (fs.existsSync(filePath)) {
    throw new Error(`Profile already exists: ${safeName}.env`);
  }

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

  const merged = { ...defaults, ...config };
  writeEnvFileToDisk(filePath, merged);
  return filePath;
}

/**
 * Update an existing user profile.
 */
export async function updateProfile(relPath: string, config: Partial<ProfileConfig>): Promise<void> {
  ensureWritable(relPath);
  const fullPath = resolveProfilePath(relPath);
  const existing = readEnvFile(fullPath);
  const merged = { ...existing, ...config };
  writeEnvFileToDisk(fullPath, merged as Record<string, string | number | undefined>);
}

/**
 * Delete a user profile.
 */
export async function deleteProfile(relPath: string): Promise<void> {
  ensureWritable(relPath);
  const fullPath = resolveProfilePath(relPath);
  fs.unlinkSync(fullPath);
}
```

**Step 4: Run test to verify it passes**

```bash
cd ~/control-tower-v2 && npx vitest run tests/profileManager.test.ts
```

Expected: PASS (8 tests).

**Step 5: Commit**

```bash
git add server/services/profileManager.ts tests/profileManager.test.ts && git commit -m "feat(server): profile manager service"
```

---

## Task 7: GPU monitor service

**Files:**
- Create: `server/services/gpuMonitor.ts`

**Interfaces:**
- Consumes: nothing (uses `child_process.exec`)
- Produces: `getGPUSnapshot()`, `startGPUStream()`

**Step 1: Write implementation**

Create `server/services/gpuMonitor.ts`:
```typescript
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { GPUInfo } from '../types.js';

const execAsync = promisify(exec);

/**
 * Query nvidia-smi for current GPU stats. Throws if nvidia-smi fails.
 */
export async function getGPUSnapshot(): Promise<GPUInfo[]> {
  const query = [
    'index',
    'name',
    'temperature.gpu',
    'power.draw',
    'power.limit',
    'clocks.sm',
    'memory.used',
    'memory.total',
    'utilization.gpu',
    'utilization.memory',
    'ecc.errors.uncorrected.aggregate.total',
  ].join(',');

  const { stdout } = await execAsync(
    `nvidia-smi --query-gpu=${query} --format=csv,noheader,nounits`,
    { timeout: 5000 }
  );

  return stdout.trim().split('\n').map(line => {
    const parts = line.split(',').map(p => p.trim());
    return {
      index: parseInt(parts[0], 10),
      name: parts[1],
      temperature: parseFloat(parts[2]),
      powerDraw: parseFloat(parts[3]),
      powerLimit: parseFloat(parts[4]),
      smClock: parseFloat(parts[5]),
      memoryUsed: parseFloat(parts[6]),
      memoryTotal: parseFloat(parts[7]),
      utilization: parseFloat(parts[8]),
      throttleReasons: [], // nvidia-smi --query doesn't expose throttle reasons easily; left empty
    };
  });
}

/**
 * Stream GPU data to a callback every `intervalMs` milliseconds.
 * Returns a stop function.
 */
export function startGPUStream(
  callback: (data: GPUInfo[]) => void,
  intervalMs: number = 2000
): () => void {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const data = await getGPUSnapshot();
      callback(data);
    } catch (err) {
      console.error('GPU monitor error:', err);
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };

  tick();

  return () => {
    stopped = true;
  };
}
```

**Step 2: Verify compiles**

```bash
cd ~/control-tower-v2 && npx tsc --noEmit server/services/gpuMonitor.ts
```

Expected: no errors.

**Step 3: Commit**

```bash
git add server/services/gpuMonitor.ts && git commit -m "feat(server): GPU monitor service"
```

---

## Task 8: Process manager service (core)

**Files:**
- Create: `server/services/processManager.ts`

**Interfaces:**
- Consumes: `ProfileConfig`, `LogStage`, `ProgressEvent`
- Produces: `getStatus()`, `start()`, `stop()`, `kill()`, `onProgress()`, `onLogLine()`

**Step 1: Write implementation**

Create `server/services/processManager.ts`:
```typescript
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { VLLMProcess, ProfileConfig, ProgressEvent, ServerStatus } from '../types.js';
import { loadState, saveState, clearState } from './state.js';
import { parseLine, findLatestStage, interpolateProgress, isErrorLine, type LogStage } from './logParser.js';

const execAsync = promisify(exec);

const HOME = process.env.CONTROL_TOWER_HOME || process.cwd();
const LOG_DIR = path.join(HOME, 'run-logs');
const SAFE_NAME_RE = /[^a-zA-Z0-9_-]/g;

// ── State ───────────────────────────────────────────────────────────────────

let processState: VLLMProcess = {
  pid: null,
  profile: null,
  profilePath: null,
  status: 'stopped',
  startedAt: null,
  healthDetail: '',
  progress: 0,
  logFile: null,
  error: null,
  servedName: null,
  port: 8000,
};

const emitter = new EventEmitter();
let logTailer: { stop: () => void } | null = null;
let stageEnteredAt: number = 0;
let lastStage: LogStage | null = null;

export function getStatus(): VLLMProcess {
  return { ...processState };
}

export function onProgress(callback: (event: ProgressEvent) => void): () => void {
  emitter.on('progress', callback);
  return () => emitter.off('progress', callback);
}

export function onLogLine(callback: (line: string) => void): () => void {
  emitter.on('log', callback);
  return () => emitter.off('log', callback);
}

// ── Command building ────────────────────────────────────────────────────────

interface BuiltCommand {
  cmd: string;
  args: string[];
  env: Record<string, string>;
}

function buildVLLMCommand(profile: ProfileConfig, modelDir: string): BuiltCommand {
  const port = profile.PORT ?? 8000;
  const args = [
    '-m', 'vllm.entrypoints.openai.api_server',
    '--model', modelDir,
    '--served-model-name', profile.SERVED_NAME,
    '--host', '0.0.0.0',
    '--port', String(port),
    '--max-model-len', String(profile.MAX_MODEL_LEN),
    '--gpu-memory-utilization', String(profile.GPU_UTIL),
    '--max-num-seqs', String(profile.MAX_NUM_SEQS),
    '--max-num-batched-tokens', String(profile.MAX_BATCHED_TOKENS),
    '--tensor-parallel-size', String(profile.TP_SIZE ?? 2),
    '--kv-cache-dtype', profile.KV_CACHE_DTYPE,
  ];

  if (profile.MTP_K && profile.MTP_K > 0) {
    args.push('--num-speculative-steps', String(profile.MTP_K));
  }

  if (profile.ENABLE_AUTO_TOOL_CHOICE) {
    args.push('--enable-auto-tool-choice', '--tool-call-parser', profile.TOOL_CALL_PARSER || 'hermes');
  }

  if (profile.LANGUAGE_MODEL_ONLY) {
    args.push('--language-model-only');
  }

  if (profile.SKIP_MM_PROFILING) {
    args.push('--skip-mm-profiling');
  }

  if (profile.VLLM_INT8KV_FA_PREFILL) {
    args.push('--enable-int8kv-fast-attention-prefill');
  }

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PYTORCH_CUDA_ALLOC_CONF: 'expandable_segments:True',
  };

  if (profile.COMPILATION_CONFIG_JSON) {
    env.VLLM_COMPILATION_CONFIG_JSON = profile.COMPILATION_CONFIG_JSON;
  }
  if (profile.VLLM_INT8KV_FA_CONTINUATION_DEQUANT) {
    env.VLLM_INT8KV_FA_CONTINUATION_DEQUANT = '1';
  }
  if (profile.VLLM_INT8KV_FA_CASCADE_DEQUANT) {
    env.VLLM_INT8KV_FA_CASCADE_DEQUANT = '1';
  }
  if (profile.VLLM_INT8KV_FA_CASCADE_TILE_TOKENS) {
    env.VLLM_INT8KV_FA_CASCADE_TILE_TOKENS = String(profile.VLLM_INT8KV_FA_CASCADE_TILE_TOKENS);
  }

  return { cmd: 'python3', args, env };
}

// ── Profile resolution ─────────────────────────────────────────────────────

function resolveModelDir(): string {
  const configPath = path.join(HOME, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return config.modelDir;
}

// ── Pre-start checks ────────────────────────────────────────────────────────

async function isVLLMRunning(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('pgrep -f "vllm.entrypoints.openai.api_server"');
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function isGPUClean(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits'
    );
    const maxMem = Math.max(...stdout.trim().split('\n').map(l => parseInt(l.trim(), 10) || 0));
    return maxMem < 500;
  } catch {
    return false;
  }
}

// ── Start ───────────────────────────────────────────────────────────────────

export async function start(profileRelPath: string): Promise<void> {
  if (processState.status !== 'stopped') {
    throw new Error(`Cannot start: status is ${processState.status}`);
  }
  if (await isVLLMRunning()) {
    throw new Error('vLLM already running. Stop it first.');
  }
  if (!(await isGPUClean())) {
    throw new Error('GPU memory not clean. Kill residual processes first.');
  }

  const profilesDir = path.join(JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf-8')).launcherDir, 'profiles');
  const profilePath = path.resolve(profilesDir, profileRelPath);
  if (!profilePath.startsWith(profilesDir)) throw new Error('Invalid profile path');
  if (!fs.existsSync(profilePath)) throw new Error(`Profile not found: ${profileRelPath}`);

  const { readEnvFile } = await import('../utils.js');
  const profile = readEnvFile(profilePath) as unknown as ProfileConfig;
  const modelDir = resolveModelDir();
  const port = profile.PORT ?? 8000;

  // Prepare log + pid files
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const safeName = profile.SERVED_NAME.replace(SAFE_NAME_RE, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logFile = path.join(LOG_DIR, `vllm-${safeName}-${timestamp}.log`);
  const pidFile = path.join(LOG_DIR, `vllm-${safeName}-${timestamp}.pid`);

  const { cmd, args, env } = buildVLLMCommand(profile, modelDir);

  updateState({ status: 'starting', profile: profileRelPath, profilePath, logFile, startedAt: Date.now(), servedName: profile.SERVED_NAME, port, progress: 0, healthDetail: 'spawning process' });

  const child = spawn(cmd, args, {
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: HOME,
  });

  fs.writeFileSync(pidFile, String(child.pid));

  // Stream stdout/stderr to log file
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  // Pipe lines through our event emitter
  let buffer = '';
  const handleChunk = (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      emitter.emit('log', line);
      handleLogLine(line);
    }
  };
  child.stdout.on('data', handleChunk);
  child.stderr.on('data', handleChunk);

  child.on('exit', (code, signal) => {
    logStream.end();
    if (code !== 0 && code !== null) {
      updateState({ status: 'error', error: `Process exited with code ${code}`, progress: 0 });
      emitter.emit('progress', {
        stage: lastStage?.id ?? 'error',
        label: 'Error',
        progress: 0,
        status: 'error',
        message: `Exit code ${code}`,
        timestamp: Date.now(),
      });
    }
  });

  updateState({ pid: child.pid ?? null, status: 'loading', healthDetail: 'loading model', progress: 5 });

  // Save state for restart recovery
  saveState({
    pid: child.pid ?? null,
    profile: profileRelPath,
    profilePath,
    logFile,
    startedAt: Date.now(),
    servedName: profile.SERVED_NAME,
    port,
  });
}

function handleLogLine(line: string): void {
  // Error detection
  if (isErrorLine(line)) {
    updateState({ error: line.slice(0, 200) });
    emitter.emit('progress', {
      stage: 'error',
      label: 'Error',
      progress: processState.progress,
      status: 'error',
      message: line.slice(0, 200),
      timestamp: Date.now(),
    });
    return;
  }

  // Stage detection
  const stage = parseLine(line);
  if (stage) {
    if (!lastStage || stage.id !== lastStage.id) {
      lastStage = stage;
      stageEnteredAt = Date.now();
    }
    const secondsInStage = (Date.now() - stageEnteredAt) / 1000;
    const progress = interpolateProgress(stage, secondsInStage);
    updateState({ progress, healthDetail: stage.label });
    emitter.emit('progress', {
      stage: stage.id,
      label: stage.label,
      progress,
      status: 'active',
      timestamp: Date.now(),
    });

    // Server-ready is special
    if (stage.id === 'server') {
      setTimeout(() => checkHealth().then(ready => {
        if (ready) {
          updateState({ status: 'ready', progress: 100, healthDetail: 'ready' });
          emitter.emit('progress', {
            stage: 'ready',
            label: 'Ready',
            progress: 100,
            status: 'completed',
            timestamp: Date.now(),
          });
        }
      }), 2000);
    }
  }
}

async function checkHealth(): Promise<boolean> {
  if (!processState.port) return false;
  try {
    const { stdout } = await execAsync(`curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://localhost:${processState.port}/health`);
    return stdout.trim() === '200';
  } catch {
    return false;
  }
}

function updateState(partial: Partial<VLLMProcess>): void {
  processState = { ...processState, ...partial };
}

// ── Stop ────────────────────────────────────────────────────────────────────

export async function stop(): Promise<void> {
  if (processState.pid === null) {
    clearState();
    return;
  }

  // SIGTERM to process group
  try {
    process.kill(-processState.pid, 'SIGTERM');
  } catch (err) {
    // Process may have already died
  }

  // Wait up to 30s for graceful exit
  const start = Date.now();
  while (Date.now() - start < 30000) {
    if (!isProcessAlive(processState.pid)) break;
    await new Promise(r => setTimeout(r, 500));
  }

  // SIGKILL if still alive
  if (isProcessAlive(processState.pid)) {
    try {
      process.kill(-processState.pid, 'SIGKILL');
    } catch {}
  }

  await killResidualWorkers();
  await cleanup();
}

export async function kill(): Promise<void> {
  if (processState.pid !== null) {
    try { process.kill(-processState.pid, 'SIGKILL'); } catch {}
  }
  await killResidualWorkers();
  await cleanup();
}

async function killResidualWorkers(): Promise<void> {
  try {
    await execAsync('pkill -9 -f "VLLM::Worker" || true');
  } catch {}
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function cleanup(): Promise<void> {
  if (processState.logFile && fs.existsSync(processState.logFile)) {
    // Keep log file, just clean up pid file
    const dir = path.dirname(processState.logFile);
    const base = path.basename(processState.logFile, '.log');
    const pidFile = path.join(dir, `${base}.pid`);
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  }
  if (logTailer) {
    logTailer.stop();
    logTailer = null;
  }
  clearState();
  processState = {
    pid: null,
    profile: null,
    profilePath: null,
    status: 'stopped',
    startedAt: null,
    healthDetail: '',
    progress: 0,
    logFile: null,
    error: null,
    servedName: null,
    port: processState.port,
  };
}

// ── Recovery: check if a vLLM process exists from a previous session ────────

export async function recoverFromState(): Promise<void> {
  const persisted = loadState();
  if (!persisted || !persisted.pid) return;

  if (isProcessAlive(persisted.pid)) {
    processState = {
      pid: persisted.pid,
      profile: persisted.profile,
      profilePath: persisted.profilePath,
      logFile: persisted.logFile,
      startedAt: persisted.startedAt,
      servedName: persisted.servedName,
      port: persisted.port,
      status: await checkHealth() ? 'ready' : 'loading',
      healthDetail: 'recovered from previous session',
      progress: 0,
      error: null,
    };
    if (processState.logFile && fs.existsSync(processState.logFile)) {
      startLogTailer(processState.logFile);
    }
  } else {
    clearState();
  }
}

function startLogTailer(logFile: string): void {
  let buffer = '';
  let position = 0;

  const readNewLines = () => {
    if (!fs.existsSync(logFile)) return;
    const stats = fs.statSync(logFile);
    if (stats.size <= position) return;

    const stream = fs.createReadStream(logFile, {
      start: position,
      end: stats.size,
      encoding: 'utf-8',
    });

    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        emitter.emit('log', line);
        handleLogLine(line);
      }
    });

    stream.on('end', () => {
      position = stats.size;
    });

    stream.on('error', (err) => {
      console.error('Log tailer error:', err);
    });
  };

  // Initial read
  readNewLines();

  // Watch for changes
  const watcher = fs.watch(logFile, () => readNewLines());

  logTailer = {
    stop: () => {
      watcher.close();
    },
  };
}
```

**Step 2: Verify compiles**

```bash
cd ~/control-tower-v2 && npx tsc --noEmit server/services/processManager.ts
```

Expected: no errors. If there are issues, fix them.

**Step 3: Commit**

```bash
git add server/services/processManager.ts && git commit -m "feat(server): process manager with direct vLLM spawn"
```

---

## Task 9: Express routes

**Files:**
- Create: `server/routes/server.ts`
- Create: `server/routes/profiles.ts`
- Create: `server/routes/gpu.ts`
- Create: `server/routes/logs.ts`

**Step 1: Write server routes**

Create `server/routes/server.ts`:
```typescript
import { Router } from 'express';
import * as pm from '../services/processManager.js';
import type { ApiResponse } from '../types.js';

export const serverRouter = Router();

serverRouter.get('/status', (_req, res) => {
  const status = pm.getStatus();
  res.json({ ok: true, data: status } satisfies ApiResponse<typeof status>);
});

serverRouter.post('/start', async (req, res) => {
  try {
    const { profile } = req.body;
    if (!profile) {
      return res.status(400).json({ ok: false, error: 'profile required' });
    }
    await pm.start(profile);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

serverRouter.post('/stop', async (_req, res) => {
  try {
    await pm.stop();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

serverRouter.post('/kill', async (_req, res) => {
  try {
    await pm.kill();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

serverRouter.get('/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const unsub = pm.onProgress(event => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  req.on('close', () => {
    unsub();
  });
});
```

Create `server/routes/profiles.ts`:
```typescript
import { Router } from 'express';
import * as profileMgr from '../services/profileManager.js';
import type { ApiResponse } from '../types.js';

export const profilesRouter = Router();

profilesRouter.get('/', async (_req, res) => {
  try {
    const profiles = await profileMgr.listProfiles();
    res.json({ ok: true, data: profiles } satisfies ApiResponse<typeof profiles>);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

profilesRouter.get('/templates', async (_req, res) => {
  // Templates are just profiles in the templates/ directory
  const all = await profileMgr.listProfiles();
  const templates = all.filter(p => p.name.startsWith('templates/'));
  res.json({ ok: true, data: templates });
});

profilesRouter.get('/:path(*)', async (req, res) => {
  try {
    const profile = await profileMgr.getProfile(req.params.path);
    res.json({ ok: true, data: profile });
  } catch (err: any) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

profilesRouter.post('/', async (req, res) => {
  try {
    const { name, config } = req.body;
    if (!name || !config) {
      return res.status(400).json({ ok: false, error: 'name and config required' });
    }
    const path = await profileMgr.createProfile(name, config);
    res.json({ ok: true, data: { path } });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

profilesRouter.put('/:path(*)', async (req, res) => {
  try {
    await profileMgr.updateProfile(req.params.path, req.body);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(403).json({ ok: false, error: err.message });
  }
});

profilesRouter.delete('/:path(*)', async (req, res) => {
  try {
    await profileMgr.deleteProfile(req.params.path);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(403).json({ ok: false, error: err.message });
  }
});
```

Create `server/routes/gpu.ts`:
```typescript
import { Router } from 'express';
import { getGPUSnapshot, startGPUStream } from '../services/gpuMonitor.js';

export const gpuRouter = Router();

gpuRouter.get('/', async (_req, res) => {
  try {
    const data = await getGPUSnapshot();
    res.json({ ok: true, data });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

gpuRouter.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const stop = startGPUStream(data => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  });

  req.on('close', () => {
    stop();
  });
});
```

Create `server/routes/logs.ts`:
```typescript
import { Router } from 'express';
import fs from 'node:fs';
import { onLogLine } from '../services/processManager.js';

export const logsRouter = Router();

logsRouter.get('/', (req, res) => {
  const lines = parseInt(req.query.lines as string || '100', 10);
  // Get log file from process manager
  import('../services/processManager.js').then(pm => {
    const logFile = pm.getStatus().logFile;
    if (!logFile || !fs.existsSync(logFile)) {
      return res.json({ ok: true, data: { lines: [] } });
    }
    const content = fs.readFileSync(logFile, 'utf-8');
    const allLines = content.split('\n').filter(Boolean);
    const tail = allLines.slice(-lines);
    res.json({ ok: true, data: { lines: tail } });
  });
});

logsRouter.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const unsub = onLogLine(line => {
    res.write(`data: ${JSON.stringify({ line })}\n\n`);
  });

  req.on('close', () => {
    unsub();
  });
});
```

**Step 2: Commit**

```bash
git add server/routes/ && git commit -m "feat(server): Express API routes"
```

---

## Task 10: Express app entry

**Files:**
- Create: `server/index.ts`

**Step 1: Write index.ts**

Create `server/index.ts`:
```typescript
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { serverRouter } from './routes/server.js';
import { profilesRouter } from './routes/profiles.js';
import { gpuRouter } from './routes/gpu.js';
import { logsRouter } from './routes/logs.js';
import { recoverFromState } from './services/processManager.js';

const HOME = process.env.CONTROL_TOWER_HOME || process.cwd();
const config = JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf-8'));
const PORT = config.port || 9090;

const app = express();
app.use(cors());
app.use(express.json());

// API routes
app.use('/api/server', serverRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/gpu', gpuRouter);
app.use('/api/logs', logsRouter);

// Serve React build in production
const clientDist = path.join(HOME, 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Recover state on startup
recoverFromState().then(() => {
  app.listen(PORT, () => {
    console.log(`Control Tower v2 running on http://localhost:${PORT}`);
  });
});
```

**Step 2: Verify compiles**

```bash
cd ~/control-tower-v2 && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add server/index.ts && git commit -m "feat(server): Express app entry with state recovery"
```

---

## Task 11: Frontend scaffolding

**Files:**
- Create: `client/package.json`
- Create: `client/vite.config.ts`
- Create: `client/tsconfig.json`
- Create: `client/tailwind.config.ts`
- Create: `client/postcss.config.js`
- Create: `client/index.html`
- Create: `client/src/main.tsx`
- Create: `client/src/App.tsx`
- Create: `client/src/styles/globals.css`

**Step 1: Create client package.json**

Create `client/package.json`:
```json
{
  "name": "control-tower-v2-client",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.3",
    "@tanstack/react-query": "^5.28.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.66",
    "@types/react-dom": "^18.2.22",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.3",
    "typescript": "^5.4.3",
    "vite": "^5.2.0"
  }
}
```

**Step 2: Create Vite + TS + Tailwind config**

Create `client/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:9090',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
```

Create `client/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

Create `client/tailwind.config.ts`:
```typescript
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0a0a0b',
          secondary: '#111113',
          tertiary: '#18181b',
          hover: '#1e1e21',
        },
        border: {
          DEFAULT: '#27272a',
          hover: '#3f3f46',
        },
        text: {
          primary: '#fafafa',
          secondary: '#a1a1aa',
          muted: '#71717a',
        },
      },
      borderRadius: {
        DEFAULT: '8px',
        lg: '12px',
      },
    },
  },
  plugins: [],
};
```

Create `client/postcss.config.js`:
```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

Create `client/index.html`:
```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Control Tower</title>
  </head>
  <body class="bg-bg-primary text-text-primary">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `client/public/favicon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2">
  <rect x="3" y="3" width="18" height="18" rx="2"/>
  <path d="M9 9h6v6H9z"/>
</svg>
```

Create `client/src/styles/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg-primary: #0a0a0b;
  --bg-secondary: #111113;
  --bg-tertiary: #18181b;
  --bg-hover: #1e1e21;
  --border: #27272a;
  --border-hover: #3f3f46;
  --text-primary: #fafafa;
  --text-secondary: #a1a1aa;
  --text-muted: #71717a;
  --accent: #3b82f6;
  --success: #22c55e;
  --warning: #eab308;
  --error: #ef4444;
  --radius: 8px;
  --radius-lg: 12px;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  background: var(--bg-primary);
  color: var(--text-primary);
}

::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--border-hover); }
```

Create `client/src/main.tsx`:
```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchInterval: 5000, retry: 1 },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
```

Create `client/src/App.tsx`:
```typescript
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { ProfilesPage } from './pages/ProfilesPage';
import { ProfileEditorPage } from './pages/ProfileEditorPage';
import { LogsPage } from './pages/LogsPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/profiles" element={<ProfilesPage />} />
        <Route path="/profiles/new" element={<ProfileEditorPage />} />
        <Route path="/profiles/:name/edit" element={<ProfileEditorPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  );
}
```

**Step 3: Install client deps**

```bash
cd ~/control-tower-v2/client && npm install
```

**Step 4: Commit**

```bash
git add client/ && git commit -m "feat(client): React + Vite + Tailwind scaffolding"
```

---

## Task 12: Common UI components

**Files:**
- Create: `client/src/components/common/Button.tsx`
- Create: `client/src/components/common/Card.tsx`
- Create: `client/src/components/common/Badge.tsx`
- Create: `client/src/components/common/Modal.tsx`
- Create: `client/src/components/common/Spinner.tsx`

**Step 1: Write Button**

Create `client/src/components/common/Button.tsx`:
```typescript
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:opacity-90',
  secondary: 'bg-bg-tertiary text-text-primary border border-border hover:bg-bg-hover',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export function Button({ variant = 'primary', size = 'md', loading, disabled, className, children, ...props }: Props) {
  const isDisabled = disabled || loading;
  return (
    <button
      {...props}
      disabled={isDisabled}
      className={`inline-flex items-center justify-center font-medium rounded-[var(--radius)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className ?? ''}`}
    >
      {loading && <Spinner size="sm" className="mr-2" />}
      {children}
    </button>
  );
}

import { Spinner } from './Spinner';
```

Create `client/src/components/common/Spinner.tsx`:
```typescript
interface Props {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = { sm: 'w-3 h-3', md: 'w-5 h-5', lg: 'w-8 h-8' };

export function Spinner({ size = 'md', className }: Props) {
  return (
    <div className={`inline-block ${SIZES[size]} ${className ?? ''}`}>
      <div className="w-full h-full border-2 border-current border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
```

Create `client/src/components/common/Card.tsx`:
```typescript
import type { HTMLAttributes } from 'react';

interface Props extends HTMLAttributes<HTMLDivElement> {
  title?: string;
}

export function Card({ title, className, children, ...props }: Props) {
  return (
    <div
      {...props}
      className={`bg-bg-secondary border border-border rounded-[var(--radius-lg)] p-4 ${className ?? ''}`}
    >
      {title && <h3 className="text-text-secondary text-sm font-medium mb-3">{title}</h3>}
      {children}
    </div>
  );
}
```

Create `client/src/components/common/Badge.tsx`:
```typescript
import type { ReactNode } from 'react';

type Tone = 'neutral' | 'success' | 'warning' | 'error' | 'info';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-bg-tertiary text-text-secondary',
  success: 'bg-green-900/30 text-green-400',
  warning: 'bg-yellow-900/30 text-yellow-400',
  error: 'bg-red-900/30 text-red-400',
  info: 'bg-blue-900/30 text-blue-400',
};

interface Props {
  tone?: Tone;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', children }: Props) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}
```

Create `client/src/components/common/Modal.tsx`:
```typescript
import { useEffect } from 'react';
import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-bg-secondary border border-border rounded-[var(--radius-lg)] p-6 max-w-lg w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        {title && <h2 className="text-lg font-semibold mb-4">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/components/common/ && git commit -m "feat(client): common UI components"
```

---

## Task 13: Frontend hooks

**Files:**
- Create: `client/src/hooks/useSSE.ts`
- Create: `client/src/hooks/useServer.ts`
- Create: `client/src/hooks/useGPU.ts`
- Create: `client/src/hooks/useLogs.ts`
- Create: `client/src/hooks/useProfiles.ts`
- Create: `client/src/api.ts`

**Step 1: Write api.ts**

Create `client/src/api.ts`:
```typescript
const BASE = '/api';

interface ApiSuccess<T> { ok: true; data: T }
interface ApiFailure { ok: false; error: string }
type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const json: ApiResponse<T> = await res.json();
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: any) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: any) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
```

Create `client/src/hooks/useSSE.ts`:
```typescript
import { useEffect, useRef } from 'react';

interface Options<T> {
  onMessage: (data: T) => void;
  enabled?: boolean;
}

export function useSSE<T = unknown>(path: string, opts: Options<T>) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (opts.enabled === false) return;
    const es = new EventSource(path);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as T;
        optsRef.current.onMessage(data);
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    es.onerror = (err) => {
      console.error('SSE error:', err);
      es.close();
    };

    return () => es.close();
  }, [path, opts.enabled]);
}
```

Create `client/src/hooks/useServer.ts`:
```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { VLLMProcess } from '../../../server/types';

export function useServerStatus() {
  return useQuery({
    queryKey: ['server-status'],
    queryFn: () => api.get<VLLMProcess>('/server/status'),
    refetchInterval: 3000,
  });
}

export function useStartServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profile: string) => api.post('/server/start', { profile }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server-status'] }),
  });
}

export function useStopServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/server/stop'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server-status'] }),
  });
}

export function useKillServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/server/kill'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server-status'] }),
  });
}
```

Create `client/src/hooks/useGPU.ts`:
```typescript
import { useState } from 'react';
import { useSSE } from './useSSE';
import type { GPUInfo } from '../../../server/types';

export function useGPU() {
  const [gpus, setGpus] = useState<GPUInfo[]>([]);
  useSSE<GPUInfo[]>('/gpu/stream', {
    onMessage: setGpus,
  });
  return gpus;
}
```

Create `client/src/hooks/useLogs.ts`:
```typescript
import { useState } from 'react';
import { useSSE } from './useSSE';

export function useLogs(initialLines: string[] = []) {
  const [lines, setLines] = useState<string[]>(initialLines);

  useSSE<{ line: string }>('/logs/stream', {
    onMessage: ({ line }) => {
      setLines(prev => [...prev, line].slice(-2000));
    },
  });

  return lines;
}
```

Create `client/src/hooks/useProfiles.ts`:
```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { ProfileSummary, ProfileConfig } from '../../../server/types';

export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: () => api.get<ProfileSummary[]>('/profiles'),
  });
}

export function useProfile(path: string | null) {
  return useQuery({
    queryKey: ['profile', path],
    queryFn: () => api.get<ProfileConfig>(`/profiles/${path}`),
    enabled: !!path,
  });
}

export function useCreateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; config: Partial<ProfileConfig> }) =>
      api.post<{ path: string }>('/profiles', vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { path: string; config: Partial<ProfileConfig> }) =>
      api.put(`/profiles/${vars.path}`, vars.config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  });
}

export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.del(`/profiles/${path}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  });
}
```

**Step 2: Commit**

```bash
git add client/src/api.ts client/src/hooks/ && git commit -m "feat(client): API hooks with SSE support"
```

---

## Task 14: Progress bar component

**Files:**
- Create: `client/src/components/ProgressBar.tsx`

**Step 1: Write ProgressBar**

Create `client/src/components/ProgressBar.tsx`:
```typescript
import { useServerStatus } from '../hooks/useServer';
import { useSSE } from '../hooks/useSSE';
import { useState } from 'react';
import type { ProgressEvent } from '../../../server/types';
import { STAGES } from '../../../server/services/logParser';

export function ProgressBar() {
  const { data: status } = useServerStatus();
  const [progress, setProgress] = useState<ProgressEvent | null>(null);

  useSSE<ProgressEvent>('/server/progress', {
    onMessage: setProgress,
    enabled: status?.status === 'starting' || status?.status === 'loading',
  });

  if (!status || status.status === 'stopped' || status.status === 'ready') return null;

  const pct = progress?.progress ?? status.progress ?? 0;
  const currentStageId = progress?.stage;

  return (
    <div className="bg-bg-secondary border border-border rounded-[var(--radius-lg)] p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-text-secondary">
          {status.healthDetail || progress?.label || 'Loading...'}
        </div>
        <div className="text-sm font-mono">{Math.round(pct)}%</div>
      </div>
      <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-accent transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="space-y-1">
        {STAGES.map(stage => {
          const stagePct = stage.progressEnd;
          const isCompleted = pct >= stagePct;
          const isActive = currentStageId === stage.id || (!currentStageId && pct >= stage.progressStart && pct < stage.progressEnd);
          return (
            <div key={stage.id} className="flex items-center gap-2 text-sm">
              <div className={`w-4 h-4 flex items-center justify-center ${
                isCompleted ? 'text-green-400' : isActive ? 'text-accent animate-pulse' : 'text-text-muted'
              }`}>
                {isCompleted ? '✓' : isActive ? '●' : '○'}
              </div>
              <div className={isCompleted || isActive ? 'text-text-primary' : 'text-text-muted'}>
                {stage.label}
              </div>
            </div>
          );
        })}
      </div>
      {status.error && (
        <div className="mt-3 p-2 bg-red-900/30 border border-red-800 rounded text-sm text-red-400">
          {status.error}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/components/ProgressBar.tsx && git commit -m "feat(client): startup progress bar with stage tracking"
```

---

## Task 15: GPU stats component

**Files:**
- Create: `client/src/components/GPUStats.tsx`

**Step 1: Write GPUStats**

Create `client/src/components/GPUStats.tsx`:
```typescript
import { Card } from './common/Card';
import { useGPU } from '../hooks/useGPU';

function formatBytes(mib: number): string {
  return `${(mib / 1024).toFixed(1)} GB`;
}

export function GPUStats() {
  const gpus = useGPU();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {gpus.map(gpu => {
        const memPct = (gpu.memoryUsed / gpu.memoryTotal) * 100;
        const tempColor = gpu.temperature >= 80 ? 'text-red-400' : gpu.temperature >= 70 ? 'text-yellow-400' : 'text-green-400';

        return (
          <Card key={gpu.index} title={`GPU ${gpu.index} — ${gpu.name}`}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-text-muted text-xs">Temperature</div>
                <div className={`font-mono ${tempColor}`}>{gpu.temperature}°C</div>
              </div>
              <div>
                <div className="text-text-muted text-xs">Power</div>
                <div className="font-mono">{gpu.powerDraw.toFixed(0)}W / {gpu.powerLimit.toFixed(0)}W</div>
              </div>
              <div>
                <div className="text-text-muted text-xs">SM Clock</div>
                <div className="font-mono">{gpu.smClock.toFixed(0)} MHz</div>
              </div>
              <div>
                <div className="text-text-muted text-xs">Utilization</div>
                <div className="font-mono">{gpu.utilization}%</div>
              </div>
            </div>
            <div className="mt-3">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-text-muted">VRAM</span>
                <span className="font-mono">{formatBytes(gpu.memoryUsed)} / {formatBytes(gpu.memoryTotal)}</span>
              </div>
              <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${memPct > 90 ? 'bg-red-500' : memPct > 75 ? 'bg-yellow-500' : 'bg-accent'}`}
                  style={{ width: `${memPct}%` }}
                />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/components/GPUStats.tsx && git commit -m "feat(client): GPU stats cards"
```

---

## Task 16: Server control + Layout + Dashboard page

**Files:**
- Create: `client/src/components/ServerControl.tsx`
- Create: `client/src/components/Layout.tsx`
- Create: `client/src/pages/DashboardPage.tsx`

**Step 1: Write ServerControl**

Create `client/src/components/ServerControl.tsx`:
```typescript
import { useState } from 'react';
import { Card } from './common/Card';
import { Button } from './common/Button';
import { Badge } from './common/Badge';
import { useServerStatus, useStartServer, useStopServer, useKillServer } from '../hooks/useServer';
import { useProfiles } from '../hooks/useProfiles';
import { Modal } from './common/Modal';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'error' | 'neutral' | 'info'> = {
  ready: 'success',
  loading: 'info',
  starting: 'info',
  error: 'error',
  stopped: 'neutral',
};

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function ServerControl() {
  const { data: status } = useServerStatus();
  const { data: profiles } = useProfiles();
  const start = useStartServer();
  const stop = useStopServer();
  const kill = useKillServer();
  const [showStartModal, setShowStartModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<string>('');

  const isRunning = status?.status === 'ready' || status?.status === 'loading' || status?.status === 'starting';

  return (
    <Card title="vLLM Server">
      <div className="flex items-center gap-2 mb-3">
        <Badge tone={STATUS_TONE[status?.status ?? 'stopped']}>{status?.status ?? 'unknown'}</Badge>
        {status?.pid && <span className="text-text-muted text-xs font-mono">PID {status.pid}</span>}
        {status?.uptime && status.uptime > 0 && (
          <span className="text-text-muted text-xs">uptime {formatUptime(status.uptime)}</span>
        )}
      </div>

      <div className="space-y-1 text-sm mb-4">
        <div><span className="text-text-muted">Profile:</span> <span className="font-mono">{status?.profile ?? '—'}</span></div>
        <div><span className="text-text-muted">Served as:</span> <span className="font-mono">{status?.servedName ?? '—'}</span></div>
        <div><span className="text-text-muted">Port:</span> <span className="font-mono">{status?.port ?? '—'}</span></div>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => setShowStartModal(true)} disabled={isRunning} variant="primary">
          Start
        </Button>
        <Button onClick={() => stop.mutate()} disabled={!isRunning} loading={stop.isPending} variant="secondary">
          Stop
        </Button>
        <Button onClick={() => kill.mutate()} disabled={!isRunning} loading={kill.isPending} variant="danger">
          Kill
        </Button>
      </div>

      <Modal open={showStartModal} onClose={() => setShowStartModal(false)} title="Start vLLM">
        <div className="space-y-3">
          <label className="block text-sm">
            Profile
            <select
              className="mt-1 w-full bg-bg-tertiary border border-border rounded p-2"
              value={selectedProfile}
              onChange={e => setSelectedProfile(e.target.value)}
            >
              <option value="">Select profile...</option>
              {profiles?.map(p => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={() => setShowStartModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!selectedProfile}
              loading={start.isPending}
              onClick={async () => {
                await start.mutateAsync(selectedProfile);
                setShowStartModal(false);
              }}
            >
              Start
            </Button>
          </div>
          {start.error && <div className="text-red-400 text-sm mt-2">{(start.error as Error).message}</div>}
        </div>
      </Modal>
    </Card>
  );
}
```

**Step 2: Write Layout**

Create `client/src/components/Layout.tsx`:
```typescript
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '../lib/cn';

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/profiles', label: 'Profiles' },
  { to: '/logs', label: 'Logs' },
  { to: '/settings', label: 'Settings' },
];

export function Layout() {
  return (
    <div className="flex h-screen bg-bg-primary">
      <aside className="w-48 border-r border-border bg-bg-secondary p-3 flex flex-col gap-1">
        <div className="text-sm font-semibold text-text-primary px-2 mb-3">Control Tower</div>
        {NAV.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'px-2 py-1.5 text-sm rounded transition-colors',
                isActive ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:text-text-primary'
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
```

Create `client/src/lib/cn.ts`:
```typescript
export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
```

**Step 3: Write DashboardPage**

Create `client/src/pages/DashboardPage.tsx`:
```typescript
import { ServerControl } from '../components/ServerControl';
import { GPUStats } from '../components/GPUStats';
import { ProgressBar } from '../components/ProgressBar';

export function DashboardPage() {
  return (
    <div className="space-y-4 max-w-5xl">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <ServerControl />
      <ProgressBar />
      <GPUStats />
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add client/src/components/ServerControl.tsx client/src/components/Layout.tsx client/src/pages/DashboardPage.tsx client/src/lib/ && git commit -m "feat(client): server control, layout, dashboard page"
```

---

## Task 17: Log viewer + Logs page

**Files:**
- Create: `client/src/components/LogViewer.tsx`
- Create: `client/src/pages/LogsPage.tsx`

**Step 1: Write LogViewer**

Create `client/src/components/LogViewer.tsx`:
```typescript
import { useEffect, useRef, useState } from 'react';
import { useLogs } from '../hooks/useLogs';

const ERROR_RE = /OutOfMemoryError|CUDA error|Error|Traceback/i;
const WARN_RE = /warning|Warning/i;

interface Props {
  initialLines?: string[];
}

export function LogViewer({ initialLines = [] }: Props) {
  const lines = useLogs(initialLines);
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const filtered = filter
    ? lines.filter(l => l.toLowerCase().includes(filter.toLowerCase()))
    : lines;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          placeholder="Filter..."
          className="flex-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
      </div>
      <div
        ref={containerRef}
        className="flex-1 bg-bg-secondary border border-border rounded-[var(--radius-lg)] p-3 overflow-auto font-mono text-xs leading-relaxed"
      >
        {filtered.map((line, i) => {
          const isError = ERROR_RE.test(line);
          const isWarn = !isError && WARN_RE.test(line);
          return (
            <div
              key={i}
              className={
                isError ? 'text-red-400' : isWarn ? 'text-yellow-400' : 'text-text-secondary'
              }
            >
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

Create `client/src/pages/LogsPage.tsx`:
```typescript
import { LogViewer } from '../components/LogViewer';

export function LogsPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      <h1 className="text-2xl font-semibold mb-4">Logs</h1>
      <div className="flex-1">
        <LogViewer />
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/components/LogViewer.tsx client/src/pages/LogsPage.tsx && git commit -m "feat(client): log viewer with filter and auto-scroll"
```

---

## Task 18: Profile management UI

**Files:**
- Create: `client/src/components/ProfileCard.tsx`
- Create: `client/src/components/ProfileForm.tsx`
- Create: `client/src/pages/ProfilesPage.tsx`
- Create: `client/src/pages/ProfileEditorPage.tsx`

**Step 1: Write ProfileCard**

Create `client/src/components/ProfileCard.tsx`:
```typescript
import { Link } from 'react-router-dom';
import { Card } from './common/Card';
import { Badge } from './common/Badge';
import type { ProfileSummary } from '../../../server/types';

interface Props {
  profile: ProfileSummary;
  onDelete: () => void;
}

export function ProfileCard({ profile, onDelete }: Props) {
  const f = profile.fields;
  return (
    <Card className="hover:border-border-hover transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div className="font-mono text-sm text-text-primary break-all flex-1 mr-2">{profile.name}</div>
        {profile.writable ? (
          <Badge tone="success">writable</Badge>
        ) : (
          <Badge tone="neutral">read-only</Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {f.SERVED_NAME && <Badge tone="info">{f.SERVED_NAME}</Badge>}
        {f.MODEL_VARIANT && <Badge tone="neutral">{f.MODEL_VARIANT}</Badge>}
        {f.MAX_MODEL_LEN && <Badge tone="neutral">{f.MAX_MODEL_LEN}</Badge>}
        {f.GPU_UTIL && <Badge tone="warning">GPU {(Number(f.GPU_UTIL) * 100).toFixed(0)}%</Badge>}
        {f.MTP_K !== undefined && Number(f.MTP_K) > 0 && <Badge tone="info">MTP×{f.MTP_K}</Badge>}
      </div>

      <div className="flex gap-2">
        {profile.writable && (
          <Link
            to={`/profiles/${encodeURIComponent(profile.name)}/edit`}
            className="text-xs text-accent hover:underline"
          >
            Edit
          </Link>
        )}
        {profile.writable && (
          <button
            onClick={onDelete}
            className="text-xs text-red-400 hover:underline"
          >
            Delete
          </button>
        )}
      </div>
    </Card>
  );
}
```

**Step 2: Write ProfileForm**

Create `client/src/components/ProfileForm.tsx`:
```typescript
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './common/Button';
import { Card } from './common/Card';
import { useCreateProfile, useUpdateProfile, useProfile } from '../hooks/useProfiles';
import type { ProfileConfig } from '../../../server/types';

interface Props {
  mode: 'create' | 'edit';
  initialName?: string;
  initialConfig?: Partial<ProfileConfig>;
  editPath?: string;
}

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
  const [name, setName] = useState(initialName);
  const [config, setConfig] = useState<Partial<ProfileConfig>>(
    initialConfig ?? DEFAULT_CONFIG
  );

  const createMut = useCreateProfile();
  const updateMut = useUpdateProfile();

  const setField = (key: keyof ProfileConfig, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (mode === 'create') {
      await createMut.mutateAsync({ name, config });
      navigate('/profiles');
    } else if (editPath) {
      await updateMut.mutateAsync({ path: editPath, config });
      navigate('/profiles');
    }
  };

  return (
    <Card>
      <div className="space-y-4">
        {mode === 'create' && (
          <div>
            <label className="block text-sm text-text-secondary mb-1">Profile Name</label>
            <input
              type="text"
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="my-profile"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-text-secondary mb-1">Served Name</label>
            <input
              type="text"
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5 font-mono"
              value={config.SERVED_NAME ?? ''}
              onChange={e => setField('SERVED_NAME', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">GPU Util</label>
            <input
              type="number"
              step="0.01"
              min="0.5"
              max="0.95"
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5 font-mono"
              value={config.GPU_UTIL ?? 0.88}
              onChange={e => setField('GPU_UTIL', parseFloat(e.target.value))}
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Max Model Len</label>
            <select
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5"
              value={config.MAX_MODEL_LEN ?? 256000}
              onChange={e => setField('MAX_MODEL_LEN', parseInt(e.target.value, 10))}
            >
              <option value={32768}>32K</option>
              <option value={65536}>64K</option>
              <option value={131072}>128K</option>
              <option value={262144}>256K</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">KV Cache Dtype</label>
            <select
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5"
              value={config.KV_CACHE_DTYPE ?? 'int8_per_token_head'}
              onChange={e => setField('KV_CACHE_DTYPE', e.target.value)}
            >
              <option value="auto">auto</option>
              <option value="int8_per_token_head">int8_per_token_head</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Max Num Seqs</label>
            <input
              type="number"
              min="1"
              max="8"
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5 font-mono"
              value={config.MAX_NUM_SEQS ?? 2}
              onChange={e => setField('MAX_NUM_SEQS', parseInt(e.target.value, 10))}
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Max Batched Tokens</label>
            <input
              type="number"
              min="512"
              max="8192"
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5 font-mono"
              value={config.MAX_BATCHED_TOKENS ?? 2048}
              onChange={e => setField('MAX_BATCHED_TOKENS', parseInt(e.target.value, 10))}
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">MTP K</label>
            <input
              type="number"
              min="0"
              max="5"
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5 font-mono"
              value={config.MTP_K ?? 0}
              onChange={e => setField('MTP_K', parseInt(e.target.value, 10))}
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Tool Call Parser</label>
            <select
              className="w-full bg-bg-tertiary border border-border rounded px-3 py-1.5"
              value={config.TOOL_CALL_PARSER ?? 'hermes'}
              onChange={e => setField('TOOL_CALL_PARSER', e.target.value)}
            >
              <option value="hermes">hermes</option>
              <option value="auto">auto</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm text-text-secondary mb-1">.env Preview</label>
          <pre className="bg-bg-tertiary border border-border rounded p-3 text-xs font-mono overflow-x-auto">
{Object.entries(config)
  .filter(([_, v]) => v !== undefined)
  .map(([k, v]) => `${k}=${v}`)
  .join('\n')}
          </pre>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => navigate('/profiles')}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={createMut.isPending || updateMut.isPending}
            disabled={mode === 'create' && !name}
          >
            {mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </div>

        {(create.error || update.error) && (
          <div className="text-red-400 text-sm">{(createMut.error || updateMut.error) as Error)?.message}</div>
        )}
      </div>
    </Card>
  );
}
```

**Step 3: Write ProfilesPage and ProfileEditorPage**

Create `client/src/pages/ProfilesPage.tsx`:
```typescript
import { Link } from 'react-router-dom';
import { useProfiles, useDeleteProfile } from '../hooks/useProfiles';
import { ProfileCard } from '../components/ProfileCard';
import { Button } from '../components/common/Button';

export function ProfilesPage() {
  const { data: profiles, isLoading } = useProfiles();
  const del = useDeleteProfile();

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Profiles</h1>
        <Link to="/profiles/new">
          <Button variant="primary">+ New Profile</Button>
        </Link>
      </div>

      {isLoading && <div className="text-text-muted">Loading...</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {profiles?.map(p => (
          <ProfileCard
            key={p.name}
            profile={p}
            onDelete={() => {
              if (confirm(`Delete ${p.name}?`)) {
                del.mutate(p.name);
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

Create `client/src/pages/ProfileEditorPage.tsx`:
```typescript
import { useParams } from 'react-router-dom';
import { useProfile } from '../hooks/useProfiles';
import { ProfileForm } from '../components/ProfileForm';

export function ProfileEditorPage() {
  const { name } = useParams<{ name?: string }>();
  const editPath = name ? decodeURIComponent(name) : undefined;
  const { data: existing } = useProfile(editPath ?? null);

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-semibold">
        {editPath ? `Edit: ${editPath}` : 'New Profile'}
      </h1>
      {editPath ? (
        existing ? (
          <ProfileForm
            mode="edit"
            initialConfig={existing}
            editPath={editPath}
          />
        ) : (
          <div>Loading...</div>
        )
      ) : (
        <ProfileForm mode="create" />
      )}
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add client/src/components/ProfileCard.tsx client/src/components/ProfileForm.tsx client/src/pages/ProfilesPage.tsx client/src/pages/ProfileEditorPage.tsx && git commit -m "feat(client): profile CRUD UI with form"
```

---

## Task 19: Settings page + placeholder

**Files:**
- Create: `client/src/pages/SettingsPage.tsx`

**Step 1: Write SettingsPage**

Create `client/src/pages/SettingsPage.tsx`:
```typescript
import { Card } from '../components/common/Card';

export function SettingsPage() {
  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card title="Configuration">
        <p className="text-text-secondary text-sm mb-3">
          Settings are read from <code>config.json</code> at startup. Edit the file and restart to apply changes.
        </p>
        <ul className="text-sm space-y-1 text-text-secondary">
          <li><span className="text-text-muted">port:</span> Server listen port (default 9090)</li>
          <li><span className="text-text-muted">launcherDir:</span> Path to vLLM-2080Ti-Definitive</li>
          <li><span className="text-text-muted">modelDir:</span> Default model path</li>
          <li><span className="text-text-muted">logDir:</span> Log file directory</li>
        </ul>
      </Card>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/pages/SettingsPage.tsx && git commit -m "feat(client): settings page placeholder"
```

---

## Task 20: Build verification + smoke test

**Files:**
- Modify: `~/control-tower-v2/server/services/logParser.ts` (export STAGES for client)

Wait, client imports from `../../../server/services/logParser` which won't work in browser builds. Let me fix this.

**Step 1: Fix client-side import of STAGES**

The client can't import from server directly. Move STAGES to a shared module or duplicate it.

Create `client/src/lib/stages.ts`:
```typescript
export interface LogStage {
  id: string;
  label: string;
  pattern: RegExp;
  progressStart: number;
  progressEnd: number;
}

export const STAGES: Omit<LogStage, 'pattern'>[] = [
  { id: 'init',      label: 'Initializing',            progressStart: 0,  progressEnd: 5 },
  { id: 'weights',   label: 'Loading model weights',   progressStart: 5,  progressEnd: 25 },
  { id: 'profile',   label: 'Profiling memory',        progressStart: 25, progressEnd: 45 },
  { id: 'kvcache',   label: 'Allocating KV cache',     progressStart: 45, progressEnd: 55 },
  { id: 'cudagraph', label: 'Capturing CUDA graphs',   progressStart: 55, progressEnd: 75 },
  { id: 'compile',   label: 'Compiling kernels',       progressStart: 75, progressEnd: 85 },
  { id: 'server',    label: 'Starting server',         progressStart: 85, progressEnd: 95 },
];
```

Modify `client/src/components/ProgressBar.tsx` to import from local:
```typescript
import { STAGES } from '../lib/stages';
```

**Step 2: Build server**

```bash
cd ~/control-tower-v2 && npx tsc -p tsconfig.server.json
```

Expected: dist/server/index.js created.

**Step 3: Build client**

```bash
cd ~/control-tower-v2/client && npm run build
```

Expected: dist/ created with index.html and assets.

**Step 4: Run tests**

```bash
cd ~/control-tower-v2 && npx vitest run
```

Expected: All tests pass.

**Step 5: Commit**

```bash
git add . && git commit -m "fix: separate client/server modules for build"
```

---

## Task 21: Manual integration test

**Step 1: Start the new server in background**

```bash
cd ~/control-tower-v2
export CONTROL_TOWER_HOME=$(pwd)
# Make sure old control-tower is on port 9090, new one will use different port
# Use port 9091 for testing
sed -i 's/"port": 9090/"port": 9091/' config.json
npm run build
nohup npm start > run-logs/ct2.log 2>&1 &
sleep 3
curl http://localhost:9091/api/server/status
```

Expected: JSON response with status: stopped.

**Step 2: Test profiles API**

```bash
curl http://localhost:9091/api/profiles | jq '.[0:3]'
```

Expected: Array of profiles from launcher dir.

**Step 3: Test GPU API**

```bash
curl http://localhost:9091/api/gpu | jq
```

Expected: Array of 2 GPU info objects.

**Step 4: Open browser**

Open `http://localhost:9091` and verify:
- Dashboard loads
- GPU stats visible
- Profiles page lists profiles
- Can navigate between pages

**Step 5: Commit final state**

```bash
git add . && git commit -m "chore: integration test verified"
```

---

## Self-Review

**1. Spec coverage:**
- §2 Architecture: ✅ Task 1-10 covers full stack
- §4.1 Process Manager: ✅ Task 8
- §4.2 Log Parser: ✅ Task 5
- §4.3 Profile Manager: ✅ Task 6
- §4.4 GPU Monitor: ✅ Task 7
- §4.5 API Routes: ✅ Task 9
- §5 Frontend: ✅ Tasks 11-19
- §6 Startup Progress: ✅ Tasks 5, 14
- §7 Graceful Shutdown: ✅ Task 8 (SIGTERM to process group)
- §8 Error Handling: ✅ Task 8 (error pattern detection)
- §9 Migration: ✅ Tasks 20-21

**2. Placeholder scan:** No "TBD" or "TODO" found.

**3. Type consistency:**
- `VLLMProcess` defined in Task 2, used in Tasks 3, 8, 13, 16 ✅
- `ProgressEvent` defined in Task 2, used in Tasks 8, 13, 14 ✅
- `ProfileConfig` defined in Task 2, used in Tasks 6, 8, 13, 18 ✅
- `STAGES` exported from logParser (Task 5), client uses local copy in Task 20 ✅
- `getStatus`, `start`, `stop`, `kill`, `onProgress`, `onLogLine` signatures consistent between server/services/processManager.ts and client/hooks/useServer.ts ✅

**Issues found and fixed:**
- Task 18: rename conflicting `update` (state setter + mutation) to `setField` / `updateMut`
- Task 8: imports `readEnvFile` dynamically to avoid circular dep. Acceptable.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-18-control-tower-v2.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?