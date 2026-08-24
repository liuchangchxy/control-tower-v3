# Control Tower Repository Rules

## Source of truth and deployment model

- GitHub is the only formal source of truth for application code.
- Windows is the development and verification environment.
- Debian is the deployment/runtime environment, not a development checkout.
- Maintain one codebase. Do not develop separate Windows and Debian code lines.
- Every Debian deployment must identify the exact Git commit used to build and run it.
- Keep Debian's tracked application files aligned with the GitHub branch. Runtime-only files may remain untracked:
  - `run-logs/`
  - `state.json`
  - `node_modules/`
  - `dist/` and `client/dist/`
  - `.env` / `.env.local`

## Required change workflow

1. Make code changes on Windows.
2. Run the local TypeScript check and Vitest suite.
3. Review the diff and run `git diff --check`.
4. Commit the reviewed changes on the feature branch.
5. Push the commit to GitHub.
6. Synchronize Debian to that exact commit.
7. Build/restart Debian from that commit.
8. Verify Debian's `git rev-parse HEAD`, branch, working tree, service status, and runtime behavior.

Do not edit `server/`, `client/`, `shared/`, or tests directly on Debian. If a Debian fix is discovered, reproduce it on Windows, test it, commit it, push it, and redeploy the same commit.

## Synchronization when Debian network access fails

- Prefer normal Git synchronization through the configured GitHub remote.
- Debian Git must use the working Mihomo HTTP proxy when direct GitHub access fails:
  - HTTP proxy: `http://127.0.0.1:7890`
  - SOCKS port: `127.0.0.1:7891`
  - Mihomo service: `mihomo.service`
- Verify the proxy with an HTTPS request and `git ls-remote` before diagnosing Git as broken.
- If Debian cannot reach GitHub, synchronize from Windows using a complete Git bundle over SSH, not a source-only archive:
  - create a bundle containing the required commit/history;
  - copy it to Debian;
  - `git fetch` the bundle;
  - check out the exact commit;
  - verify the commit hash.
- A `git archive`, tar copy, or marker file alone is not a Git repository synchronization and must not be reported as one.

## Control Tower architecture

- Control Tower must invoke the canonical vLLM launcher; it must not directly run `python -m vllm`.
- Do not recreate vLLM CLI construction, CUDA environment setup, FlashQLA build/load logic, TurboQuant settings, MTP settings, CUDA Graph settings, or arbitrary process cleanup in Tower.
- Lifecycle authority is `ControlPlane` through `launcherClient` and the canonical launcher handoff.
- Launcher status, profile identity, PID/log identity, generation, readiness, and launcher errors are authoritative.
- Tower may expose launcher capability/backend evidence, but must not infer or override backend selection.
- Do not use broad process matching, arbitrary `pkill`, or PID cleanup outside launcher ownership.
- Keep benchmark orchestration, metrics collection, SSE subscriptions, and persistence behind testable services.

## Verification requirements

- Local baseline checks:
  - `npx tsc -p tsconfig.server.json --noEmit`
  - `npx vitest run --config vitest.config.ts`
  - `git diff --check`
- Before declaring deployment complete, verify on Debian:
  - exact Git commit and branch;
  - clean tracked working tree;
  - Tower `/api/server/status`;
  - canonical launcher status/handoff;
  - `/v1/models` and real `/v1/chat/completions` through Tower;
  - streaming completion termination;
  - start, stop, restart, and Tower recovery;
  - launcher-owned log evidence for the selected FlashQLA backend;
  - benchmark token usage and timing fields.
- Never claim that a runtime version is synchronized until the Git commit, built artifacts, and running service have all been checked.
- Never claim that a benchmark passed based only on HTTP 200; require a complete response and usage/timing data.

## Security and operations

- Do not commit credentials, tokens, passwords, proxy secrets, or runtime state.
- Do not expose credentials in logs, reports, commits, or GitHub.
- Do not commit or push without user authorization when the user has not requested it.
- Preserve launcher-owned logs and runtime state during code synchronization unless the user explicitly requests cleanup.
