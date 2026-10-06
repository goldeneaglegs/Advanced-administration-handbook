import { readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Migration directory names, as Prisma records them in `_prisma_migrations`.
 * Read from disk so the health endpoint compares what this build carries
 * against what the database has applied.
 */
export async function listMigrationsOnDisk(
  dir = path.join(process.cwd(), 'prisma', 'migrations'),
): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}
