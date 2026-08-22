import { execFileSync } from 'node:child_process';
import type { ProfileConfig, Diagnosis } from '../types.js';

// ── Error patterns (ordered by specificity) ──────────────────────────────────

interface ErrorPattern {
  test: (fullLog: string) => boolean;
  diagnose: (fullLog: string, logLines: string[], errorLineIdx: number) => Diagnosis;
}

/**
 * Extract ±25 lines around the error line for context.
 */
function extractContext(logLines: string[], errorLineIdx: number): string[] {
  const start = Math.max(0, errorLineIdx - 25);
  const end = Math.min(logLines.length - 1, errorLineIdx + 25);
  return logLines.slice(start, end + 1);
}

/**
 * Try to extract port number from log lines around the error.
 */
function extractPort(logLines: string[], errorLineIdx: number): number | null {
  const searchRange = logLines.slice(
    Math.max(0, errorLineIdx - 5),
    Math.min(logLines.length, errorLineIdx + 5),
  );
  for (const line of searchRange) {
    // Match patterns like "port 8000", "PORT=8000", ":8000"
    const portMatch = line.match(/(?:port\s*[=:]\s*|:)(\d{4,5})\b/i);
    if (portMatch) {
      const port = parseInt(portMatch[1], 10);
      if (port >= 1024 && port <= 65535) return port;
    }
  }
  return null;
}

const PATTERNS: ErrorPattern[] = [
  {
    // GPU OOM — most common startup failure
    test: (log) => /OutOfMemoryError/i.test(log),
    diagnose: (_fullLog, logLines, errorLineIdx) => ({
      errorType: 'oom_startup',
      message: 'GPU out of memory during startup',
      repairs: [
        { description: 'Reduce GPU_UTIL by 0.05', profilePatch: { GPU_UTIL: 0.83 } },
        { description: 'Reduce MAX_MODEL_LEN to 128K', profilePatch: { MAX_MODEL_LEN: 131072 } },
      ],
      context: extractContext(logLines, errorLineIdx),
    }),
  },
  {
    // KV-cache workspace allocation failure — secondary memory error
    test: (log) => /Workspace allocation failed/i.test(log),
    diagnose: (_fullLog, logLines, errorLineIdx) => ({
      errorType: 'workspace_alloc_failed',
      message: 'CUDA workspace allocation failed',
      repairs: [
        { description: 'Reduce GPU_UTIL by 0.05', profilePatch: { GPU_UTIL: 0.83 } },
        { description: 'Disable int8 KV cache', profilePatch: { KV_CACHE_DTYPE: 'auto' } },
      ],
      context: extractContext(logLines, errorLineIdx),
    }),
  },
  {
    // CUDA error (driver, kernel, etc.)
    test: (log) => /CUDA error/i.test(log),
    diagnose: (_fullLog, logLines, errorLineIdx) => ({
      errorType: 'cuda_error',
      message: 'CUDA error detected',
      repairs: [
        { description: 'Check GPU temperature and throttling', profilePatch: {} },
        { description: 'Reduce GPU_UTIL by 0.05', profilePatch: { GPU_UTIL: 0.83 } },
      ],
      context: extractContext(logLines, errorLineIdx),
    }),
  },
  {
    // Port conflict
    test: (log) => /Address already in use/i.test(log),
    diagnose: (_fullLog, logLines, errorLineIdx) => {
      const contextLines = extractContext(logLines, errorLineIdx);

      // Try to find which process is using the port
      const port = extractPort(logLines, errorLineIdx);
      if (port) {
        try {
          // Use execFileSync to avoid shell injection (H12)
          const ssOutput = execFileSync('ss', ['-tlnp'], {
            encoding: 'utf-8',
            timeout: 3000,
          });
          const matching = ssOutput.split('\n').filter(l => l.includes(`:${port} `));
          if (matching.length) {
            contextLines.push(`[port ${port} listeners] ${matching.join('\n')}`);
          }
        } catch {
          // ss not available or no match — skip
        }
      }

      return {
        errorType: 'port_in_use',
        message: 'Port conflict detected',
        repairs: [
          { description: 'Change PORT to 8001', profilePatch: { PORT: 8001 } as Partial<ProfileConfig> },
        ],
        context: contextLines,
      };
    },
  },
  {
    // Pydantic validation error (config mismatch, bad args)
    test: (log) => /ValidationError.*(?:SpeculativeConfig|ModelConfig|EngineConfig)/i.test(log) || /Value error.*(?:speculative|quantiz|model config)/i.test(log),
    diagnose: (_fullLog, logLines, errorLineIdx) => {
      // Extract the specific value error message
      const contextLines = extractContext(logLines, errorLineIdx);
      let valueError = '';
      for (const line of logLines) {
        const m = line.match(/Value error,\s*(.+?)(?:\s*\[type=|$)/i);
        if (m) { valueError = m[1]; break; }
      }
      return {
        errorType: 'config_validation',
        message: valueError || 'vLLM configuration validation failed',
        repairs: [
          { description: 'Check profile settings match model requirements', profilePatch: {} },
          { description: 'Remove MTP_K if speculative model is not available', profilePatch: { MTP_K: 0 } },
        ],
        context: contextLines,
      };
    },
  },
  {
    // Engine dead / EngineCore failed (M5)
    test: (log) => /EngineDeadError|EngineCore failed/i.test(log),
    diagnose: (_fullLog, logLines, errorLineIdx) => ({
      errorType: 'engine_dead',
      message: 'vLLM engine process crashed',
      repairs: [
        { description: 'Check GPU health and restart', profilePatch: {} },
        { description: 'Reduce GPU_UTIL by 0.05', profilePatch: { GPU_UTIL: 0.83 } },
      ],
      context: extractContext(logLines, errorLineIdx),
    }),
  },
];

// ── Public API ───────────────────────────────────────────────────────────────

export function analyzeError(logLines: string[]): Diagnosis {
  if (logLines.length === 0) {
    return { errorType: 'unknown', message: 'No log lines provided', repairs: [], context: [] };
  }

  const fullLog = logLines.join('\n');

  // Find the first error line index for context extraction (M8)
  // Match both generic error keywords AND pattern-specific keywords
  let errorLineIdx = 0;
  const errorKeywords = /error|exception|traceback|failed|already in use|denied/i;
  for (let i = 0; i < logLines.length; i++) {
    if (errorKeywords.test(logLines[i])) {
      errorLineIdx = i;
      break;
    }
  }

  for (const pattern of PATTERNS) {
    if (pattern.test(fullLog)) {
      return pattern.diagnose(fullLog, logLines, errorLineIdx);
    }
  }

  return {
    errorType: 'unknown',
    message: 'Unknown error',
    repairs: [],
    context: extractContext(logLines, errorLineIdx),
  };
}
