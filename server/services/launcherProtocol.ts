export type LauncherStatus = 'starting' | 'ready' | 'error' | 'stopped';

export interface LauncherBackendCapabilities {
  flashqlaLegacy?: boolean;
  flashinfer?: boolean;
  turboquant?: boolean;
  mtp?: boolean;
}

export interface LauncherCapabilities {
  /** Capability protocol revision, independent from the launcher handoff schema. */
  protocolVersion: number;
  launcherRevision?: string;
  profileRef?: string;
  backends?: LauncherBackendCapabilities;
}

export type LauncherBackendName = 'flashqla_legacy' | 'flashinfer' | 'triton_fla' | string;

export interface LauncherBackendEvidence {
  selected: LauncherBackendName | null;
  active: boolean | null;
  source: 'launcher' | 'log' | null;
  detail: string | null;
}

export interface LauncherHandoff {
  schemaVersion: 1;
  status: LauncherStatus;
  profile: string;
  servedName: string;
  modelDir: string;
  pid: number | null;
  pgid: number | null;
  pidFile: string;
  logFile: string | null;
  stateFile: string;
  port: number;
  startedAt: number;
  healthUrl: string;
  smokePassed: boolean;
  error: string | null;
  /** Optional fields emitted by newer launcher revisions. */
  generation?: string;
  sequence?: number;
  launcherRevision?: string;
  capabilities?: LauncherCapabilities;
  backend?: LauncherBackendEvidence;
  /** Optional runtime evidence from identity-scoped reconciliation. */
  runtimeEvidence?: {
    state: 'present' | 'absent' | 'indeterminate';
    pid: number | null;
    pgid: number | null;
    port: number;
    apiReachable: boolean;
    modelMatches: boolean;
    processMatches: boolean;
    detail: string;
  };
  apiAvailable?: boolean;
}

export interface LauncherRequest {
  profile: string;
  modelDir: string;
  mode?: string;
  gpuDevices?: string;
  tpSize?: number;
  port?: number;
  serviceScope?: string;
  logDir?: string;
  startTimeout?: number;
  skipStartupSmoke?: boolean;
}

const statuses = new Set<LauncherStatus>(['starting', 'ready', 'error', 'stopped']);

function validateCapabilities(value: unknown): asserts value is LauncherCapabilities {
  if (!value || typeof value !== 'object') throw new Error('Invalid launcher capabilities');
  const capabilities = value as Partial<LauncherCapabilities>;
  if (typeof capabilities.protocolVersion !== 'number' || !Number.isInteger(capabilities.protocolVersion) || capabilities.protocolVersion < 1) {
    throw new Error('Invalid launcher capability protocol version');
  }
  if (capabilities.launcherRevision !== undefined && typeof capabilities.launcherRevision !== 'string') {
    throw new Error('Invalid launcher capability revision');
  }
  if (capabilities.profileRef !== undefined && typeof capabilities.profileRef !== 'string') {
    throw new Error('Invalid launcher capability profile');
  }
  if (capabilities.backends !== undefined) {
    if (!capabilities.backends || typeof capabilities.backends !== 'object') throw new Error('Invalid launcher backend capabilities');
    for (const key of ['flashqlaLegacy', 'flashinfer', 'turboquant', 'mtp'] as const) {
      const value = capabilities.backends[key];
      if (value !== undefined && typeof value !== 'boolean') throw new Error(`Invalid launcher backend capability: ${key}`);
    }
  }
}

function validateBackendEvidence(value: unknown): asserts value is LauncherBackendEvidence {
  if (!value || typeof value !== 'object') throw new Error('Invalid launcher backend evidence');
  const evidence = value as Partial<LauncherBackendEvidence>;
  if (evidence.selected !== null && typeof evidence.selected !== 'string') throw new Error('Invalid selected launcher backend');
  if (evidence.active !== null && typeof evidence.active !== 'boolean') throw new Error('Invalid launcher backend active state');
  if (evidence.source !== null && evidence.source !== 'launcher' && evidence.source !== 'log') throw new Error('Invalid launcher backend evidence source');
  if (evidence.detail !== null && typeof evidence.detail !== 'string') throw new Error('Invalid launcher backend evidence detail');
}

