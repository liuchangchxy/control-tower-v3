# Control Tower v2 — Complete Rewrite Design

**Date:** 2026-08-18
**Status:** Draft
**Tech Stack:** React + Vite + Tailwind CSS (frontend), Express + TypeScript (backend), Node.js process management (replaces bash wrapper)

---

## 1. Goals

- **Complete rewrite** of control-tower from bash/FastAPI/vanilla-JS to Node.js/React
- **Real startup progress** — parse vLLM log output to show actual loading stages
- **Profile management** — create/edit/delete profiles via UI form
- **Node.js direct process management** — replace launcher_wrapper.sh entirely
- **Minimal dark UI** — Linear/Vercel aesthetic, clean and functional
- **Single-user, local deployment** — no auth complexity, no multi-tenant

---

## 2. Architecture

```
┌─────────────────────────────────────────────────┐
│  React SPA (Vite)                               │
│  ┌───────────┬──────────┬──────────┬──────────┐ │
│  │ Dashboard │ Profiles │ Logs     │ Settings │ │
│  └─────┬─────┴────┬─────┴────┬─────┴────┬─────┘ │
│        │ SSE      │ REST     │ SSE      │ REST  │
└────────┼──────────┼──────────┼──────────┼───────┘
         │          │          │          │
┌────────┼──────────┼──────────┼──────────┼───────┐
│ Express Server (TypeScript)                     │
│  ┌─────┴──────┬────┴──────┬──┴──────┬───┴─────┐ │
│  │ processMgr │ profileMgr│ logTail │ gpuMon  │ │
│  │            │           │         │         │ │
│  │ spawn/kill │ CRUD .env │ parse   │ nvidia  │ │
│  │ health     │ templates │ stages  │ smi     │ │
│  └─────┬──────┴───────────┴─────────┴─────────┘ │
│        │ child_process.spawn                     │
│        ▼                                         │
│  vllm serve --model ... (Python process)        │
└─────────────────────────────────────────────────┘
```

### Key Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Backend | Express + TypeScript | Mature, large training corpus for AI quality |
| Frontend | React + Vite + Tailwind | Fast dev, good DX, rich ecosystem |
| Process mgmt | Node.js child_process.spawn | Full lifecycle control, better log parsing |
| Real-time | SSE (not WebSocket) | Simpler, sufficient for uni-directional push |
| Profile storage | .env files in profiles/ dir | Compatible with launcher.sh ecosystem |
| State persistence | JSON file (state.json) | Simple, no database needed |

---

## 3. Project Structure

```
control-tower/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── server/
│   ├── index.ts              # Express app entry
│   ├── routes/
│   │   ├── server.ts         # /api/server/* (start, stop, status, restart)
│   │   ├── profiles.ts       # /api/profiles/* (CRUD)
│   │   ├── gpu.ts            # /api/gpu/* (snapshot + SSE stream)
│   │   └── logs.ts           # /api/logs/* (tail + SSE stream)
│   ├── services/
│   │   ├── processManager.ts # vLLM spawn/stop/health/progress
│   │   ├── profileManager.ts # .env file CRUD + templates
│   │   ├── logParser.ts      # vLLM log stage detection
│   │   ├── gpuMonitor.ts     # nvidia-smi polling
│   │   └── state.ts          # persistent state (current profile, PID, etc.)
│   ├── types.ts              # shared TypeScript types
│   └── utils.ts              # shell helpers, file utils
├── client/
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── api.ts            # fetch wrappers + SSE hooks
│   │   ├── hooks/
│   │   │   ├── useSSE.ts     # generic SSE hook
│   │   │   ├── useServer.ts  # server status + actions
│   │   │   ├── useGPU.ts     # GPU monitoring
│   │   │   └── useLogs.ts    # log streaming
│   │   ├── components/
│   │   │   ├── Layout.tsx    # shell with sidebar nav
│   │   │   ├── Dashboard.tsx # main overview page
│   │   │   ├── ServerControl.tsx  # start/stop/status
│   │   │   ├── ProfileManager.tsx # profile list + create/edit form
│   │   │   ├── ProfileForm.tsx    # form for creating/editing profiles
│   │   │   ├── GPUStats.tsx       # GPU monitoring cards
│   │   │   ├── LogViewer.tsx      # log streaming + search
│   │   │   ├── ProgressBar.tsx    # startup progress with stages
│   │   │   └── common/           # Button, Card, Badge, Modal, etc.
│   │   └── styles/
│   │       └── globals.css   # Tailwind imports + custom properties
│   └── public/
│       └── favicon.svg
├── profiles/                 # symlink or reference to launcher profiles
│   ├── templates/            # base templates for new profiles
│   └── user/                 # user-created profiles
└── state.json                # runtime state (current profile, PID, etc.)
```

