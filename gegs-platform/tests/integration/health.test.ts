import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { checkDatabase } from '@/lib/db';
import { checkStorage } from '@/lib/storage';
import { listMigrationsOnDisk } from '@/lib/migrations';
import { resetEnvCache } from '@/env';

/**
 * The health endpoint's own contract (Phase 1 §15.2): it must not report
 * healthy merely because the process is running. These tests drive the real
 * probes, including their failure paths, because a health check that cannot
 * fail is worse than none.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe('database probe', () => {
  it.runIf(hasDb)('reports reachable with no pending migrations once migrated', async () => {
    const onDisk = await listMigrationsOnDisk();
    const result = await checkDatabase(onDisk);
    expect(result.reachable).toBe(true);
    expect(result.pendingMigrations).toBe(0);
  });

  it.runIf(hasDb)('counts a migration present on disk but absent from the database', async () => {
    const onDisk = await listMigrationsOnDisk();
    const result = await checkDatabase([...onDisk, '29991231235959_not_applied']);
    expect(result.reachable).toBe(true);
    expect(result.pendingMigrations).toBe(1);
  });
});

/**
 * Stands up a real HTTP server that answers like an S3-compatible endpoint.
 *
 * This is a boundary double, not a mock of our own code: the S3 client really
 * signs the request, really sends it, and really interprets the response, so
 * the probe's wiring (endpoint construction, path-style addressing, status
 * handling) is genuinely exercised. MinIO itself needs a container runtime,
 * which is unavailable here.
 */
async function withS3Stub(
  status: number,
  run: (endpoint: string) => Promise<void>,
): Promise<string[]> {
  const seen: string[] = [];
  const server: Server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.writeHead(status).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return seen;
}

describe('storage probe', () => {
  const savedEndpoint = process.env.STORAGE_ENDPOINT;

  afterEach(() => {
    if (savedEndpoint !== undefined) process.env.STORAGE_ENDPOINT = savedEndpoint;
    resetEnvCache();
  });

  it('reports reachable when the bucket responds, using path-style addressing', async () => {
    const requests = await withS3Stub(200, async (endpoint) => {
      process.env.STORAGE_ENDPOINT = endpoint;
      process.env.STORAGE_FORCE_PATH_STYLE = 'true';
      resetEnvCache();
      await expect(checkStorage()).resolves.toBe(true);
    });
    // Path-style puts the bucket in the URL path, which is what MinIO requires.
    expect(requests.some((r) => r.startsWith('HEAD /') && r.includes('gegs-documents'))).toBe(true);
  });

  it('reports unreachable when the bucket is absent or credentials are refused', async () => {
    await withS3Stub(403, async (endpoint) => {
      process.env.STORAGE_ENDPOINT = endpoint;
      resetEnvCache();
      await expect(checkStorage()).resolves.toBe(false);
    });
  });

  it('reports unreachable for a dead endpoint instead of throwing', async () => {
    const saved = process.env.STORAGE_ENDPOINT;
    // Port 1 is reserved and nothing listens on it.
    process.env.STORAGE_ENDPOINT = 'http://127.0.0.1:1';
    resetEnvCache();
    try {
      await expect(checkStorage()).resolves.toBe(false);
    } finally {
      if (saved !== undefined) process.env.STORAGE_ENDPOINT = saved;
      resetEnvCache();
    }
  }, 30_000);
});
