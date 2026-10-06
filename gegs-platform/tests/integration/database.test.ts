import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { listMigrationsOnDisk } from '@/lib/migrations';

/**
 * Integration tests run against a REAL PostgreSQL (Phase 1 §14.1). The point of
 * these tests is behaviour the database owns — extensions, privileges,
 * constraints — and a mocked client cannot exercise any of it.
 *
 * Skipped, loudly, when DATABASE_URL is absent, so a missing database is
 * reported rather than silently passing.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('PostgreSQL baseline', () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: DATABASE_URL! } } });
    await db.$connect();
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it('answers a trivial query', async () => {
    const rows = await db.$queryRaw<Array<{ one: number }>>`SELECT 1::int AS one`;
    expect(rows[0]?.one).toBe(1);
  });

  it('has the citext extension the approved schema depends on', async () => {
    const rows = await db.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'citext'
    `;
    expect(rows).toHaveLength(1);
  });

  it('has the pgcrypto extension', async () => {
    const rows = await db.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'
    `;
    expect(rows).toHaveLength(1);
  });

  it('treats citext comparisons case-insensitively, which is why email uses it', async () => {
    const rows = await db.$queryRaw<Array<{ same: boolean }>>`
      SELECT ('Info@Example.COM'::citext = 'info@example.com'::citext) AS same
    `;
    expect(rows[0]?.same).toBe(true);
  });

  it('records the baseline migration as applied', async () => {
    const onDisk = await listMigrationsOnDisk();
    expect(onDisk).toContain('00000000000000_baseline');

    const rows = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    const applied = rows.map((r) => r.migration_name);
    for (const name of onDisk) expect(applied).toContain(name);
  });
});

describe('migration listing', () => {
  it('reads migration directory names from disk', async () => {
    const names = await listMigrationsOnDisk();
    expect(names).toContain('00000000000000_baseline');
  });

  it('ignores loose files and returns directories only, sorted', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gegs-migrations-'));
    await mkdir(path.join(dir, '20260102000000_second'));
    await mkdir(path.join(dir, '20260101000000_first'));
    await writeFile(path.join(dir, 'migration_lock.toml'), 'provider = "postgresql"\n');

    expect(await listMigrationsOnDisk(dir)).toEqual([
      '20260101000000_first',
      '20260102000000_second',
    ]);
  });

  it('returns an empty list for a directory that does not exist', async () => {
    expect(await listMigrationsOnDisk(path.join(tmpdir(), 'gegs-does-not-exist'))).toEqual([]);
  });
});

describe('environment hygiene', () => {
  it('has no .env committed to git', () => {
    const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n');
    const envFiles = tracked.filter(
      (f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example'),
    );
    expect(envFiles).toEqual([]);
  });
});