---

## 4. Backend Design

### 4.1 Process Manager (`services/processManager.ts`)

The core module. Replaces launcher_wrapper.sh entirely.

**Interface:**
```typescript
interface VLLMProcess {
  pid: number | null;
  profile: string;
  status: 'stopped' | 'starting' | 'loading' | 'ready' | 'error';
  startedAt: number | null;
  healthDetail: string;      // e.g. "loading model weights", "compiling kernels"
  progress: number;          // 0-100
  logFile: string | null;
  error: string | null;
}

interface ProcessManager {
  start(profilePath: string): Promise<void>;
  stop(): Promise<void>;
  kill(): Promise<void>;
  getStatus(): VLLMProcess;
  onProgress(callback: (progress: ProgressEvent) => void): void;
  destroy(): void;
}
```

**Start flow:**
1. Read profile `.env` file → parse into key-value pairs
2. Check no existing vllm process running (`pgrep -f vllm`)
3. Check GPU memory is clean (< 500 MiB on target GPUs)
4. Build command: `python -m vllm.entrypoints.openai.api_server` with args from profile
5. Spawn with `child_process.spawn()`, `detached: true`, pipe stdout/stderr to log file
6. Write PID file + state.json
7. Start log tailing + stage detection
8. Emit progress events via EventEmitter

**Stop flow:**
1. Send SIGTERM to process group
2. Wait 15 seconds for graceful shutdown
3. If still alive → SIGKILL
4. Kill orphaned `VLLM::Worker` processes (`pkill -9 -f`)
5. Clean PID file + state.json

