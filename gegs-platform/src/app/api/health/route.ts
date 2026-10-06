import { checkDatabase } from '@/lib/db';
import { listMigrationsOnDisk } from '@/lib/migrations';
import { checkStorage } from '@/lib/storage';
import { resolveRequestId } from '@/lib/request-id';
import { ok } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Health endpoint.
 *
 * Phase 1 §15.2: "It does not report 'healthy' merely because the process is
 * running." It probes the database, the object store, and whether this build
 * carries migrations the database has not applied. Any failing check makes the
 * whole response 503, so a load balancer takes the container out of rotation
 * instead of sending it traffic it cannot serve.
 *
 * Unauthenticated by necessity — the load balancer cannot hold a session — so
 * the body is deliberately coarse: booleans and a count, never a driver error,
 * a hostname, or a version string that would help an attacker fingerprint the
 * stack (Phase 1 §6.2).
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers);

  const migrationsOnDisk = await listMigrationsOnDisk();
  const [database, storageReachable] = await Promise.all([
    checkDatabase(migrationsOnDisk).catch(() => ({ reachable: false, pendingMigrations: null })),
    checkStorage().catch(() => false),
  ]);

  const checks = {
    database: database.reachable,
    storage: storageReachable,
    migrations_pending: database.pendingMigrations,
  };

  const healthy = checks.database && checks.storage && checks.migrations_pending === 0;

  return ok({ status: healthy ? 'healthy' : 'unhealthy', checks }, requestId, {
    status: healthy ? 200 : 503,
  });
}
