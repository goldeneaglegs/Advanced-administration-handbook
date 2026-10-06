import { afterEach, describe, expect, it } from 'vitest';
import { envSchema, getEnv, resetEnvCache } from '@/env';

const valid = {
  NODE_ENV: 'test',
  // A deliberately fake connection string: the parser must be tested against a
  // realistic URL shape, password component included.
  // secret-scan-allow
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db?schema=public',
  STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
  STORAGE_REGION: 'me-central-1',
  STORAGE_BUCKET: 'bucket',
  STORAGE_ACCESS_KEY_ID: 'id',
  STORAGE_SECRET_ACCESS_KEY: 'secret',
  STORAGE_FORCE_PATH_STYLE: 'true',
  APP_ORIGIN: 'http://127.0.0.1:3000',
};

describe('environment contract', () => {
  afterEach(resetEnvCache);

  it('accepts a complete configuration', () => {
    const parsed = envSchema.parse(valid);
    expect(parsed.STORAGE_FORCE_PATH_STYLE).toBe(true);
    expect(parsed.DATABASE_URL).toBe(valid.DATABASE_URL);
  });

  it('rejects a missing DATABASE_URL rather than defaulting to one', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = valid;
    expect(envSchema.safeParse(withoutDb).success).toBe(false);
  });

  it.each([
    'DATABASE_URL',
    'STORAGE_ENDPOINT',
    'STORAGE_BUCKET',
    'STORAGE_ACCESS_KEY_ID',
    'STORAGE_SECRET_ACCESS_KEY',
    'APP_ORIGIN',
  ])('has no default for %s, so a missing secret is an error', (key) => {
    const copy: Record<string, string> = { ...valid };
    delete copy[key];
    expect(envSchema.safeParse(copy).success).toBe(false);
  });

  it('rejects a malformed DATABASE_URL', () => {
    expect(envSchema.safeParse({ ...valid, DATABASE_URL: 'not-a-url' }).success).toBe(false);
  });

  it('defaults path-style addressing to false for real S3', () => {
    const { STORAGE_FORCE_PATH_STYLE: _omitted, ...rest } = valid;
    expect(envSchema.parse(rest).STORAGE_FORCE_PATH_STYLE).toBe(false);
  });

  it('names the offending variables without printing their values', () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    process.env.STORAGE_SECRET_ACCESS_KEY = 'super-secret-value';
    resetEnvCache();
    try {
      getEnv();
      expect.unreachable('getEnv should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).not.toContain('super-secret-value');
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });
});