**Command building** (replaces launcher.sh's profile loading):
```typescript
function buildVLLMCommand(profile: ProfileConfig): { cmd: string; args: string[]; env: Record<string, string> } {
  const args = [
    '-m', 'vllm.entrypoints.openai.api_server',
    '--model', profile.MODEL_PATH || profile.MODEL,
    '--served-model-name', profile.SERVED_NAME,
    '--host', '0.0.0.0',
    '--port', String(profile.PORT || 8000),
    '--max-model-len', String(profile.MAX_MODEL_LEN),
    '--gpu-memory-utilization', String(profile.GPU_UTIL),
    '--max-num-seqs', String(profile.MAX_NUM_SEQS),
    '--max-num-batched-tokens', String(profile.MAX_BATCHED_TOKENS),
    '--tensor-parallel-size', String(profile.TP_SIZE || 2),
    '--kv-cache-dtype', profile.KV_CACHE_DTYPE || 'auto',
    // ... more flags based on profile
  ];

  if (profile.MTP_K && Number(profile.MTP_K) > 0) {
    args.push('--num-speculative-steps', String(profile.MTP_K));
  }

  if (profile.ENABLE_AUTO_TOOL_CHOICE === '1') {
    args.push('--enable-auto-tool-choice', '--tool-call-parser', profile.TOOL_CALL_PARSER || 'hermes');
  }

  const env = {
    ...process.env,
    PYTORCH_CUDA_ALLOC_CONF: 'expandable_segments:True',
    ...(profile.COMPILATION_CONFIG_JSON ? { VLLM_COMPILATION_CONFIG_JSON: profile.COMPILATION_CONFIG_JSON } : {}),
    // int8kv env vars
    ...(profile.VLLM_INT8KV_FA_PREFILL === '1' ? { VLLM_INT8KV_FA_PREFILL: '1' } : {}),
    ...(profile.VLLM_INT8KV_FA_CONTINUATION_DEQUANT === '1' ? { VLLM_INT8KV_FA_CONTINUATION_DEQUANT: '1' } : {}),
    ...(profile.VLLM_INT8KV_FA_CASCADE_DEQUANT === '1' ? { VLLM_INT8KV_FA_CASCADE_DEQUANT: '1' } : {}),
    ...(profile.VLLM_INT8KV_FA_CASCADE_TILE_TOKENS ? { VLLM_INT8KV_FA_CASCADE_TILE_TOKENS: profile.VLLM_INT8KV_FA_CASCADE_TILE_TOKENS } : {}),
  };

  return { cmd: 'python3', args, env };
}
```

### 4.2 Log Parser (`services/logParser.ts`)

Parses vLLM log output to detect loading stages and compute progress.

**Known vLLM startup stages** (from log patterns):

| Stage | Log Pattern | Progress % |
|-------|------------|------------|
| 1. Initializing | `Initializing a VLLM engine` | 0-5% |
| 2. Loading model | `Loading model weights` | 5-25% |
| 3. Model loaded | `Model loaded` | 25-30% |
| 4. Memory profiling | `profiled.*memory` or `GPU memory` | 30-45% |
| 5. KV cache init | `KV cache` or `Memory pool` | 45-55% |
| 6. CUDA graph capture | `Capturing CUDA graphs` or `cudagraph` | 55-75% |
| 7. Compilation | `Compiling` or `torch.compile` | 75-85% |
| 8. Server ready | `Uvicorn running on` or `Application startup complete` | 85-95% |
| 9. Health OK | `GET /health` returns 200 | 95-100% |

**Implementation:**
```typescript
interface ProgressStage {
  id: string;
  label: string;        // human-readable label
  pattern: RegExp;      // log line pattern
  progressStart: number; // % when this stage starts
  progressEnd: number;   // % when this stage ends
}

const STAGES: ProgressStage[] = [
  { id: 'init',     label: 'Initializing',           pattern: /Initializing a VLLM/i,            progressStart: 0,  progressEnd: 5 },
  { id: 'weights',  label: 'Loading model weights',  pattern: /Loading model|Loading weights/i,  progressStart: 5,  progressEnd: 25 },
  { id: 'profile',  label: 'Profiling memory',       pattern: /profiled|GPU memory|determining/i, progressStart: 30, progressEnd: 45 },
  { id: 'kvcache',  label: 'Allocating KV cache',    pattern: /KV cache|Memory pool|token blocks/i, progressStart: 45, progressEnd: 55 },
  { id: 'cudagraph', label: 'Capturing CUDA graphs',  pattern: /CUDA graph|cudagraph/i,           progressStart: 55, progressEnd: 75 },
  { id: 'compile',  label: 'Compiling kernels',      pattern: /Compiling|torch.compile/i,        progressStart: 75, progressEnd: 85 },
  { id: 'server',   label: 'Starting server',        pattern: /Uvicorn|startup complete/i,       progressStart: 85, progressEnd: 95 },
];
```

The log tailer watches the log file with `fs.watch` + line-by-line reading. Each line is matched against stage patterns. When a stage is detected, progress events are emitted via SSE to the frontend.

**Error detection patterns:**
- `OutOfMemoryError` → OOM
- `CUDA error` → CUDA failure
- `EngineDeadError` → engine crash
- `Traceback` → Python exception
- Process exit with non-zero code

### 4.3 Profile Manager (`services/profileManager.ts`)

CRUD for `.env` profile files.

**Interface:**
```typescript
interface ProfileConfig {
  // Model
  MODEL_PATH: string;
  SERVED_NAME: string;
  MODEL_FAMILY: string;
  MODEL_VARIANT: string;

  // Memory
  GPU_UTIL: number;
  KV_CACHE_DTYPE: string;
  MAX_MODEL_LEN: number;
  MAX_BATCHED_TOKENS: number;
  MAX_NUM_SEQS: number;

  // Speculative
  MTP_K: number;

  // int8kv
  VLLM_INT8KV_FA_PREFILL: number;
  VLLM_INT8KV_FA_CONTINUATION_DEQUANT: number;
  VLLM_INT8KV_FA_CASCADE_DEQUANT: number;
  VLLM_INT8KV_FA_CASCADE_TILE_TOKENS: number;

  // Tool calling
  ENABLE_AUTO_TOOL_CHOICE: number;
  TOOL_CALL_PARSER: string;

  // Compilation
  COMPILATION_CONFIG_JSON: string;

  // Metadata
  COMPATIBLE_MODES: string;
  PROFILE_GROUP: string;
  LANGUAGE_MODEL_ONLY: number;
  SKIP_MM_PROFILING: number;

  // Server
  PORT: number;
  TP_SIZE: number;
}

interface ProfileManager {
  list(): Promise<ProfileSummary[]>;
  get(profilePath: string): Promise<ProfileConfig>;
  create(name: string, config: Partial<ProfileConfig>): Promise<string>;
  update(profilePath: string, config: Partial<ProfileConfig>): Promise<void>;
  delete(profilePath: string): Promise<void>;
  getTemplates(): Promise<ProfileTemplate[]>;
}
```

**Profile directory structure:**
```
profiles/
  qwen27b/
    fast/int4/*.env       # existing launcher profiles (read-only)
    normal/int4/*.env
    user/*.env             # user-created profiles (read-write)
  qwen35b/
    ...
  templates/
    base.env               # template with all fields documented
```

**Form fields for profile creation:**

| Group | Fields | Type |
|-------|--------|------|
| Model | MODEL_PATH, SERVED_NAME | text input |
| Memory | GPU_UTIL (slider 0.7-0.95), MAX_MODEL_LEN (dropdown: 32K/64K/128K/256K), KV_CACHE_DTYPE (dropdown: auto/int8_per_token_head) | form controls |
| Concurrency | MAX_NUM_SEQS (1-8), MAX_BATCHED_TOKENS (512-8192) | number input |
| Speculative | MTP_K (0-5) | number input |
| int8kv | toggle + tile tokens | toggle + dropdown |
| Tool calling | ENABLE_AUTO_TOOL_CHOICE (toggle), TOOL_CALL_PARSER (dropdown: hermes/auto) | form controls |
| Compilation | cudagraph_mode (dropdown: FULL_AND_PIECEWISE/PIECEWISE/AUTO) | dropdown |

### 4.4 GPU Monitor (`services/gpuMonitor.ts`)

Polls `nvidia-smi` every 2 seconds.

```typescript
interface GPUInfo {
  index: number;
  name: string;
  temperature: number;      // °C
  powerDraw: number;        // W
  powerLimit: number;       // W
  smClock: number;          // MHz
  memoryUsed: number;       // MiB
  memoryTotal: number;      // MiB
  utilization: number;      // %
  throttleReasons: string[];
  eccErrors: number;
}
```

Implementation: `child_process.exec('nvidia-smi --query-gpu=... --format=csv,noheader,nounits')`.

### 4.5 API Routes

```
GET    /api/server/status        → VLLMProcess status
POST   /api/server/start         → { profile: "path/to/profile.env" }
POST   /api/server/stop          → graceful stop
POST   /api/server/kill          → force kill
GET    /api/server/progress      → SSE: startup progress events

GET    /api/profiles             → list all profiles
GET    /api/profiles/:path       → get profile detail
POST   /api/profiles             → create profile
PUT    /api/profiles/:path       → update profile
DELETE /api/profiles/:path       → delete profile
GET    /api/profiles/templates   → list templates

GET    /api/gpu                  → GPU snapshot
GET    /api/gpu/stream           → SSE: GPU data every 2s

GET    /api/logs                 → last N lines
GET    /api/logs/stream          → SSE: live log lines
```

---

## 5. Frontend Design

### 5.1 Pages

| Page | Route | Content |
|------|-------|---------|
| Dashboard | `/` | Server status card, GPU overview, quick actions, startup progress (when loading) |
| Profiles | `/profiles` | Profile list with cards, create button, edit/delete actions |
| Profile Editor | `/profiles/new` or `/profiles/:path/edit` | Form with validation |
| Logs | `/logs` | Full log viewer with search, filter, auto-scroll |
| Settings | `/settings` | Port, launcher dir, API token |

### 5.2 Components

**Dashboard (`Dashboard.tsx`)**
- Server status card: status badge, PID, uptime, profile name, port
- Action buttons: Start, Stop, Restart, Kill
- Startup progress bar (visible only during `starting`/`loading` states)
- GPU overview: 2 mini cards with temp, power, VRAM bar
- Recent log lines (last 10)

**Startup Progress (`ProgressBar.tsx`)**
- Horizontal progress bar with stage labels
- Current stage highlighted
- Stage list with checkmarks for completed stages
- Error state with log excerpt

```
┌─────────────────────────────────────────────────────────┐
│  Starting vLLM...                               67%     │
│  ████████████████████████████████░░░░░░░░░░░░░░░        │
│                                                         │
│  ✓ Initializing                                         │
│  ✓ Loading model weights                                │
│  ✓ Profiling memory                                     │
│  ✓ Allocating KV cache                                  │
│  ● Capturing CUDA graphs...                             │
│  ○ Compiling kernels                                    │
│  ○ Starting server                                      │
└─────────────────────────────────────────────────────────┘
```

**Profile Manager (`ProfileManager.tsx` + `ProfileForm.tsx`)**
- Card grid of profiles with tags (model, quant, context, MTP, etc.)
- "Create New" button opens form
- Form has sections: Model, Memory, Concurrency, Advanced
- Real-time validation (GPU_UTIL range, MAX_MODEL_LEN limits)
- Preview: shows generated `.env` content before saving
- Save creates `.env` file in `profiles/user/` directory

**GPU Stats (`GPUStats.tsx`)**
- Two GPU cards (one per 2080Ti)
- Metrics: temp (color-coded), power draw, VRAM bar, SM utilization
- VRAM breakdown: model weights | KV cache | overhead
- Historical sparkline (last 5 min)

**Log Viewer (`LogViewer.tsx`)**
- Virtual scrolling for performance (react-window or similar)
- Color-coded: errors red, warnings yellow, info gray
- Search/filter by keyword
- Pause/resume auto-scroll
- Stage markers (horizontal lines between stages)

### 5.3 Design Tokens

```css
/* Linear-inspired dark theme */
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

  --accent: #3b82f6;     /* blue */
  --success: #22c55e;    /* green */
  --warning: #eab308;    /* yellow */
  --error: #ef4444;      /* red */

  --radius: 8px;
  --radius-lg: 12px;
  --shadow: 0 1px 3px rgba(0,0,0,0.3);
}
```

### 5.4 State Management

No Redux/Zustand needed. React Query (TanStack Query) for server state:

```typescript
// Server status - polled every 5s, SSE for progress
const { data: status } = useQuery({
  queryKey: ['server-status'],
  queryFn: () => fetch('/api/server/status').then(r => r.json()),
  refetchInterval: 5000,
});

// SSE for real-time progress during startup
useSSE('/api/server/progress', {
  onMessage: (event) => setProgress(JSON.parse(event.data)),
  enabled: status?.status === 'starting' || status?.status === 'loading',
});

// GPU data via SSE
useSSE('/api/gpu/stream', {
  onMessage: (event) => setGPUData(JSON.parse(event.data)),
});

// Logs via SSE
useSSE('/api/logs/stream', {
  onMessage: (event) => appendLog(JSON.parse(event.data)),
});
```

---

## 6. Startup Progress: Detailed Design

### 6.1 Log Parsing Pipeline

```
vLLM process stdout/stderr
  → append to log file (always, for persistence)
  → line-by-line parser (logParser.ts)
  → stage detection + progress calculation
  → emit ProgressEvent via EventEmitter
  → SSE endpoint forwards to frontend
  → ProgressBar component renders
```

### 6.2 Progress Events

```typescript
interface ProgressEvent {
  stage: string;           // stage id
  label: string;           // human-readable
  progress: number;        // 0-100
  status: 'active' | 'completed' | 'error';
  message?: string;        // optional detail
  timestamp: number;
}
```

### 6.3 Edge Cases

- **Fast startup** (< 30s): Skip intermediate stages, jump to completed
- **Slow startup** (> 10min): Progress bar stays at last known stage, shows elapsed time
- **Crash during startup**: Detect error patterns, show error state with log excerpt
- **OOM during startup**: Detect `OutOfMemoryError`, suggest reducing GPU_UTIL or MAX_MODEL_LEN
- **No log output**: Fall back to time-based estimation after 30s of no new log lines

---

## 7. Graceful Shutdown

Current behavior: `kill PID` → SIGKILL after 15s. No request draining.

New behavior:
1. Send SIGTERM to process group (`process.kill(-pid, 'SIGTERM')`)
2. Monitor log for `Shutting down` or process exit
3. Wait up to 30s for graceful exit
4. If still alive → SIGKILL to process group
5. Clean up orphaned worker processes
6. Update state.json

---

## 8. Error Handling

| Scenario | Detection | User Feedback |
|----------|-----------|---------------|
| OOM crash | Log pattern + exit code | "Out of memory. Try reducing GPU_UTIL or MAX_MODEL_LEN" |
| CUDA error | Log pattern | Show error with suggestion |
| Port conflict | EADDRINUSE error | "Port N is in use. Kill existing process or choose another port" |
| GPU not available | nvidia-smi failure | "Cannot communicate with GPU driver" |
| Profile invalid | Validation on create | Inline form errors |
| Process zombie | PID exists but /health fails | "Process may be hung. Force kill?" |

---

## 9. Migration Plan

1. **Phase 1**: Backend — Express server with processManager, logParser, gpuMonitor
2. **Phase 2**: Frontend — React SPA with Dashboard, ServerControl, LogViewer
3. **Phase 3**: Profile management — ProfileManager UI with form creation
4. **Phase 4**: Polish — error handling, edge cases, styling

Each phase is independently testable. The old control-tower keeps running until the new one is ready.

---

## 10. What We're NOT Building

- Authentication (single-user local deployment)
- Multi-model support (one vLLM instance at a time)
- Database (JSON state file is sufficient)
- WebSocket (SSE is sufficient for uni-directional push)
- Docker/container support
- Remote GPU management
- Chat/completions playground (separate vllm-playground service)
