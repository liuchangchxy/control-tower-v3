# Control Tower Repository Rules

## Canonical development environment

- Linux Debian host `debian103` is the only development, test, build, and runtime environment for Control Tower.
- The only Control Tower working tree is `/home/chang/control-tower-v3`.
- GitHub is the formal remote source of truth: `https://github.com/liuchangchxy/control-tower-v3.git`.
- Windows is not a development or deployment source. Do not create a second Windows code line or copy Tower source from Windows.
- Every change is made, tested, committed, and built in `/home/chang/control-tower-v3`, then pushed to GitHub. The running service must identify the exact commit that produced its build.

## Two projects — never mix them

| Project | Directory | Responsibility |
|---|---|---|
| Control Tower | `/home/chang/control-tower-v3` | This Git repository: React UI, Express server, tests, build, runtime state integration |
| Canonical vLLM runtime | `/home/chang/vLLM-2080Ti-Definitive-0.2.1-pre2` | Separate vLLM/launcher project: `launcher.sh`, model runtime, CUDA/FlashQLA/TurboQuant/MTP setup |

- `config.json.launcherDir` must point to `/home/chang/vLLM-2080Ti-Definitive-0.2.1-pre2`.
- Do not put Tower source, Tower `.git`, Tower `dist`, or Tower tests in the vLLM directory.
- Do not put vLLM source, model files, launcher state, or launcher-owned logs in the Tower repository.
- Tower may call the canonical launcher through `launcherClient`; it must not reimplement launcher behavior.
- Tower runtime files (`run-logs/`, `state.json`, `node_modules/`, `dist/`, `client/dist/`, and local env files) are local artifacts and must not be committed.

## Required Linux-only workflow

1. Work only in `/home/chang/control-tower-v3`.
2. Inspect the diff and run:
   - `npx tsc -p tsconfig.server.json --noEmit`
   - `npx vitest run --config vitest.config.ts`
   - `git diff --check`
3. Build locally in the same directory: `npm run build`.
4. Commit on the feature branch with a message that states the confirmed root cause when fixing a bug.
5. Push the exact commit to GitHub. Do not store credentials or tokens in Git remotes, scripts, logs, or commits.
6. Restart the Tower service from `/home/chang/control-tower-v3/dist/server/index.js`.
7. Verify the running process, Git commit, branch, tracked working tree, and runtime behavior.

If Debian cannot reach GitHub, use the configured Mihomo proxy (`http://127.0.0.1:7890`; SOCKS `127.0.0.1:7891`) and verify HTTPS plus `git ls-remote` before diagnosing Git. Use a complete Git bundle only as a transport fallback; never use a source-only archive and never claim that copying files synchronized Git history.

## Control Tower architecture

- Control Tower must invoke `/home/chang/vLLM-2080Ti-Definitive-0.2.1-pre2/launcher.sh`; it must not directly run `python -m vllm`.
- Do not recreate vLLM CLI construction, CUDA environment setup, FlashQLA build/load logic, TurboQuant settings, MTP settings, CUDA Graph settings, or arbitrary process cleanup in Tower.
- Lifecycle authority is `ControlPlane` through `launcherClient` and the canonical launcher handoff.
- Launcher status, profile identity, PID/PGID/log identity, generation, readiness, lifecycle result, and launcher errors are authoritative.
- Tower may expose launcher capability/backend evidence, but must not infer or override backend selection.
- Never use broad process matching, arbitrary `pkill`, or PID cleanup outside launcher ownership.
- A launcher command returning HTTP 200 or parseable JSON is not proof that the model exited. Stop/kill must preserve identity until the launcher postcondition is confirmed.
- Keep benchmark orchestration, metrics collection, SSE subscriptions, lifecycle state, and persistence behind testable services.

## Deployment and runtime boundaries

- `deploy.sh` is a Linux-local build/restart/verify helper only. It must not tar a Windows checkout over this directory, exclude `.git` and claim Git synchronization, or overwrite the vLLM project.
- Restart only the exact Tower process (`dist/server/index.js`). Never kill a PID from `state.json` directly and never stop the canonical launcher by broad process matching.
- Preserve `run-logs/`, `state.json`, launcher-owned logs, and launcher runtime state during source synchronization unless the user explicitly requests cleanup.
- `docs/canonical-launcher-artifact.md` records the external launcher artifact and its checksum; it is not an instruction to copy the launcher into Tower.

## Verification requirements

Before declaring a Linux change complete, verify:

- `git rev-parse HEAD` equals the pushed commit.
- `git branch --show-current` is the intended branch.
- `git status --short` contains only approved runtime artifacts.
- `git remote -v` contains no embedded access token or secret.
- `config.json.launcherDir` resolves to the vLLM runtime directory, not the Tower directory.
- The running command is `/home/chang/control-tower-v3/dist/server/index.js`.
- Tower `/api/server/status` and canonical launcher status/handoff agree.
- `/v1/models` and a real `/v1/chat/completions` complete successfully through Tower.
- Streaming completion terminates and includes usage/timing data.
- Start, stop, kill, retry, restart, and Tower recovery behave correctly.
- Kill is verified by launcher-owned process state and, where applicable, actual PID/PGID disappearance and GPU memory release.
- Launcher-owned logs show evidence for the selected FlashQLA backend.
- Benchmarks include token usage and timing fields; never call a benchmark passed based only on HTTP 200.

## Security and operations

- Never commit credentials, tokens, passwords, proxy secrets, or runtime state.
- Do not print secrets in reports, logs, commits, or GitHub.
- Do not commit or push without user authorization. The user has authorized the current Linux migration and deployment only; ask again for later unrelated pushes.
- Do not edit Tower source directly in the canonical vLLM directory.
- If a runtime issue is discovered in the vLLM project, record it and keep the fix within that project’s own workflow; do not silently patch it as Tower code.
