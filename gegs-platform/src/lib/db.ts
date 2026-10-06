import { PrismaClient } from '@prisma/client';
import { getEnv } from '@/env';

/**
 * One Prisma client per process. Next.js hot-reloads modules in development,
 * so without this guard each reload would open a new connection pool and
 * exhaust PostgreSQL's connection limit within a few edits.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getDb(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({
      datasources: { db: { url: getEnv().DATABASE_URL } },
      // Phase 1 §6.2: query text can contain personal data. Only errors and
      // warnings are logged, never query payloads.
      log: ['error', 'warn'],
    });
  }
  return globalForPrisma.prisma;
}

export interface DatabaseHealth {
  reachable: boolean;
  pendingMigrations: number | null;
}

/**
 * Reports whether the database answers, and how many migrations on disk have
 * not been applied.
 *
 * Phase 1 §15.2 requires the health endpoint to check pending migrations: a
 * container that is running but whose schema is behind the code will fail on
 * the first real request, and reporting it healthy would hide that.
 */
export async function checkDatabase(migrationsOnDisk: readonly string[]): Promise<DatabaseHealth> {
  const db = getDb();
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    return { reachable: false, pendingMigrations: null };
  }

  try {
    const rows = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    const applied = new Set(rows.map((r) => r.migration_name));
    const pending = migrationsOnDisk.filter((name) => !applied.has(name));
    return { reachable: true, pendingMigrations: pending.length };
  } catch {
    // The migrations table is absent until the first migration runs. The
    // database is reachable; every migration on disk is outstanding.
    return { reachable: true, pendingMigrations: migrationsOnDisk.length };
  }
}
