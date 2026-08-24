# vLLM 2080Ti Control Panel

A visual control panel, configuration workbench, benchmark console, and runtime observability UI purpose-built for the [`vLLM-2080Ti-Definitive`](https://github.com/liuchangchxy/vLLM-2080Ti-Definitive) runtime on dual RTX 2080Ti GPUs with NVLink.

This is **not** a general-purpose vLLM distribution and it is not the vLLM runtime itself. It gives that specific runtime a safe, repeatable visual interface for profile iteration, startup observation, GPU monitoring, benchmarking, chat validation, logs, experiments, and lifecycle control.

- **Project:** vLLM 2080Ti Control Panel
- **GitHub:** https://github.com/liuchangchxy/vllm-2080ti-control-panel
- **Development/runtime host:** Debian `debian103`
- **Control Panel:** `/home/chang/vllm-2080ti-control-panel`
- **Canonical runtime:** `/home/chang/vLLM-2080Ti-Definitive-0.2.1-pre2`
- **Control Panel port:** `9092`
- **Model API port:** configured by the selected profile, normally `8000`

## Project boundary

There are two separate projects on Debian:

| Project | Path | Role |
|---|---|---|
| vLLM 2080Ti Control Panel | `/home/chang/vllm-2080ti-control-panel` | This repository: React UI, Express API, tests, benchmarks, lifecycle orchestration |
| vLLM-2080Ti-Definitive | `/home/chang/vLLM-2080Ti-Definitive-0.2.1-pre2` | Canonical launcher and vLLM runtime, including CUDA/FlashQLA/TurboQuant/MTP configuration |

The Control Panel calls the canonical `launcher.sh` and consumes its handoff. It does not recreate the vLLM command line, CUDA setup, backend selection, or arbitrary process cleanup.

## Features

- Profile editor for the runtime's vLLM configuration
- Launcher-driven start, stop, kill, restart, recovery, and lifecycle status
- Startup progress and launcher-owned log viewer
- Dual-GPU monitoring and VRAM/utilization telemetry
- Prometheus vLLM metrics and throughput history
- Streaming chat validation through the model API
- Manual and batch benchmark workflows with token/timing fields
- Experiment history, profile rollback, and startup error diagnosis
- SSE updates for progress, logs, GPU state, and metrics

## Architecture

```text
Browser
  │ REST + SSE
  ▼
vLLM 2080Ti Control Panel
  ├── React/Vite client
  ├── Express/TypeScript server
  ├── ControlPlane + launcherClient
  ├── metrics, GPU, benchmark, profile, log, experiment services
  └── /v1 proxy
        │ canonical launcher handoff
        ▼
/home/chang/vLLM-2080Ti-Definitive-0.2.1-pre2/launcher.sh
        │
        ▼
vLLM-2080Ti-Definitive runtime → dual RTX 2080Ti + NVLink
```

## Linux-only development

The only development, test, build, and runtime checkout is:

```bash
cd /home/chang/vllm-2080ti-control-panel
```

GitHub is the remote source of truth. Make changes on Debian, run checks, commit, push, and run from the exact pushed commit:

```bash
export PATH="$HOME/local/node/bin:$PATH"
npm install
npm --prefix client install
npx tsc -p tsconfig.server.json --noEmit
npx vitest run --config vitest.config.ts
npm run build
./deploy.sh
```

Windows is not a development checkout for this project.

## Runtime configuration

`config.json` belongs to the Control Panel and must keep the runtime boundary explicit:

```json
{
  "port": 9092,
  "launcherDir": "/home/chang/vLLM-2080Ti-Definitive-0.2.1-pre2",
  "modelDir": "/mnt/nas-nfs/linux挂载文件夹/models/Qwen3.8-27B-FP8",
  "cudaHome": "/usr/local/cuda-13.3",
  "logDir": "run-logs",
  "stateFile": "state.json"
}
```

Do not copy the launcher into this repository. Do not put Control Panel code into the vLLM runtime directory.

## Verification

Before calling a change complete, verify:

- Linux Git HEAD equals the pushed GitHub commit
- tracked source is clean; only runtime artifacts remain untracked
- `/api/server/status` and canonical launcher handoff agree
- `/v1/models` and a complete `/v1/chat/completions` work through the panel
- streaming completions terminate and include usage/timing data
- start, stop, kill, retry, restart, and recovery are tested
- launcher-owned logs show the selected backend evidence
- kill is confirmed by launcher state, process identity, and GPU memory behavior

See `CLAUDE.md` for the full Linux workflow and safety boundaries.
