import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveConfig } from '../config.js';

const execFileAsync = promisify(execFile);

export interface RuntimeDiagnosticContext {
  runId: string;
  profile?: string | null;
  servedName?: string | null;
  modelDir?: string | null;
  port?: number | null;
  pid?: number | null;
  pgid?: number | null;
}

export interface RuntimeDiagnosticEvent extends RuntimeDiagnosticContext {
  ts: string;
  phase: string;
  details?: Record<string, unknown>;
}

export interface RuntimeDiagnosticRun {
  runId: string;
  eventLog: string;
  snapshotDir: string;
}

function safeDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details) return undefined;
  return Object.fromEntries(Object.entries(details).map(([key, value]) => [key, typeof value === 'string' && value.length > 2000 ? `${value.slice(0, 2000)}…` : value]));
}

export class RuntimeDiagnostics {
  private readonly runs = new Map<string, RuntimeDiagnosticRun>();

  createRun(): RuntimeDiagnosticRun {
    const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomUUID().slice(0, 8)}`;
    const base = path.join(resolveConfig().logDir, 'diagnostics', runId);
    const run = { runId, eventLog: path.join(base, 'events.jsonl'), snapshotDir: path.join(base, 'postmortem') };
    this.runs.set(runId, run);
    try { fs.mkdirSync(base, { recursive: true }); } catch {}
    return run;
  }

  attachRun(runId: string, eventLog: string, snapshotDir?: string): RuntimeDiagnosticRun {
    const run = { runId, eventLog, snapshotDir: snapshotDir ?? path.join(path.dirname(eventLog), 'postmortem') };
    this.runs.set(runId, run);
    return run;
  }

  event(run: RuntimeDiagnosticRun | null, phase: string, context: Omit<RuntimeDiagnosticContext, 'runId'> = {}, details?: Record<string, unknown>): void {
    if (!run) return;
    const entry: RuntimeDiagnosticEvent = { ts: new Date().toISOString(), phase, runId: run.runId, ...context };
    const safe = safeDetails(details);
    if (safe) entry.details = safe;
    try {
      fs.mkdirSync(path.dirname(run.eventLog), { recursive: true });
      fs.appendFileSync(run.eventLog, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {}
  }

  async capturePostmortem(run: RuntimeDiagnosticRun | null, pid: number | null, context: Omit<RuntimeDiagnosticContext, 'runId' | 'pid'> = {}): Promise<string | null> {
    if (!run) return null;
    const files: Array<[string, string[]]> = [];
    if (pid && Number.isInteger(pid) && pid > 1) {
      files.push(['process.txt', [`/proc/${pid}/status`, `/proc/${pid}/limits`, `/proc/${pid}/cgroup`]]);
    }
    const output = path.join(run.snapshotDir, 'snapshot.txt');
    try {
      fs.mkdirSync(run.snapshotDir, { recursive: true });
      const sections: string[] = [`capturedAt=${new Date().toISOString()}`, `pid=${pid ?? ''}`];
      for (const [name, sources] of files) {
        sections.push(`\n[${name}]`);
        for (const source of sources) {
          try { sections.push(`\n--- ${source} ---\n${fs.readFileSync(source, 'utf8').slice(0, 100_000)}`); } catch (err) { sections.push(`\n--- ${source} unavailable: ${String(err)} ---`); }
        }
      }
      const commands: Array<[string, string, string[]]> = [
        ['gpu', 'nvidia-smi', ['--query-gpu=index,name,memory.used,memory.total,utilization.gpu', '--format=csv,noheader,nounits']],
        ['kernel', 'journalctl', ['-k', '--since', '10 minutes ago', '--no-pager', '-n', '200']],
      ];
      for (const [label, command, args] of commands) {
        sections.push(`\n[${label}]`);
        try { const result = await execFileAsync(command, args, { timeout: 5000, maxBuffer: 200_000 }); sections.push(result.stdout.slice(0, 100_000)); if (result.stderr) sections.push(`\nstderr: ${result.stderr.slice(0, 10_000)}`); } catch (err: any) { sections.push(`unavailable: ${String(err?.stderr || err?.message || err)}`); }
      }
      fs.writeFileSync(output, `${sections.join('\n')}\n`, 'utf8');
      this.event(run, 'postmortem_captured', { ...context, pid }, { snapshot: output });
      return output;
    } catch (err) {
      this.event(run, 'postmortem_failed', { ...context, pid }, { error: String(err) });
      return null;
    }
  }
}

export const runtimeDiagnostics = new RuntimeDiagnostics();
