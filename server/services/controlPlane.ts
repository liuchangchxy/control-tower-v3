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

export interface ControlPlaneDependencies {
  launcher?: typeof launcherClient;
}

export class ControlPlane {
  private busy = false;
  private processState: VLLMProcess = {
    pid: null, profile: null, profilePath: null, status: 'stopped', startedAt: null,
    uptime: 0, healthDetail: '', progress: 0, logFile: null, error: null,
    errorDiagnosis: null, servedName: null, port: 8000,
  };
  private handoff: LauncherHandoff | null = null;
  private logTailer: { stop: () => void } | null = null;
  private launcherPoll: ReturnType<typeof setInterval> | null = null;
  private lifecycleGeneration = 0;
  private pollInFlight = false;
  private lastStage: LogStage | null = null;
  private stageEnteredAt = 0;
  private readonly recentLines: string[] = [];
  private readonly emitter = new EventEmitter();
  private readonly launcher: typeof launcherClient;

  constructor(deps: ControlPlaneDependencies = {}) {
    this.launcher = deps.launcher ?? launcherClient;
  }

  getStatus(): VLLMProcess {
    const uptime = this.processState.startedAt ? Math.floor((Date.now() - this.processState.startedAt) / 1000) : 0;
    return { ...this.processState, uptime };
  }
  getEndpoint(): string { return `http://127.0.0.1:${this.processState.port}`; }
  onProgress(callback: (event: ProgressEvent) => void): () => void { this.emitter.on('progress', callback); return () => this.emitter.off('progress', callback); }
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
    const canonicalProfile = this.canonicalProfileRef(next.profile) ?? this.processState.profile;
    let authoritativeProfilePath = profilePath ?? null;
    if (canonicalProfile && this.canonicalProfileRef(authoritativeProfilePath) !== canonicalProfile) {
      try { authoritativeProfilePath = this.resolveProfile(canonicalProfile).profilePath; } catch { authoritativeProfilePath = null; }
    }
    const status = next.status === 'ready' ? 'ready' : next.status === 'error' ? 'error' : next.status === 'stopped' ? 'stopped' : 'loading';
    const backend = next.backend ?? this.processState.backend ?? null;
    const capabilities = next.capabilities ?? this.processState.launcherCapabilities ?? null;
    this.updateState({
      pid: next.pid, profile: canonicalProfile, profilePath: authoritativeProfilePath,
      status, startedAt: next.startedAt || this.processState.startedAt, logFile: next.logFile, servedName: next.servedName,
      port: next.port, error: next.error, errorDiagnosis: next.error ? analyzeError([next.error]) : null,
      healthDetail: status === 'ready' ? 'ready' : status === 'error' ? next.error || 'launcher error' : 'loading model',
      progress: status === 'ready' ? 100 : this.processState.progress,
      launcherRevision: next.launcherRevision ?? next.capabilities?.launcherRevision ?? this.processState.launcherRevision ?? null,
      launcherCapabilities: capabilities,
      backend,
    });
    if (status === 'ready') startMetricsScraping(next.port); else stopMetricsScraping();
    if (next.logFile && next.logFile !== previousLogFile) this.startLogTailer(next.logFile);
  }
  private async pollLauncher() {
    if (this.pollInFlight) return;
    const generation = this.lifecycleGeneration;
    this.pollInFlight = true;
    try {
      const next = await this.launcher.status();
      if (generation === this.lifecycleGeneration) this.applyHandoff(next);
    } catch (err) { console.error('Launcher status failed:', err); }
    finally { this.pollInFlight = false; }
  }
  private startLauncherPoll() { if (this.launcherPoll) clearInterval(this.launcherPoll); const generation = ++this.lifecycleGeneration; this.launcherPoll = setInterval(() => { if (generation === this.lifecycleGeneration) void this.pollLauncher(); }, 2000); }
  private stopLauncherPoll() { ++this.lifecycleGeneration; if (this.launcherPoll) { clearInterval(this.launcherPoll); this.launcherPoll = null; } }
  private stageProgress(overall: number, stage: LogStage) { const range = stage.progressEnd - stage.progressStart; return range <= 0 ? 100 : Math.min(100, Math.max(0, Math.round(((overall - stage.progressStart) / range) * 100))); }
  private emitProgress(stage: string, label: string, progress: number, status: ProgressEvent['status'], message?: string) { this.emitter.emit('progress', { stage, label, progress, stageProgress: stage === 'ready' ? 100 : 0, status, message, timestamp: Date.now() }); }
  private setProgress(stage: LogStage, raw: number) { const progress = Math.max(this.processState.progress, Math.round(raw)); this.updateState({ progress, healthDetail: stage.label }); this.emitter.emit('progress', { stage: stage.id, label: stage.label, progress, stageProgress: this.stageProgress(progress, stage), status: 'active', timestamp: Date.now() }); }

  async start(profileRef: string): Promise<void> { return this.withLock(async () => {
    if (this.processState.status !== 'stopped') throw new Error(`Cannot start: status is ${this.processState.status}`);
    const { profilePath, profile } = this.resolveProfile(profileRef); if (!profile.SERVED_NAME) throw new Error('Profile is missing SERVED_NAME');
    const c = this.config();
    const next = await this.launcher.start({ profile: profileRef, modelDir: c.modelDir, mode: 'fast', gpuDevices: '0,1', tpSize: profile.TP_SIZE ?? 2, port: profile.PORT ?? 8000, serviceScope: 'local' });
    this.applyHandoff(next, undefined, profilePath); this.persist(next.profile, this.resolveProfile(next.profile).profilePath, next); this.startLauncherPoll();
  }); }
  async restart(): Promise<void> { return this.withLock(async () => {
    if (!this.processState.profile) throw new Error('No profile to restart with');
    const { profilePath, profile } = this.resolveProfile(this.processState.profile); const c = this.config();
    const next = await this.launcher.restart({ profile: this.processState.profile, modelDir: c.modelDir, mode: 'fast', gpuDevices: '0,1', tpSize: profile.TP_SIZE ?? 2, port: this.processState.port, serviceScope: 'local' });
    this.applyHandoff(next, undefined, profilePath); this.persist(next.profile, this.resolveProfile(next.profile).profilePath, next); this.startLauncherPoll();
  }); }
  async stop(): Promise<void> { return this.withLock(async () => { this.applyHandoff(await this.launcher.stop()); await this.cleanup(); }); }
  async kill(): Promise<void> { return this.withLock(async () => { this.applyHandoff(await this.launcher.kill()); await this.cleanup(); }); }
  private persist(profile: string | null, profilePath: string | null, next: LauncherHandoff) { saveState({ pid: next.pid, profile, profilePath, logFile: next.logFile, startedAt: next.startedAt, servedName: next.servedName, port: next.port }); }
  private async cleanup() { this.stopLauncherPoll(); stopMetricsScraping(); if (this.logTailer) { this.logTailer.stop(); this.logTailer = null; } clearState(); const port = this.processState.port; this.processState = { pid: null, profile: null, profilePath: null, status: 'stopped', startedAt: null, uptime: 0, healthDetail: '', progress: 0, logFile: null, error: null, errorDiagnosis: null, servedName: null, port }; this.emitProgress('stopped', 'Stopped', 0, 'completed'); }
  async recoverFromState(): Promise<void> {
    const persisted = loadState();
    try {
      const current = await this.launcher.status();
      if (current.status === 'stopped' || current.pid === null) { await this.cleanup(); return; }
      const profile = current.profile;
      let profilePath: string | null = null;
      if (profile) { try { profilePath = this.resolveProfile(profile).profilePath; } catch {} }
      this.applyHandoff(current, undefined, profilePath || undefined);
      this.persist(profile || null, profilePath || null, current);
      this.startLauncherPoll();
    } catch (err) {
      console.error('Launcher recovery failed:', err);
      if (persisted?.profile) {
        this.updateState({
          pid: persisted.pid,
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
