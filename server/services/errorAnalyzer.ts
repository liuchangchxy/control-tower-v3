import { execSync } from 'node:child_process';
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
    const portMatch = line.match(/(?:port\s+|:)(\d{4,5})\b/i);
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
          const ssOutput = execSync(`ss -tlnp 2>/dev/null | grep ":${port} "`, {
            encoding: 'utf-8',
            timeout: 3000,
          }).trim();
          if (ssOutput) {
            contextLines.push(`[port ${port} listeners] ${ssOutput}`);
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
];

// ── Public API ───────────────────────────────────────────────────────────────

export function analyzeError(logLines: string[]): Diagnosis {
  if (logLines.length === 0) {
    return { errorType: 'unknown', message: 'No log lines provided', repairs: [], context: [] };
  }

  const fullLog = logLines.join('\n');

  // Find the first error line index for context extraction
  let errorLineIdx = 0;
  for (let i = 0; i < logLines.length; i++) {
    if (/error|exception|traceback/i.test(logLines[i])) {
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
