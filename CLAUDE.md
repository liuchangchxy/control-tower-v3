# vLLM 2080Ti Control Panel — workspace workflow

## Development and runtime locations

- Windows is the source-editing environment for this project. Run Claude Code and the GUI CC Switch here so third-party provider routing is available.
- The canonical Control Panel build, test, deployment, and runtime checkout is on Debian `debian103`:
  `/home/chang/vllm-2080ti-control-panel`
- The canonical vLLM runtime and launcher are a separate project:
  `/home/chang/vLLM-2080Ti-Definitive-0.2.1-pre2`
- GitHub is the remote source of truth:
  `https://github.com/liuchangchxy/vllm-2080ti-control-panel`

## Two-host workflow

Edit the Windows checkout with Claude Code + CC Switch, then synchronize through GitHub. On Debian, fetch the intended commit, install dependencies as needed, run the checks, build, and deploy from the canonical Linux checkout. Do not treat Windows build output as a deployment artifact and do not copy source archives over the Debian Git checkout.

The Debian checkout is the only authoritative build and runtime tree. Keep its running service tied to the exact pushed commit. Windows may contain a working tree and local development artifacts, but it is not a second runtime or vLLM installation.

```text
Windows: Claude Code + CC Switch + source editing
    │ GitHub
Debian: fetch + test + build + deploy + Control Panel runtime
    │ launcher handoff
/home/chang/vLLM-2080Ti-Definitive-0.2.1-pre2/launcher.sh
```

## Project boundary

| Project | Path | Responsibility |
|---|---|---|
| vLLM 2080Ti Control Panel | Windows checkout and Debian `/home/chang/vllm-2080ti-control-panel` | React UI, Express API, tests, benchmarks, lifecycle orchestration |
| vLLM-2080Ti-Definitive | `/home/chang/vLLM-2080Ti-Definitive-0.2.1-pre2` | Canonical launcher and vLLM runtime, including CUDA/FlashQLA/TurboQuant/MTP configuration |

The Control Panel must invoke the canonical launcher through `launcherClient` and `ControlPlane`. It must not directly run `python -m vllm`, recreate CUDA/FlashQLA/TurboQuant/MTP/CUDA Graph setup, or perform broad process cleanup. A parseable launcher response or HTTP 200 is not proof that a model process has exited.

## Debian checks and deployment

Run these from Debian, not from the Windows checkout:

```bash
cd /home/chang/vllm-2080ti-control-panel
npx tsc -p tsconfig.server.json --noEmit
npx vitest run --config vitest.config.ts
git diff --check
npm run build
./deploy.sh
```

The Debian project may contain local runtime artifacts such as `run-logs/`, `state.json`, `node_modules/`, `dist/`, `client/dist/`, and local environment files. Never commit these, credentials, tokens, passwords, proxy secrets, or runtime state.

## CC Switch boundary

CC Switch is used on Windows because the official application is a GUI provider switcher. Do not attempt to run the official GUI on headless Debian. Debian only needs the source checkout, build/test toolchain, Control Panel service, and canonical vLLM runtime.