export function validateLauncherHandoff(value: unknown): asserts value is LauncherHandoff {
  if (!value || typeof value !== 'object') throw new Error('Launcher handoff must be an object');
  const handoff = value as Partial<LauncherHandoff>;
  if (handoff.schemaVersion !== 1) {
    throw new Error(`Unsupported launcher handoff schema: ${String(handoff.schemaVersion)}`);
  }
  if (!statuses.has(handoff.status as LauncherStatus)) throw new Error('Invalid launcher status');
  if (typeof handoff.profile !== 'string') throw new Error('Invalid launcher profile');
  if (typeof handoff.servedName !== 'string' || !handoff.servedName) throw new Error('Invalid launcher served name');
  if (typeof handoff.modelDir !== 'string' || !handoff.modelDir) throw new Error('Invalid launcher model directory');
  if (typeof handoff.pidFile !== 'string' || !handoff.pidFile) throw new Error('Invalid launcher PID file');
  if (typeof handoff.startedAt !== 'number' || !Number.isFinite(handoff.startedAt) || handoff.startedAt < 0) throw new Error('Invalid launcher start time');
  if (typeof handoff.healthUrl !== 'string' || !handoff.healthUrl) throw new Error('Invalid launcher health URL');
  if (typeof handoff.smokePassed !== 'boolean') throw new Error('Invalid launcher smoke result');
  if (handoff.error !== null && typeof handoff.error !== 'string') throw new Error('Invalid launcher error');
  if (handoff.pid !== null && handoff.pid !== undefined && (!Number.isInteger(handoff.pid) || handoff.pid <= 1)) {
    throw new Error('Invalid launcher PID');
  }
  if (handoff.port === undefined || !Number.isInteger(handoff.port) || handoff.port < 1 || handoff.port > 65535) {
    throw new Error('Invalid launcher port');
  }
  if (typeof handoff.stateFile !== 'string' || !handoff.stateFile) throw new Error('Invalid launcher state file');
  if (handoff.status !== 'stopped' && (handoff.pid === null || handoff.pid === undefined)) throw new Error('Active launcher handoff has no PID');
  if (handoff.generation !== undefined && typeof handoff.generation !== 'string') throw new Error('Invalid launcher generation');
  if (handoff.sequence !== undefined && (!Number.isInteger(handoff.sequence) || handoff.sequence < 0)) throw new Error('Invalid launcher sequence');
  if (handoff.capabilities !== undefined) validateCapabilities(handoff.capabilities);
  if (handoff.backend !== undefined) validateBackendEvidence(handoff.backend);
  if (handoff.runtimeEvidence !== undefined) {
    const evidence = handoff.runtimeEvidence;
    if (!evidence || typeof evidence !== 'object') throw new Error('Invalid launcher runtime evidence');
    if (evidence.state !== 'present' && evidence.state !== 'absent' && evidence.state !== 'indeterminate') throw new Error('Invalid launcher runtime evidence state');
    if (evidence.pid !== null && (!Number.isInteger(evidence.pid) || evidence.pid <= 1)) throw new Error('Invalid launcher runtime evidence PID');
    if (evidence.pgid !== null && (!Number.isInteger(evidence.pgid) || evidence.pgid <= 1)) throw new Error('Invalid launcher runtime evidence PGID');
    if (!Number.isInteger(evidence.port) || evidence.port < 1 || evidence.port > 65535) throw new Error('Invalid launcher runtime evidence port');
    for (const key of ['apiReachable', 'modelMatches', 'processMatches'] as const) {
      if (typeof evidence[key] !== 'boolean') throw new Error(`Invalid launcher runtime evidence ${key}`);
    }
    if (typeof evidence.detail !== 'string') throw new Error('Invalid launcher runtime evidence detail');
  }
  if (handoff.apiAvailable !== undefined && typeof handoff.apiAvailable !== 'boolean') throw new Error('Invalid launcher API availability');
}

export function parseLauncherHandoff(stdout: string): LauncherHandoff {
  const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    try {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== 'object' || (value as { schemaVersion?: unknown }).schemaVersion !== 1) continue;
      validateLauncherHandoff(value);
      return value;
    } catch {
      // Ignore diagnostics and malformed events while looking for the final handoff.
    }
  }
  throw new Error('Launcher returned no valid JSON handoff');
}
