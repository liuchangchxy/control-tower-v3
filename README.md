# Control Tower v3

vLLM 配置优化工作台 + 运行时控制台。专为双 RTX 2080Ti 22GB + NVLink 设计。

**GitHub**: https://github.com/liuchangchxy/control-tower-v3
**运行环境**: debian103 (Ubuntu), 端口 9092

---

## 目录

- [架构总览](#架构总览)
- [文件结构](#文件结构)
- [数据流](#数据流)
- [关键配置](#关键配置)
- [部署](#部署)
- [已知问题和修复历史](#已知问题和修复历史)
- [调试指南](#调试指南)

---

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│  浏览器 (http://debian103:9092)                      │
│  React + Vite + Tailwind CSS + TanStack Query       │
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │Dashboard │ │Benchmark │ │  Chat    │ ...7 pages  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘             │
│       │ REST API    │ REST API   │ /v1/chat/...     │
│       │ + SSE       │            │ (直接到vLLM)      │
└───────┼─────────────┼────────────┼───────────────────┘
        │             │            │
┌───────┼─────────────┼────────────┼───────────────────┐
│  Express + TypeScript (port 9092)                    │
│       │             │            │                    │
│  ┌────┴────┐  ┌─────┴─────┐  ┌──┴──────────┐        │
│  │/api/    │  │/api/      │  │/v1/         │        │
│  │server   │  │benchmark  │  │chat proxy   │        │
│  │gpu      │  │experiments│  │(to vLLM)    │        │
│  │profiles │  │           │  │             │        │
│  │logs     │  │           │  │             │        │
│  └────┬────┘  └─────┬─────┘  └──┬──────────┘        │
│       │             │            │                    │
│  ┌────┴─────────────┴────────────┴───────────┐       │
│  │           Services Layer                   │       │
│  │  processManager  — vLLM 进程生命周期        │       │
│  │  gpuMonitor      — nvidia-smi 轮询         │       │
│  │  benchmark       — 流式计时 benchmark      │       │
│  │  vllmMetrics     — Prometheus /metrics 解析 │       │
│  │  errorAnalyzer   — 错误模式匹配+修复建议    │       │
│  │  experimentTracker — experiments.json 持久化 │       │
│  │  logParser       — 日志行→阶段检测+进度     │       │
│  │  profileManager  — .env profile 读写        │       │
│  └────────────────────────────────────────────┘       │
└───────────────────────────────────────────────────────┘
        │
        │ spawn (child_process, detached)
        ▼
┌───────────────────────────────────────────────────────┐
│  vLLM (python3 -m vllm.entrypoints.openai.api_server) │
│  port 8000 (可配置)                                    │
│  双 RTX 2080Ti 22GB + NVLink, TP=2                    │
│  Python: ~/vLLM-2080Ti-Definitive/.venv/bin/python3   │
└───────────────────────────────────────────────────────┘
```

---

## 文件结构

### 后端 (server/)

| 文件 | 职责 | 关键函数/导出 |
|------|------|--------------|
| `index.ts` | Express 入口，路由挂载，静态文件服务 | `app.listen(PORT)` |
| `types.ts` | 全部 TypeScript 类型定义 | `VLLMProcess`, `GPUInfo`, `ProfileConfig`, `VLLMMetrics`, `Experiment` |
| `utils.ts` | .env 文件解析/写入 | `parseEnvFile()`, `readEnvFile()`, `writeEnvFile()` |
| **routes/** | | |
| `server.ts` | `/api/server/*` — 状态/启停/重启/metrics SSE | `GET /status`, `POST /start`, `POST /stop`, `GET /progress`(SSE), `GET /metrics/stream`(SSE) |
| `gpu.ts` | `/api/gpu/*` — GPU 监控 | `GET /` (快照), `GET /stream` (SSE) |
| `benchmark.ts` | `/api/benchmark/*` — Benchmark | `GET /presets`, `POST /run` |
| `profiles.ts` | `/api/profiles/*` — Profile CRUD | `GET /`, `POST /`, `PUT /:path`, `DELETE /:path`, `POST /validate` |
| `experiments.ts` | `/api/experiments/*` — 实验记录 | `GET /`, `GET /:id`, `POST /`, `PATCH /:id/notes` |
| `logs.ts` | `/api/logs/*` — 日志 SSE | `GET /stream` (SSE) |
| `settings.ts` | `/api/settings/*` — 配置 | |
| **services/** | | |
| `processManager.ts` | **核心** — vLLM 进程生命周期管理 | `start()`, `stop()`, `kill()`, `restart()`, `getStatus()`, `onProgress()`, `onLogLine()`, `recoverFromState()` |
| `gpuMonitor.ts` | nvidia-smi 轮询，throttle reasons 解析 | `getGPUSnapshot()`, `parseThrottleReasons()`, `detectDisplayProcesses()`, `startGPUStream()` |
| `benchmark.ts` | 流式 benchmark，TTFT/TPOT/ITL 测量 | `runBenchmark()`, `runWarmup()`, `BENCHMARK_PRESETS`, `generatePrompt()`, `streamWithTiming()` |
| `vllmMetrics.ts` | Prometheus /metrics 解析 | `parsePrometheusMetrics()`, `startMetricsScraping()`, `getLatestMetrics()` |
| `errorAnalyzer.ts` | 错误模式匹配 → 修复建议 | `analyzeError()` — 支持 OOM, workspace_alloc, CUDA error, port_in_use |
| `logParser.ts` | 日志行 → 阶段检测 + tqdm 进度提取 | `parseLine()`, `extractProgressPercent()`, `interpolateProgress()`, `STAGES` |
| `experimentTracker.ts` | experiments.json 持久化 | `recordExperiment()`, `loadExperiments()` |
| `profileManager.ts` | Profile .env 文件 CRUD | |
| `state.ts` | state.json 持久化（进程恢复用） | `loadState()`, `saveState()`, `clearState()` |

### 前端 (client/src/)

| 文件 | 职责 |
|------|------|
| `main.tsx` | React 入口，BrowserRouter + QueryClientProvider |
| `App.tsx` | 路由定义 + **ToastProvider**（全局 Toast Context） |
| `api.ts` | REST API 封装（`/api` 前缀 + 错误处理） |
| `types.ts` | 客户端类型定义（镜像 server/types.ts） |
| **hooks/** | |
| `useSSE.ts` | **关键** — SSE 连接 hook，自动加 `/api` 前缀 |
| `useServer.ts` | 服务状态查询 + 启停 mutations |
| `useGPU.ts` | GPU SSE 流 |
| `useMetrics.ts` | Metrics SSE 流 |
| `useLogs.ts` | 日志 SSE 流 |
| `useBenchmark.ts` | Benchmark presets + run mutation |
| `useExperiments.ts` | 实验记录查询 |
| `useProfiles.ts` | Profile CRUD |
| **components/** | |
| `ServerControl.tsx` | 服务控制面板（启停/重启/kill/rollback + 错误诊断 + 全局 Toast） |
| `GPUStats.tsx` | GPU 监控（双卡对比 + throttle reasons + ECC + VRAM） |
| `MetricsPanel.tsx` | 实时 metrics（KV cache/TTFT/TPOT/throughput + KV 预警 Toast） |
| `ProgressBar.tsx` | 启动进度条（SSE + 阶段指示器） |
| `BenchmarkManual.tsx` | 手动 benchmark（preset 选择 + 结果表格） |
| `BenchmarkBatch.tsx` | 批量轮换对比（多 profile + charts + 导出） |
| `BenchmarkChart.tsx` | Chart.js 柱状图 + 折线图 |
| `LogViewer.tsx` | 日志查看器（搜索/错误跳转/下载/折叠） |
| `ProfileForm.tsx` | 65 参数 profile 编辑器（3 组：Core/Metadata/Advanced） |
| `ProfileDiff.tsx` | Profile diff 对比（高亮差异行） |
| `ProfileCard.tsx` | Profile 卡片展示 |
| `ChatMessage.tsx` | Chat 消息组件（显示 TTFT + tok/s） |
| `ExperimentTable.tsx` | 实验表格（排序/过滤） |
| `ExperimentTimeline.tsx` | 实验时间线 |
| `LoadingOverlay.tsx` | 加载遮罩 |
| `common/Toast.tsx` | **全局 Toast 系统**（ToastProvider + useToast + useToasts） |
| `common/Card.tsx` | 卡片容器 |
| `common/Button.tsx` | 按钮（primary/secondary/ghost/danger） |
| `common/Badge.tsx` | 标签（success/warning/error/info/neutral） |
| `common/Modal.tsx` | 模态框 |
| `common/Spinner.tsx` | 加载动画 |
| **pages/** | |
| `DashboardPage.tsx` | 主面板（ServerControl + ProgressBar + MetricsPanel + GPUStats） |
| `ProfilesPage.tsx` | Profile 列表 |
| `ProfileEditorPage.tsx` | Profile 创建/编辑页 |
| `BenchmarkPage.tsx` | Benchmark 页（Manual + Batch 标签切换） |
| `ChatPage.tsx` | 流式 Chat 页 |
| `ExperimentsPage.tsx` | 实验记录页（Table + Timeline 切换） |
| `LogsPage.tsx` | 日志页 |
| `SettingsPage.tsx` | 设置页 |
| **lib/** | |
| `stages.ts` | 启动阶段定义（必须与 server/logParser.ts 同步） |
| `cn.ts` | className 合并工具 |

---

## 数据流

### 1. GPU 监控 SSE 流

```
gpuMonitor.getGPUSnapshot()  ← nvidia-smi --query-gpu (每2秒)
    ↓
gpuRouter /api/gpu/stream  ← SSE endpoint
    ↓
useSSE('/gpu/stream')  ← 自动加 /api 前缀 → /api/gpu/stream
    ↓
useGPU() hook  →  GPUInfo[]  state
    ↓
GPUStats.tsx  ← 渲染双卡对比 + throttle reasons
```

### 2. vLLM 启动流程

```
ServerControl → POST /api/server/start {profile: "xxx.env"}
    ↓
processManager.start()
    ├─ 检查: isVLLMRunning(), isGPUClean()
    ├─ 读取 profile: readEnvFile(profilePath)
    ├─ 构建命令: buildVLLMCommand() → python3 -m vllm.entrypoints.openai.api_server ...
    ├─ spawn(detached) → 写 logFile + pidFile
    ├─ stdout/stderr → logParser.parseLine() → 阶段检测
    ├─ extractProgressPercent() → tqdm 进度提取
    ├─ emitter.emit('progress') → SSE /api/server/progress
    └─ 当检测到 'server' 阶段 → checkHealth() → status='ready'
        └─ startMetricsScraping() → 开始轮询 /metrics
```

### 3. Benchmark 流程

```
BenchmarkManual → POST /api/benchmark/run {presetId, rounds}
    ↓
benchmark.runBenchmark()
    ├─ runWarmup() → 先发一个请求预热
    ├─ generatePrompt(inputTokens) → 随机英文文本
    ├─ streamWithTiming() → 流式请求 vLLM /v1/chat/completions
    │   ├─ process.hrtime() 高精度计时
    │   ├─ 第一个 token → TTFT
    │   ├─ 后续 token → ITL 采样
    │   └─ 流结束 → E2E latency
    ├─ 多轮聚合 → percentile(ITL, p50/p90/p99)
    └─ recordExperiment() → experiments.json
```

### 4. Metrics 流

```
vllmMetrics.startMetricsScraping(port)  ← 每2秒 fetch /metrics
    ↓
parsePrometheusMetrics() → 解析 Prometheus 文本
    ├─ vllm:num_requests_running
    ├─ vllm:kv_cache_usage_perc
    ├─ vllm:time_to_first_token_seconds → p50/p90/p99
    ├─ vllm:prefix_cache_hit_rate (或 hits/queries 计算)
    └─ vllm:num_preemptions
    ↓
getLatestMetrics() → VLLMMetrics
    ↓
/api/server/metrics/stream (SSE)
    ↓
useMetrics() → MetricsPanel.tsx
```

---

## 关键配置

### config.json

```json
{
  "port": 9092,                          // Control Tower 监听端口
  "launcherDir": "/home/chang/vLLM-2080Ti-Definitive",  // vLLM 安装目录
  "modelDir": "/home/chang/models/Qwen3.8-27B-GPTQ-Int4", // 模型路径
  "logDir": "run-logs",                   // 日志目录（相对于项目根）
  "stateFile": "state.json"               // 进程状态持久化文件
}
```

### Profile .env 格式

Profile 文件位于 `{launcherDir}/profiles/` 下，标准 `.env` 格式：

```env
SERVED_NAME=qwen27b-fp8-fp16kv-112K-mtp3-text-only
COMPATIBLE_MODES=fast
MODEL_FAMILY=qwen
PROFILE_GROUP=qwen36-27b-fp8
MODEL_VARIANT=fp8
QUANTIZATION=fp8
MAX_MODEL_LEN=114688
GPU_UTIL=0.94
MAX_BATCHED_TOKENS=2048
MAX_NUM_SEQS=1
MTP_K=3
LANGUAGE_MODEL_ONLY=1
SKIP_MM_PROFILING=1
```

**注意**: 缺失的 key 在 `buildVLLMCommand()` 中有默认值防护（`|| 'auto'`, `?? 0.9` 等）。

### Benchmark Presets

| ID | Input | Output | 场景 |
|----|-------|--------|------|
| quick | 128 | 64 | 短问答 |
| chat | 512 | 256 | 对话场景 |
| summary | 2048 | 512 | 长文摘要 |
| longgen | 1024 | 2048 | 长文生成 |
| stress | 4096 | 1024 | 压力测试 |

### 启动阶段 (logParser.ts STAGES)

| 阶段 | ID | 进度范围 | 触发关键词 |
|------|-----|---------|-----------|
| 初始化 | init | 0-5% | `Initializing a VLLM` |
| 加载权重 | weights | 5-25% | `Loading model`, `Loading weights` |
| 内存分析 | profile | 25-45% | `Memory profiling`, `GPU memory` |
| CUDA Graph | cudagraph | 45-55% | `Capturing CUDA graphs` |
| KV Cache | kvcache | 55-65% | `KV cache memory`, `Allocating KV` |
| 编译 | compile | 65-85% | `Compiling`, `torch.compile` |
| 启动服务 | server | 85-95% | `Uvicorn`, `startup complete` |

**重要**: `client/src/lib/stages.ts` 必须与 `server/services/logParser.ts` 的 STAGES 保持同步！

---

## 部署

### 本地开发

```bash
cd control-tower-v3
npm install && cd client && npm install && cd ..
npm run dev          # 前端 :5173 + 后端热重载
```

### 部署到 debian103

```bash
# 方法1: deploy.sh（推荐）
./deploy.sh

# 方法2: 手动
rsync -avz --exclude node_modules --exclude dist --exclude .git \
  ./ debian103:/home/chang/control-tower-v3/
ssh debian103 "cd /home/chang/control-tower-v3 && npm run build && \
  pkill -f 'node dist/server'; nohup node dist/server/index.js &"
```

### Node.js 路径

debian103 的 Node.js 在非标准位置：`~/local/node/bin/node`。所有远程命令需要：

```bash
export PATH="$HOME/local/node/bin:$PATH"
```

---

## 已知问题和修复历史

### 🔴 SSE 路径缺 /api 前缀（已修复）

**症状**: GPU 面板空、进度条不动、metrics 不更新、日志不流式
**根因**: `useSSE` 创建 `EventSource('/gpu/stream')`，但服务端挂载在 `/api/gpu/stream` → 404
**修复**: `useSSE.ts` 加了 `const url = path.startsWith('/api/') ? path : \`\api${path}\``
**影响**: 所有 4 个 SSE 连接（GPU、progress、metrics、logs）

### 🔴 --kv-cache-dtype 'undefined'（已修复）

**症状**: vLLM exit code 2, `invalid choice: 'undefined'`
**根因**: profile .env 没有 `KV_CACHE_DTYPE`，`buildVLLMCommand` 无条件传递 → CLI 收到字面量 `"undefined"`
**修复**: `profile.KV_CACHE_DTYPE || 'auto'`，所有 CLI 参数加了默认值防护

### 🔴 --num-speculative-steps 不存在（已修复）

**症状**: vLLM exit code 2, `unrecognized arguments: --num-speculative-steps`
**根因**: 这个 vLLM fork 用 `--speculative-config` (JSON) 而不是 `--num-speculative-steps`
**修复**: `args.push('--speculative-config', JSON.stringify({num_speculative_tokens: profile.MTP_K}))`

### 🟡 BenchmarkBatch waitForReady 直接 break（已修复）

**症状**: benchmark 在 server 未 ready 时就运行
**根因**: `waitForReady()` 循环里直接 `break`，没有真正等待
**修复**: 改为轮询 `/api/server/status` 直到 `status === 'ready'`

### 🟡 前后端 STAGES 不同步（已修复）

**症状**: 进度条阶段显示错乱
**根因**: client `stages.ts` 和 server `logParser.ts` 的阶段顺序/进度范围不一致
**修复**: 统一为相同顺序和范围

### 🟡 Toast 未全局化（已修复）

**症状**: 只有 ServerControl 有 Toast，其他组件无法触发
**根因**: `useToasts()` 是局部 hook，每个组件独立实例
**修复**: 新增 `ToastProvider` 全局 Context + `useToast()` hook

---

## 调试指南

### vLLM 启动失败

1. 查看最新日志: `ssh debian103 "ls -lt /home/chang/control-tower-v3/run-logs/vllm-*.log | head -1"`
2. 查看错误: `ssh debian103 "tail -20 <log-file>"`
3. 常见 exit code:
   - **2**: CLI 参数错误（检查 profile .env 和 buildVLLMCommand）
   - **137**: OOM killed（GPU 内存不足，降低 GPU_UTIL 或 MAX_MODEL_LEN）
   - **139**: segfault（CUDA 兼容性问题）

### GPU 数据不显示

1. 验证后端: `curl http://debian103:9092/api/gpu/`
2. 验证 SSE: `curl -N http://debian103:9092/api/gpu/stream`
3. 检查浏览器 Network 标签: EventSource 连接到 `/api/gpu/stream` 是否 200
4. **强制刷新** `Ctrl+Shift+R` 清除 JS 缓存

### Metrics 不更新

1. 确认 vLLM 状态是 `ready`
2. 验证: `curl http://debian103:9092/api/server/metrics`
3. 确认 vLLM /metrics 端点可达: `curl http://localhost:8000/metrics`

### Profile 参数不生效

1. 检查 `buildVLLMCommand()` 是否处理了该参数
2. 缺失的参数不会传给 vLLM CLI（静默忽略）
3. 需要在 `processManager.ts` 的 `buildVLLMCommand()` 中添加对应的 `args.push()`

### 构建错误

```bash
# 前端类型检查
cd client && npx tsc --noEmit

# 后端类型检查
npx tsc -p tsconfig.server.json

# 前端构建
cd client && npx vite build
```

### 重启控制塔

```bash
ssh debian103 "pkill -f 'node dist/server/index.js'"
ssh debian103 "export PATH=\$HOME/local/node/bin:\$PATH && cd /home/chang/control-tower-v3 && nohup node dist/server/index.js > /tmp/ct.log 2>&1 &"
```

---

## 技术栈

| 层 | 技术 |
|---|------|
| 前端框架 | React 18 + TypeScript |
| 构建 | Vite 5 |
| 样式 | Tailwind CSS 3 |
| 数据获取 | TanStack Query 5 + SSE (EventSource) |
| 图表 | Chart.js 4 + react-chartjs-2 |
| 路由 | React Router 6 |
| 后端 | Express 4 + TypeScript |
| 进程管理 | Node.js child_process (detached, SIGTERM→30s→SIGKILL) |
| GPU 监控 | nvidia-smi CLI (csv + -q) |
| Metrics | Prometheus 文本解析 |
| 持久化 | JSON 文件 (state.json, experiments.json) |

---

## License

MIT
