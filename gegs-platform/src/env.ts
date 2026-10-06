import { z } from 'zod';

/**
 * Environment contract. Validated once, at boot, so a missing or malformed
 * secret fails immediately and loudly instead of surfacing as a confusing
 * runtime error on a user's first request.
 *
 * Phase 2 implementation rule 4/5: every secret arrives through the
 * environment. Nothing in this file carries a default that could stand in for
 * a credential — a missing secret is an error, never a fallback.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // PostgreSQL. No default: an app that silently connects to the wrong
  // database is worse than one that refuses to start.
  DATABASE_URL: z.string().url(),

  // S3-compatible private object storage (Phase 1 §5).
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_REGION: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  // MinIO in local development needs path-style addressing; AWS S3 does not.
  STORAGE_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Phase 1 §1.2 rule 1: the application serves no public, indexed URL.
  APP_ORIGIN: z.string().url(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/**
 * Parses and caches the environment.
 *
 * On failure the thrown message names only the offending variable names, never
 * their values, so a boot failure cannot print a secret into a log or a
 * container event (Phase 1 §6.2).
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const names = Object.keys(parsed.error.flatten().fieldErrors).sort().join(', ');
    throw new Error(`Invalid environment configuration. Check these variables: ${names}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test seam: lets a test re-parse after mutating process.env. */
export function resetEnvCache(): void {
  cached = null;
}

export { schema as envSchema };
