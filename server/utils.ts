import fs from 'node:fs';

// ── Env file parser ─────────────────────────────────────────────────────────

/**
 * Parse a .env file into a key-value object.
 * Handles:
 *   - KEY=value
 *   - KEY='json-like value with spaces'
 *   - KEY="double quoted"
 *   - # comments and blank lines
 *   - Numeric values parsed to numbers when possible
 */
export function parseEnvFile(content: string): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  const lines = content.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();

    // Strip surrounding quotes (single or double)
    if ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }

    // Try to parse as number
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      result[key] = parseFloat(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Format a value for writing to .env file.
 * Wraps JSON-like values in single quotes.
 */
export function formatStringValue(value: string): string {
  if (/^[{\[]/.test(value.trim()) && /[}\]]$/.test(value.trim())) {
    return `'${value}'`;
  }
  return value;
}

/**
 * Serialize an object back to .env file format.
 * Keys are sorted alphabetically.
 */
export function writeEnvFile(obj: Record<string, string | number | undefined>): string {
  const lines: string[] = [];
  const keys = Object.keys(obj).sort();

  for (const key of keys) {
    const value = obj[key];
    // undefined = keep existing (skip field so disk value is preserved)
    // null     = same as undefined (explicit clear, also skipped)
    // empty string '' = write empty string (explicit intent to clear)
    if (value === undefined) continue;
    if (value === null) continue;
    const stringValue = String(value);
    lines.push(`${key}=${formatStringValue(stringValue)}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Read and parse a .env file from disk.
 */
export function readEnvFile(path: string): Record<string, string | number> {
  const content = fs.readFileSync(path, 'utf-8');
  return parseEnvFile(content);
}

/**
 * Write a .env file to disk.
 */
export function writeEnvFileToDisk(path: string, obj: Record<string, string | number | undefined>): void {
  const content = writeEnvFile(obj);
  fs.writeFileSync(path, content, 'utf-8');
}
