import { describe, it, expect } from 'vitest';
import { parseEnvFile, writeEnvFile, formatStringValue } from '../server/utils.js';

describe('env file parser', () => {
  it('parses simple KEY=value pairs', () => {
    const content = `SERVED_NAME=test
GPU_UTIL=0.88
MAX_MODEL_LEN=256000
`;
    const result = parseEnvFile(content);
    expect(result.SERVED_NAME).toBe('test');
    expect(result.GPU_UTIL).toBe(0.88);
    expect(result.MAX_MODEL_LEN).toBe(256000);
  });

  it('parses single-quoted JSON values', () => {
    const content = `COMPILATION_CONFIG_JSON='{"cudagraph_mode":"PIECEWISE"}'
`;
    const result = parseEnvFile(content);
    expect(result.COMPILATION_CONFIG_JSON).toBe('{"cudagraph_mode":"PIECEWISE"}');
  });

  it('skips comment lines and blank lines', () => {
    const content = `# This is a comment
SERVED_NAME=test

# Another comment
GPU_UTIL=0.88
`;
    const result = parseEnvFile(content);
    expect(Object.keys(result)).toEqual(['SERVED_NAME', 'GPU_UTIL']);
  });

  it('writes env file with single-quoted JSON', () => {
    const obj = {
      SERVED_NAME: 'test',
      GPU_UTIL: 0.88,
      COMPILATION_CONFIG_JSON: '{"cudagraph_mode":"PIECEWISE"}',
    };
    const output = writeEnvFile(obj);
    expect(output).toContain('SERVED_NAME=test');
    expect(output).toContain('GPU_UTIL=0.88');
    expect(output).toContain(`COMPILATION_CONFIG_JSON='${obj.COMPILATION_CONFIG_JSON}'`);
  });

  it('formats string values without quotes for plain strings', () => {
    expect(formatStringValue('hello')).toBe('hello');
    expect(formatStringValue('hello world')).toBe('hello world');
  });

  it('quotes JSON-like values', () => {
    expect(formatStringValue('{"foo":1}')).toBe('\'{"foo":1}\'');
  });
});
