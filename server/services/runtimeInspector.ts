import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RuntimeInspectionTarget {
  port: number;
  servedName: string;
  modelDir: string;
}

export interface RuntimeEvidence {
  state: 'present' | 'absent' | 'indeterminate';
  pid: number | null;
  pgid: number | null;
  port: number;
  apiReachable: boolean;
  modelMatches: boolean;
  processMatches: boolean;
  detail: string;
}

export interface RuntimeInspector {
  inspect(target: RuntimeInspectionTarget): Promise<RuntimeEvidence>;
}

function commandLine(pid: number): string {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim();
  } catch {
    return '';
  }
}

function argument(command: string, name: string): string | null {
  const parts = command.split(/\s+/);
  const index = parts.indexOf(name);
  return index >= 0 ? parts[index + 1] ?? null : null;
}

async function portOwner(port: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ss', ['-ltnp'], { timeout: 3000 });
    const line = stdout.split(/\r?\n/).find(value => value.includes(`127.0.0.1:${port}`) || value.includes(`0.0.0.0:${port}`) || value.includes(`*:${port}`));
    const match = line?.match(/pid=(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

async function processGroup(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'pgid=', '-p', String(pid)], { timeout: 3000 });
    const value = Number(stdout.trim());
    return Number.isInteger(value) && value > 1 ? value : null;
  } catch {
    return null;
  }
}

export const runtimeInspector: RuntimeInspector = {
  async inspect(target) {
    const owner = await portOwner(target.port);
    if (!owner) {
      return {
        state: 'absent', pid: null, pgid: null, port: target.port,
        apiReachable: false, modelMatches: false, processMatches: false,
        detail: `No process owns port ${target.port}`,
      };
    }

    const command = commandLine(owner);
    const processMatches = command.includes('vllm.entrypoints.openai.api_server');
    const processPort = argument(command, '--port');
    const servedName = argument(command, '--served-model-name');
    const modelDir = argument(command, '--model');
    const identityMatches = processMatches && processPort === String(target.port) && servedName === target.servedName && modelDir === target.modelDir;
    let apiReachable = false;
    let modelMatches = false;
    try {
      const response = await fetch(`http://127.0.0.1:${target.port}/v1/models`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        apiReachable = true;
        const payload = await response.json() as { data?: Array<{ id?: string }> };
        modelMatches = payload.data?.some(model => model.id === target.servedName) ?? false;
      }
    } catch {}

    const pgid = await processGroup(owner);
    const exact = identityMatches && modelMatches;
    return {
      state: exact ? 'present' : 'indeterminate',
      pid: owner,
      pgid,
      port: target.port,
      apiReachable,
      modelMatches,
      processMatches: exact,
      detail: exact
        ? `Matching vLLM runtime remains on port ${target.port} (pid ${owner})`
        : `Port ${target.port} is owned by an unverified process (pid ${owner})`,
    };
  },
};
