import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { VLLMProcess, ProgressEvent, ProfileConfig } from '../types.js';
import { clearState, loadState, saveState } from './state.js';
import { parseLine, interpolateProgress, isErrorLine, extractProgressPercent, type LogStage } from './logParser.js';
import { analyzeError } from './errorAnalyzer.js';
import { launcherClient, type LauncherHandoff } from './launcherClient.js';
import { startMetricsScraping, stopMetricsScraping } from './vllmMetrics.js';
import { readEnvFile } from '../utils.js';
import { resolveConfig, type ConfigSnapshot } from '../config.js';
import { runtimeInspector } from './runtimeInspector.js';
import { runtimeDiagnostics, type RuntimeDiagnosticRun } from './runtimeDiagnostics.js';

export interface ControlPlaneDependencies {
  launcher?: typeof launcherClient;
  inspector?: typeof runtimeInspector;
}

export class ControlPlane {
  private busy = false;
  private processState: VLLMProcess = {
    pid: null, profile: null, profilePath: null, status: 'stopped', lifecyclePhase: null, lifecycleOperationStartedAt: null, startedAt: null,
    uptime: 0, healthDetail: '', progress: 0, logFile: null, error: null,
    errorDiagnosis: null, servedName: null, port: 8000,
  };
  private handoff: LauncherHandoff | null = null;
  private logTailer: { stop: () => void } | null = null;
  private launcherPoll: ReturnType<typeof setInterval> | null = null;
  private progressReplay: ProgressEvent | null = null;
  private lifecycleGeneration = 0;
  private pollInFlight = false;
  private lastStage: LogStage | null = null;
  private stageEnteredAt = 0;
  private diagnosticRun: RuntimeDiagnosticRun | null = null;
  private runtimeLossRecorded = false;
  private readyRecorded = false;
  private readonly recentLines: string[] = [];
  private readonly emitter = new EventEmitter();
  private readonly launcher: typeof launcherClient;
  private readonly inspector: typeof runtimeInspector;

  constructor(deps: ControlPlaneDependencies = {}) {
    this.launcher = deps.launcher ?? launcherClient;
    this.inspector = deps.inspector ?? runtimeInspector;
  }

