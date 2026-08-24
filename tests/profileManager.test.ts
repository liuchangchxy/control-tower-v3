import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { listProfiles, getProfile, createProfile, cloneProfile, updateProfile, deleteProfile, validateProfile } from '../server/services/profileManager.js';
import { writeEnvFileToDisk } from '../server/utils.js';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-profiles-'));
const profilesDir = path.join(tmpHome, 'profiles');
const userDir = path.join(profilesDir, 'user');
const templatesDir = path.join(profilesDir, 'templates');
const launcherProfilesDir = path.join(profilesDir, 'qwen27b', 'normal', 'int4');

beforeEach(() => {
  // Clean up any leftover symlink from previous runs
  const normalSymlink = path.join(profilesDir, 'qwen27b', 'normal');
  try { fs.unlinkSync(normalSymlink); } catch { /* ignore */ }
  try { fs.rmSync(launcherProfilesDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(templatesDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }

  fs.mkdirSync(userDir, { recursive: true });
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.mkdirSync(launcherProfilesDir, { recursive: true });

  // Symlink: qwen27b/normal -> qwen27b/normal/int4
  try {
    fs.symlinkSync(launcherProfilesDir, normalSymlink, 'dir');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }

  // Create config.json pointing to this tmp profiles dir
  fs.writeFileSync(path.join(tmpHome, 'config.json'), JSON.stringify({
    launcherDir: tmpHome,
  }), 'utf-8');

  // Create a sample profile in launcher dir
  writeEnvFileToDisk(path.join(launcherProfilesDir, 'sample.env'), {
    SERVED_NAME: 'sample-served',
    MODEL_FAMILY: 'qwen',
    PROFILE_GROUP: 'qwen27b-int4',
    MODEL_VARIANT: 'int4',
    GPU_UTIL: 0.88,
    MAX_MODEL_LEN: 256000,
  });

  // Create a template
  writeEnvFileToDisk(path.join(templatesDir, 'base.env'), {
    SERVED_NAME: 'template-base',
    GPU_UTIL: 0.88,
    MAX_MODEL_LEN: 256000,
  });

  // Set CONTROL_TOWER_HOME — read lazily at call time in profileManager
  process.env.CONTROL_TOWER_HOME = tmpHome;
});

afterEach(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('profile manager', () => {
  it('lists profiles from launcher dir', async () => {
    const profiles = await listProfiles();
    const names = profiles.map(p => p.name);
    expect(names).toContain('qwen27b/normal/int4/sample.env');
  });

  it('marks user profiles as writable', async () => {
    await createProfile('user-test', {
      SERVED_NAME: 'user-test-served',
      GPU_UTIL: 0.88,
      MAX_MODEL_LEN: 256000,
    });
    const profiles = await listProfiles();
    const userProfile = profiles.find(p => p.name === 'user/user-test.env');
    expect(userProfile).toBeDefined();
    expect(userProfile!.writable).toBe(true);
  });

  it('marks launcher profiles as read-only', async () => {
    const profiles = await listProfiles();
    const launcherProfile = profiles.find(p => p.name === 'qwen27b/normal/int4/sample.env');
    expect(launcherProfile).toBeDefined();
    expect(launcherProfile!.writable).toBe(false);
  });

  it('gets profile by relative path', async () => {
    const profile = await getProfile('qwen27b/normal/int4/sample.env');
    expect(profile.SERVED_NAME).toBe('sample-served');
    expect(profile.GPU_UTIL).toBe(0.88);
  });

  it('creates new profile in user/ directory', async () => {
    const filePath = await createProfile('new-profile', {
      SERVED_NAME: 'new-served',
      GPU_UTIL: 0.9,
      MAX_MODEL_LEN: 128000,
    });
    expect(filePath.replace(/\\/g, '/')).toContain('user/new-profile.env');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('clones a repository profile into user/ with overrides and preserves the source', async () => {
    const sourceBefore = fs.readFileSync(path.join(launcherProfilesDir, 'sample.env'), 'utf-8');
    const filePath = await cloneProfile('qwen27b/normal/int4/sample.env', 'qwen-tooling', {
      ENABLE_AUTO_TOOL_CHOICE: 1,
      TOOL_CALL_PARSER: 'qwen3_xml',
    });

    expect(filePath.replace(/\\/g, '/')).toContain('user/qwen-tooling.env');
    const cloned = await getProfile('user/qwen-tooling.env');
    expect(cloned.SERVED_NAME).toBe('sample-served');
    expect(cloned.GPU_UTIL).toBe(0.88);
    expect(cloned.MAX_MODEL_LEN).toBe(256000);
    expect(cloned.ENABLE_AUTO_TOOL_CHOICE).toBe(1);
    expect(cloned.TOOL_CALL_PARSER).toBe('qwen3_xml');
    expect(fs.readFileSync(path.join(launcherProfilesDir, 'sample.env'), 'utf-8')).toBe(sourceBefore);
  });

  it('rejects invalid clone sources, overrides, and collisions', async () => {
    await expect(cloneProfile('../outside.env', 'bad-source')).rejects.toThrow();
    await expect(cloneProfile('qwen27b/normal/int4/sample.env', 'bad-override', {
      GPU_UTIL: 0.1,
    })).rejects.toThrow(/Validation failed/);
    await cloneProfile('qwen27b/normal/int4/sample.env', 'collision');
    await expect(cloneProfile('qwen27b/normal/int4/sample.env', 'collision')).rejects.toThrow(/already exists/i);
  });

  it('updates existing user profile', async () => {
    await createProfile('upd', { SERVED_NAME: 'orig', GPU_UTIL: 0.88, MAX_MODEL_LEN: 256000 });
    await updateProfile('user/upd.env', { SERVED_NAME: 'updated', GPU_UTIL: 0.85, MAX_MODEL_LEN: 128000 });
    const updated = await getProfile('user/upd.env');
    expect(updated.SERVED_NAME).toBe('updated');
    expect(updated.GPU_UTIL).toBe(0.85);
  });

  it('refuses to update read-only launcher profile', async () => {
    await expect(updateProfile('qwen27b/normal/int4/sample.env', { SERVED_NAME: 'hacked' }))
      .rejects.toThrow(/read-only/i);
  });

  it('deletes user profile', async () => {
    await createProfile('del', { SERVED_NAME: 'del-served', GPU_UTIL: 0.88, MAX_MODEL_LEN: 256000 });
    await deleteProfile('user/del.env');
    expect(fs.existsSync(path.join(userDir, 'del.env'))).toBe(false);
  });

  it('refuses to delete read-only launcher profile', async () => {
    await expect(deleteProfile('qwen27b/normal/int4/sample.env'))
      .rejects.toThrow(/read-only/i);
  });
});

describe('validateProfile', () => {
  const validConfig = {
    SERVED_NAME: 'my-model',
    MODEL_FAMILY: 'qwen',
    PROFILE_GROUP: 'qwen36-27b-int4',
    MODEL_VARIANT: 'int4',
    GPU_UTIL: 0.88,
    MAX_MODEL_LEN: 256000,
    MAX_BATCHED_TOKENS: 2048,
    MAX_NUM_SEQS: 2,
    MTP_K: 0,
    VLLM_INT8KV_FA_PREFILL: 1,
    VLLM_INT8KV_FA_CONTINUATION_DEQUANT: 1,
    VLLM_INT8KV_FA_CASCADE_DEQUANT: 1,
    ENABLE_AUTO_TOOL_CHOICE: 1,
    LANGUAGE_MODEL_ONLY: 1,
    SKIP_MM_PROFILING: 1,
  };

  it('returns no errors for a valid config', () => {
    expect(validateProfile(validConfig)).toEqual([]);
  });

  it('rejects missing SERVED_NAME', () => {
    const errors = validateProfile({ ...validConfig, SERVED_NAME: '' });
    expect(errors).toContainEqual('SERVED_NAME is required');
  });

  it('rejects missing MODEL_FAMILY', () => {
    const errors = validateProfile({ ...validConfig, MODEL_FAMILY: '' });
    expect(errors).toContainEqual('MODEL_FAMILY is required');
  });

  it('rejects missing PROFILE_GROUP', () => {
    const errors = validateProfile({ ...validConfig, PROFILE_GROUP: '' });
    expect(errors).toContainEqual('PROFILE_GROUP is required');
  });

  it('rejects missing MODEL_VARIANT', () => {
    const errors = validateProfile({ ...validConfig, MODEL_VARIANT: '' });
    expect(errors).toContainEqual('MODEL_VARIANT is required');
  });

  it('rejects invalid MODEL_VARIANT', () => {
    const errors = validateProfile({ ...validConfig, MODEL_VARIANT: 'int16' });
    expect(errors.some(e => e.includes('MODEL_VARIANT'))).toBe(true);
  });

  it('rejects GPU_UTIL below 0.5', () => {
    const errors = validateProfile({ ...validConfig, GPU_UTIL: 0.3 });
    expect(errors).toContainEqual('GPU_UTIL must be between 0.5 and 0.99');
  });

  it('rejects GPU_UTIL above 0.99', () => {
    const errors = validateProfile({ ...validConfig, GPU_UTIL: 1.0 });
    expect(errors).toContainEqual('GPU_UTIL must be between 0.5 and 0.99');
  });

  it('rejects non-integer MAX_MODEL_LEN', () => {
    const errors = validateProfile({ ...validConfig, MAX_MODEL_LEN: 100.5 });
    expect(errors).toContainEqual('MAX_MODEL_LEN must be a positive integer');
  });

  it('rejects zero MAX_NUM_SEQS', () => {
    const errors = validateProfile({ ...validConfig, MAX_NUM_SEQS: 0 });
    expect(errors).toContainEqual('MAX_NUM_SEQS must be a positive integer');
  });

  it('rejects negative MTP_K', () => {
    const errors = validateProfile({ ...validConfig, MTP_K: -1 });
    expect(errors).toContainEqual('MTP_K must be a non-negative integer');
  });

  it('rejects boolean field with value 2', () => {
    const errors = validateProfile({ ...validConfig, VLLM_INT8KV_FA_PREFILL: 2 });
    expect(errors.some(e => e.includes('VLLM_INT8KV_FA_PREFILL'))).toBe(true);
  });

  it('rejects PORT out of range', () => {
    const errors = validateProfile({ ...validConfig, PORT: 70000 });
    expect(errors).toContainEqual('PORT must be an integer between 1 and 65535');
  });

  it('accepts valid PORT', () => {
    expect(validateProfile({ ...validConfig, PORT: 8000 })).toEqual([]);
  });

  it('accepts optional fields as undefined', () => {
    expect(validateProfile({ ...validConfig, TP_SIZE: undefined, PORT: undefined })).toEqual([]);
  });

  it('rejects invalid KV_CACHE_DTYPE', () => {
    const errors = validateProfile({ ...validConfig, KV_CACHE_DTYPE: 'bfloat16' });
    expect(errors.some(e => e.includes('KV_CACHE_DTYPE'))).toBe(true);
  });

  it('rejects invalid COMPATIBLE_MODES', () => {
    const errors = validateProfile({ ...validConfig, COMPATIBLE_MODES: 'production' });
    expect(errors.some(e => e.includes('COMPATIBLE_MODES'))).toBe(true);
  });

  it('rejects multiple errors at once', () => {
    const errors = validateProfile({
      SERVED_NAME: '',
      GPU_UTIL: 0.1,
      MTP_K: -5,
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it('createProfile rejects invalid config', async () => {
    await expect(createProfile('bad', {
      SERVED_NAME: '',
      GPU_UTIL: 0.1,
    })).rejects.toThrow(/Validation failed/);
  });

  it('updateProfile rejects invalid config', async () => {
    await createProfile('upd-val', {
      SERVED_NAME: 'ok',
      GPU_UTIL: 0.88,
      MAX_MODEL_LEN: 256000,
    });
    await expect(updateProfile('user/upd-val.env', {
      GPU_UTIL: 0.01,
    })).rejects.toThrow(/Validation failed/);
  });
});