  getStatus(): VLLMProcess {
    const uptime = this.processState.startedAt ? Math.floor((Date.now() - this.processState.startedAt) / 1000) : 0;
    return { ...this.processState, uptime };
  }
  onProgress(callback: (event: ProgressEvent) => void): () => void { if (this.progressReplay) queueMicrotask(() => callback(this.progressReplay!)); this.emitter.on('progress', callback); return () => this.emitter.off('progress', callback); }
  onLogLine(callback: (line: string) => void): () => void { this.emitter.on('log', callback); return () => this.emitter.off('log', callback); }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('Operation already in progress');
    this.busy = true;
    try { return await fn(); } finally { this.busy = false; }
  }
  private updateState(partial: Partial<VLLMProcess>) { this.processState = { ...this.processState, ...partial }; }
  private config(): ConfigSnapshot {
    return resolveConfig();
  }
  private resolveProfile(ref: string): { profilePath: string; profile: ProfileConfig } {
    const dir = path.join(this.config().launcherDir, 'profiles');
    const profilePath = path.resolve(dir, ref);
    if (!profilePath.startsWith(dir + path.sep) || !fs.existsSync(profilePath)) throw new Error(`Profile not found: ${ref}`);
    return { profilePath, profile: readEnvFile(profilePath) as unknown as ProfileConfig };
  }
  private canonicalProfileRef(value: string | null | undefined): string | null {
    if (!value) return null;
    const profilesDir = path.join(this.config().launcherDir, 'profiles');
    const absolute = path.resolve(value);
    if (absolute.startsWith(profilesDir + path.sep)) return path.relative(profilesDir, absolute).replace(/\\/g, '/');
    return value;
  }
  private applyHandoff(next: LauncherHandoff, _profileRef?: string, profilePath?: string) {
    const previousLogFile = this.processState.logFile;
    this.handoff = next;
    if (next.runId && next.eventLog) this.diagnosticRun = runtimeDiagnostics.attachRun(next.runId, next.eventLog, next.postmortemDir ?? undefined);
    const canonicalProfile = this.canonicalProfileRef(next.profile) ?? this.processState.profile;
    const evidence = next.runtimeEvidence;
    let authoritativeProfilePath = profilePath ?? null;
    if (canonicalProfile && this.canonicalProfileRef(authoritativeProfilePath) !== canonicalProfile) {
      try { authoritativeProfilePath = this.resolveProfile(canonicalProfile).profilePath; } catch { authoritativeProfilePath = null; }
    }
    const orphaned = next.status === 'stopped' && evidence?.state === 'present' && evidence.processMatches;
    const status = orphaned ? 'unknown' : next.status === 'ready' ? 'ready' : next.status === 'error' ? 'error' : next.status === 'stopped' ? 'stopped' : 'loading';
    const backend = next.backend ?? this.processState.backend ?? null;
    const capabilities = next.capabilities ?? this.processState.launcherCapabilities ?? null;
    this.updateState({
      pid: orphaned ? (evidence?.pid ?? this.processState.pid) : next.pid, pgid: orphaned ? (evidence?.pgid ?? this.processState.pgid) : next.pgid, profile: canonicalProfile, profilePath: authoritativeProfilePath,
      status: orphaned ? 'unknown' : status, lifecyclePhase: orphaned ? 'orphaned' : next.status, lifecycleOperationStartedAt: this.processState.lifecycleOperationStartedAt, startedAt: next.startedAt || this.processState.startedAt, logFile: next.logFile ?? this.processState.logFile, servedName: next.servedName ?? this.processState.servedName,
      port: next.port, error: orphaned ? (evidence?.detail || 'Orphaned vLLM runtime detected') : next.error, errorDiagnosis: next.error ? analyzeError([next.error]) : this.processState.errorDiagnosis,
      healthDetail: orphaned ? (evidence?.detail || 'orphaned runtime detected') : status === 'ready' ? 'ready' : status === 'error' ? next.error || 'launcher error' : status === 'stopped' ? 'stopped' : 'loading model',
      progress: status === 'ready' ? 100 : this.processState.progress,
      launcherRevision: next.launcherRevision ?? next.capabilities?.launcherRevision ?? this.processState.launcherRevision ?? null,
      launcherCapabilities: capabilities,
      backend,
      runtimeEvidence: evidence ?? this.processState.runtimeEvidence ?? null,
      apiAvailable: next.apiAvailable ?? evidence?.apiReachable ?? (status === 'ready'),
      runId: next.runId ?? this.processState.runId ?? null,
      eventLog: next.eventLog ?? this.processState.eventLog ?? null,
      stdoutFile: next.stdoutFile ?? this.processState.stdoutFile ?? null,
      stderrFile: next.stderrFile ?? this.processState.stderrFile ?? null,
      lastRuntimeObservationAt: next.heartbeat?.observedAt ?? Date.now(),
      exitCode: next.exitCode ?? this.processState.exitCode ?? null,
      exitSignal: next.exitSignal ?? this.processState.exitSignal ?? null,
      postmortemDir: next.postmortemDir ?? this.processState.postmortemDir ?? (this.diagnosticRun?.snapshotDir ?? null),
    });
    if (status === 'ready') startMetricsScraping(next.port, next.generation ?? ''); else stopMetricsScraping();
    if (next.logFile && next.logFile !== previousLogFile) this.startLogTailer(next.logFile);
  }
  private async pollLauncher() {
    if (this.pollInFlight || this.processState.lifecycleAction) return;
    const generation = this.lifecycleGeneration;
    this.pollInFlight = true;
    try {
      const next = await this.launcher.status();
      const evidence = await this.inspector.inspect({ port: next.port, servedName: next.servedName, modelDir: next.modelDir });
      const reconciled = { ...next, runtimeEvidence: evidence, apiAvailable: evidence.apiReachable && evidence.modelMatches };
      if (generation === this.lifecycleGeneration) {
        this.observeRuntime(next, evidence);
        this.applyHandoff(reconciled);
      }
    } catch (err) { console.error('Launcher status failed:', err); }
    finally { this.pollInFlight = false; }
  }
  private startLauncherPoll() { if (this.launcherPoll) clearInterval(this.launcherPoll); const generation = ++this.lifecycleGeneration; this.launcherPoll = setInterval(() => { if (generation === this.lifecycleGeneration) void this.pollLauncher(); }, 2000); }
  private stopLauncherPoll() { ++this.lifecycleGeneration; if (this.launcherPoll) { clearInterval(this.launcherPoll); this.launcherPoll = null; } }
  private resetRunState() {
    this.recentLines.length = 0;
    this.lastStage = null;
    this.stageEnteredAt = 0;
    this.updateState({ progress: 0, error: null, errorDiagnosis: null, backend: null });
  }

  private diagnosticContext() {
    return {
      profile: this.processState.profile,
      servedName: this.processState.servedName,
      port: this.processState.port,
      pid: this.processState.pid,
      pgid: this.processState.pgid,
    };
  }

  private recordDiagnostic(phase: string, details?: Record<string, unknown>) {
    runtimeDiagnostics.event(this.diagnosticRun, phase, this.diagnosticContext(), details);
  }

  private beginDiagnosticRun() {
    this.diagnosticRun = runtimeDiagnostics.createRun();
    this.runtimeLossRecorded = false;
    this.readyRecorded = false;
    this.updateState({ runId: this.diagnosticRun.runId, eventLog: this.diagnosticRun.eventLog, postmortemDir: this.diagnosticRun.snapshotDir, exitCode: null, exitSignal: null });
  }

  private observeRuntime(next: LauncherHandoff, evidence: NonNullable<LauncherHandoff['runtimeEvidence']>) {
    const wasReady = this.processState.status === 'ready' || (this.processState.pid !== null && this.processState.runtimeEvidence?.state === 'present');
    const wasTracked = this.processState.pid !== null;
    const lost = evidence.state !== 'present' && (next.status === 'stopped' || next.status === 'error' || (wasReady && !evidence.apiReachable));
    this.recordDiagnostic('runtime_observation', { launcherStatus: next.status, runtimeState: evidence.state, apiReachable: evidence.apiReachable, modelMatches: evidence.modelMatches });
    if (wasTracked && lost && !this.runtimeLossRecorded) {
      this.runtimeLossRecorded = true;
      this.recordDiagnostic('runtime_lost', { launcherStatus: next.status, runtimeState: evidence.state, detail: evidence.detail, exitCode: next.exitCode ?? null, exitSignal: next.exitSignal ?? null });
      void runtimeDiagnostics.capturePostmortem(this.diagnosticRun, this.processState.pid ?? next.pid, { profile: next.profile, servedName: next.servedName, port: next.port, pgid: this.processState.pgid ?? next.pgid });
    }
    if (next.status === 'ready' && !this.readyRecorded) {
      this.readyRecorded = true;
      this.recordDiagnostic('ready', { smokePassed: next.smokePassed });
    }
  }

  private stageProgress(overall: number, stage: LogStage) { const range = stage.progressEnd - stage.progressStart; return range <= 0 ? 100 : Math.min(100, Math.max(0, Math.round(((overall - stage.progressStart) / range) * 100))); }
  private emitProgress(stage: string, label: string, progress: number, status: ProgressEvent['status'], message?: string, progressKnown = false) { const event = { stage, label, progress, stageProgress: progressKnown ? progress : 0, progressKnown, elapsedMs: this.stageEnteredAt ? Date.now() - this.stageEnteredAt : 0, status, message, timestamp: Date.now() }; this.progressReplay = event; this.emitter.emit('progress', event); }
  private setProgress(stage: LogStage, raw: number) { const realPercent = extractProgressPercent(this.recentLines[this.recentLines.length - 1] ?? ''); const known = stage.id === 'weights' && realPercent != null; const progress = known ? Math.max(this.processState.progress, Math.round(raw)) : this.processState.progress; this.updateState({ progress, healthDetail: stage.label }); const event = { stage: stage.id, label: stage.label, progress, progressKnown: known, stageProgress: known ? this.stageProgress(progress, stage) : 0, elapsedMs: this.stageEnteredAt ? Date.now() - this.stageEnteredAt : 0, status: 'active' as const, timestamp: Date.now() }; this.progressReplay = event; this.emitter.emit('progress', event); }

  async start(profileRef: string): Promise<void> { return this.withLock(async () => {
    const generation = ++this.lifecycleGeneration;
    if (this.processState.status !== 'stopped') throw new Error(`Cannot start: status is ${this.processState.status}`);
    this.resetRunState();
    this.beginDiagnosticRun();
    const { profilePath, profile } = this.resolveProfile(profileRef); if (!profile.SERVED_NAME) throw new Error('Profile is missing SERVED_NAME');
    const c = this.config();
    this.updateState({ status: 'starting', lifecyclePhase: 'starting', lifecycleOperationStartedAt: Date.now(), lifecycleAction: null, lifecycleConfirmed: false, healthDetail: 'Starting vLLM…' });
    this.recordDiagnostic('launch_requested', { modelDir: c.modelDir, profile: profileRef, servedName: profile.SERVED_NAME });
    let next: LauncherHandoff;
    try {
      next = await this.launcher.start({ profile: profileRef, modelDir: c.modelDir, mode: 'fast', gpuDevices: '0,1', tpSize: profile.TP_SIZE ?? 2, port: profile.PORT ?? 8000, serviceScope: 'lan' });
    } catch (err) {
      this.recordDiagnostic('launcher_error', { action: 'start', error: String(err) });
      throw err;
    }
    this.recordDiagnostic('launcher_returned', { action: 'start', status: next.status, pid: next.pid, pgid: next.pgid });
    if (generation !== this.lifecycleGeneration) return;
    this.applyHandoff(next, undefined, profilePath); this.updateState({ lifecyclePhase: next.status, lifecycleOperationStartedAt: this.processState.lifecycleOperationStartedAt }); this.persist(next.profile, this.resolveProfile(next.profile).profilePath, next); this.startLauncherPoll();
    this.recordDiagnostic(next.status === 'ready' ? 'ready' : 'handoff_applied', { status: next.status, smokePassed: next.smokePassed });
    if (next.status === 'ready') this.readyRecorded = true;
  }); }
  async restart(): Promise<void> { return this.withLock(async () => {
    if (!this.processState.profile) throw new Error('No profile to restart with');
    this.resetRunState();
    this.beginDiagnosticRun();
    const { profilePath, profile } = this.resolveProfile(this.processState.profile); const c = this.config();
    this.recordDiagnostic('launch_requested', { action: 'restart', modelDir: c.modelDir, profile: this.processState.profile, servedName: profile.SERVED_NAME });
    let next: LauncherHandoff;
    try {
      next = await this.launcher.restart({ profile: this.processState.profile, modelDir: c.modelDir, mode: 'fast', gpuDevices: '0,1', tpSize: profile.TP_SIZE ?? 2, port: this.processState.port, serviceScope: 'lan' });
    } catch (err) {
      this.recordDiagnostic('launcher_error', { action: 'restart', error: String(err) });
      throw err;
    }
    this.recordDiagnostic('launcher_returned', { action: 'restart', status: next.status, pid: next.pid, pgid: next.pgid });
    this.applyHandoff(next, undefined, profilePath); this.updateState({ lifecyclePhase: next.status, lifecycleOperationStartedAt: this.processState.lifecycleOperationStartedAt }); this.persist(next.profile, this.resolveProfile(next.profile).profilePath, next); this.startLauncherPoll();
    this.recordDiagnostic(next.status === 'ready' ? 'ready' : 'handoff_applied', { action: 'restart', status: next.status, smokePassed: next.smokePassed });
    if (next.status === 'ready') this.readyRecorded = true;
  }); }
  private async executeLifecycle(action: 'stop' | 'kill'): Promise<void> {
    this.updateState({ status: action === 'kill' ? 'killing' : 'stopping',
      lifecycleAction: action,
      lifecycleError: null,
      lifecycleConfirmed: false,
      lifecyclePhase: action,
      healthDetail: `${action} requested`,
    });
    this.recordDiagnostic(`${action}_requested`);
    try {
      const next = action === 'kill' ? await this.launcher.kill() : await this.launcher.stop();
      const evidence = await this.inspector.inspect({ port: next.port, servedName: next.servedName, modelDir: next.modelDir });
      const reconciled = { ...next, runtimeEvidence: evidence, apiAvailable: evidence.apiReachable && evidence.modelMatches };
      this.applyHandoff(reconciled);
      this.recordDiagnostic(`${action}_returned`, { status: reconciled.status, pid: reconciled.pid, exitCode: reconciled.exitCode ?? null, exitSignal: reconciled.exitSignal ?? null });
      if (reconciled.status !== 'stopped' || reconciled.pid !== null || evidence.state === 'present') {
        const error = reconciled.error || `Launcher reported ${reconciled.status} after ${action}; process exit is not confirmed`;
        this.updateState({
          status: 'unknown',
          lifecycleError: error,
          lifecycleConfirmed: false,
          error,
          healthDetail: reconciled.runtimeEvidence?.detail || 'launcher stopped state not confirmed',
        });
        throw new Error(error);
      }
      this.updateState({ lifecycleConfirmed: true });
      this.recordDiagnostic('lifecycle_completed', { action });
      await this.cleanup();
    } catch (err) {
      if (this.processState.lifecycleAction === action && !this.processState.lifecycleConfirmed) {
        const error = err instanceof Error ? err.message : String(err);
        this.recordDiagnostic('lifecycle_error', { action, error });
        this.updateState({
          status: 'unknown',
          lifecycleError: error,
          lifecycleConfirmed: false,
          error,
          healthDetail: `${action} failed; process identity retained`,
        });
      }
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.lifecycleGeneration++;
    return this.executeLifecycle('stop');
  }
  async kill(): Promise<void> {
    this.lifecycleGeneration++;
    return this.executeLifecycle('kill');
  }
  private persist(profile: string | null, profilePath: string | null, next: LauncherHandoff) { saveState({ pid: next.pid, pgid: next.pgid, profile, profilePath, logFile: next.logFile, startedAt: next.startedAt, servedName: next.servedName, port: next.port, runId: next.runId ?? this.processState.runId ?? null, eventLog: next.eventLog ?? this.processState.eventLog ?? null, stdoutFile: next.stdoutFile ?? this.processState.stdoutFile ?? null, stderrFile: next.stderrFile ?? this.processState.stderrFile ?? null, lastRuntimeObservationAt: this.processState.lastRuntimeObservationAt ?? null, exitCode: next.exitCode ?? this.processState.exitCode ?? null, exitSignal: next.exitSignal ?? this.processState.exitSignal ?? null, postmortemDir: next.postmortemDir ?? this.processState.postmortemDir ?? null }); }
  private async cleanup(preserveDiagnostic = false) {
    this.stopLauncherPoll(); stopMetricsScraping(); if (this.logTailer) { this.logTailer.stop(); this.logTailer = null; } if (!preserveDiagnostic) clearState(); const port = this.processState.port; const diagnostic = preserveDiagnostic ? { runId: this.processState.runId ?? null, eventLog: this.processState.eventLog ?? null, stdoutFile: this.processState.stdoutFile ?? null, stderrFile: this.processState.stderrFile ?? null, lastRuntimeObservationAt: this.processState.lastRuntimeObservationAt ?? null, exitCode: this.processState.exitCode ?? null, exitSignal: this.processState.exitSignal ?? null, postmortemDir: this.processState.postmortemDir ?? this.diagnosticRun?.snapshotDir ?? null, profile: this.processState.profile, profilePath: this.processState.profilePath, logFile: this.processState.logFile, startedAt: this.processState.startedAt, servedName: this.processState.servedName } : { runId: null, eventLog: null, stdoutFile: null, stderrFile: null, lastRuntimeObservationAt: null, exitCode: null, exitSignal: null, postmortemDir: null, profile: null, profilePath: null, logFile: null, startedAt: null, servedName: null }; if (preserveDiagnostic) saveState({ pid: null, pgid: null, port, ...diagnostic }); this.progressReplay = null; this.processState = { pid: null, pgid: null, profile: diagnostic.profile, profilePath: diagnostic.profilePath, status: 'stopped', lifecyclePhase: null, lifecycleOperationStartedAt: null, startedAt: diagnostic.startedAt, uptime: 0, healthDetail: preserveDiagnostic ? 'runtime lost; diagnostics preserved' : '', progress: 0, progressKnown: false, logFile: diagnostic.logFile, error: preserveDiagnostic ? 'Runtime disappeared without a confirmed lifecycle stop' : null, errorDiagnosis: null, servedName: diagnostic.servedName, port, lifecycleAction: null, lifecycleError: null, lifecycleConfirmed: preserveDiagnostic ? false : true, runId: diagnostic.runId, eventLog: diagnostic.eventLog, stdoutFile: diagnostic.stdoutFile, stderrFile: diagnostic.stderrFile, lastRuntimeObservationAt: diagnostic.lastRuntimeObservationAt, exitCode: diagnostic.exitCode, exitSignal: diagnostic.exitSignal, postmortemDir: diagnostic.postmortemDir }; this.emitProgress('stopped', 'Stopped', 0, 'completed');
  }
  async recoverFromState(): Promise<void> {
    const persisted = loadState();
    try {
      const current = await this.launcher.status();
      if (persisted?.runId && persisted.eventLog) this.diagnosticRun = runtimeDiagnostics.attachRun(persisted.runId, persisted.eventLog, persisted.postmortemDir ?? undefined);
      this.updateState({ pid: persisted?.pid ?? null, pgid: persisted?.pgid ?? null, profile: persisted?.profile ?? null, profilePath: persisted?.profilePath ?? null, startedAt: persisted?.startedAt ?? null, servedName: persisted?.servedName ?? null, logFile: persisted?.logFile ?? null, port: persisted?.port ?? current.port, runId: persisted?.runId ?? null, eventLog: persisted?.eventLog ?? null, stdoutFile: persisted?.stdoutFile ?? null, stderrFile: persisted?.stderrFile ?? null, postmortemDir: persisted?.postmortemDir ?? null, exitCode: persisted?.exitCode ?? null, exitSignal: persisted?.exitSignal ?? null, lastRuntimeObservationAt: persisted?.lastRuntimeObservationAt ?? null });
      const evidence = await this.inspector.inspect({ port: current.port, servedName: current.servedName, modelDir: current.modelDir });
      const reconciled = { ...current, runtimeEvidence: evidence, apiAvailable: evidence.apiReachable && evidence.modelMatches };
      this.observeRuntime(current, evidence);
      this.recordDiagnostic(evidence.state === 'present' && evidence.processMatches ? 'recovery_runtime_present' : 'recovery_runtime_absent', { runtimeState: evidence.state, detail: evidence.detail });
      if (reconciled.status === 'stopped' || reconciled.pid === null) {
        if (evidence.state === 'present' && evidence.processMatches) {
          const profile = reconciled.profile;
          let profilePath: string | null = null;
          if (profile) { try { profilePath = this.resolveProfile(profile).profilePath; } catch {} }
          this.applyHandoff(reconciled, undefined, profilePath || undefined);
          this.persist(profile || null, profilePath || null, reconciled);
          this.startLauncherPoll();
          return;
        }
        await this.cleanup(true);
        return;
      }
      const profile = reconciled.profile;
      let profilePath: string | null = null;
      if (profile) { try { profilePath = this.resolveProfile(profile).profilePath; } catch {} }
      this.applyHandoff(reconciled, undefined, profilePath || undefined);
      this.persist(profile || null, profilePath || null, reconciled);
      this.startLauncherPoll();
    } catch (err) {
      console.error('Launcher recovery failed:', err);
      if (persisted?.profile) {
        this.updateState({
          pid: persisted.pid,
          pgid: persisted.pgid,
          profile: persisted.profile,
          profilePath: persisted.profilePath,
          startedAt: persisted.startedAt,
          servedName: persisted.servedName,
          port: persisted.port,
          logFile: persisted.logFile,
          status: 'error',
          healthDetail: 'Launcher status unavailable',
          error: 'Unable to query canonical launcher during recovery',
        });
      }
    }
  }

  private handleLogLine(line: string) {
    this.recentLines.push(line);
    if (this.recentLines.length > 50) this.recentLines.shift();
    this.emitter.emit('log', line);
    const flashqlaSelected = /Using FlashQLA legacy SM70\/SM75 GDN prefill kernel/i.test(line);
    const flashqlaFallback = /flashqla_legacy.*(?:unavailable|falling back)|falling back to Triton\/FLA/i.test(line);
    if (flashqlaSelected || flashqlaFallback) {
      if (!this.handoff?.backend) this.updateState({ backend: {
        selected: flashqlaSelected ? 'flashqla_legacy' : 'triton_fla',
        active: flashqlaSelected,
        source: 'log',
        detail: line.trim(),
      }});
    }
    if (isErrorLine(line)) {
      const diagnosis = analyzeError([...this.recentLines]);
      if (!this.handoff?.error) this.updateState({ error: diagnosis.message, errorDiagnosis: diagnosis });
      this.emitProgress('error', 'Error', this.processState.progress, 'error', diagnosis.message);
      return;
    }
    const stage = parseLine(line);
    if (!stage) return;
    if (!this.lastStage || stage.id !== this.lastStage.id) { this.lastStage = stage; this.stageEnteredAt = Date.now(); }
    this.setProgress(stage, interpolateProgress(stage, (Date.now() - this.stageEnteredAt) / 1000, extractProgressPercent(line)));
  }
  private startLogTailer(logFile: string) {
    if (this.logTailer) this.logTailer.stop();
    let pos = 0;
    let buffer = '';
    const read = () => {
      if (!fs.existsSync(logFile)) return;
      const size = fs.statSync(logFile).size;
      if (size <= pos) return;
      const stream = fs.createReadStream(logFile, { start: pos, end: size - 1, encoding: 'utf8' });
      stream.on('data', chunk => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) this.handleLogLine(line);
      });
      stream.on('end', () => { pos = size; });
    };
    read();
    let watcher: fs.FSWatcher | null = null;
    try { watcher = fs.watch(logFile, read); } catch {}
    this.logTailer = { stop: () => watcher?.close() };
  }
}

export const controlPlane = new ControlPlane();
