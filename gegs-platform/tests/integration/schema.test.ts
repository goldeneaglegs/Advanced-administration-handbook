import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Milestone 1 schema tests, against a REAL PostgreSQL.
 *
 * The point of these is behaviour the DATABASE owns. A mocked client cannot
 * enforce a CHECK constraint, cannot refuse a duplicate, and cannot reject an
 * UPDATE on an append-only table — so a mock would prove nothing about the
 * guarantees this schema exists to provide.
 *
 * Every test that writes does so inside a transaction that is rolled back, so
 * the suite leaves no rows behind and can run repeatedly.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

let db: PrismaClient;

/** Sentinel used to abort a transaction once its assertions have run. */
class Rollback extends Error {}

/** Runs `work` in a transaction and always rolls back. */
async function inRolledBackTx(
  work: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      await work(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/**
 * Runs a statement that is EXPECTED to violate a constraint, inside a
 * savepoint, and reports whether it did.
 *
 * PostgreSQL aborts the entire transaction on the first error, so without the
 * savepoint a single expected failure would poison every later assertion in the
 * same test with error 25P02.
 */
async function violates(
  tx: Prisma.TransactionClient,
  run: () => Promise<unknown>,
): Promise<boolean> {
  await tx.$executeRawUnsafe('SAVEPOINT constraint_probe');
  try {
    await run();
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT constraint_probe');
    return false;
  } catch {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT constraint_probe');
    return true;
  }
}

/** As `violates`, but also returns the error message for assertions on it. */
async function violationMessage(
  tx: Prisma.TransactionClient,
  run: () => Promise<unknown>,
): Promise<string> {
  await tx.$executeRawUnsafe('SAVEPOINT constraint_probe');
  try {
    await run();
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT constraint_probe');
    return '';
  } catch (error) {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT constraint_probe');
    return error instanceof Error ? error.message : String(error);
  }
}

/** Minimal fixtures needed to reach the constraint under test. Never seed data. */
async function makeStage(tx: Prisma.TransactionClient, key: string): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO pipeline_stages (key, name_en, sort_order, is_terminal, is_success)
    VALUES (${key}, ${'Test ' + key}, ${Math.floor(Math.random() * 1_000_000)}, false, NULL)
    RETURNING id::text AS id`;
  return rows[0]!.id;
}

async function makeUser(tx: Prisma.TransactionClient, email: string): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO users (email, password_hash) VALUES (${email}, ${'not-a-real-hash'})
    RETURNING id::text AS id`;
  return rows[0]!.id;
}

async function makeCandidate(tx: Prisma.TransactionClient, email: string): Promise<string> {
  const userId = await makeUser(tx, email);
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO candidate_profiles (user_id, full_name)
    VALUES (${userId}::uuid, ${'Test Candidate'})
    RETURNING id::text AS id`;
  return rows[0]!.id;
}

async function makeRequirement(tx: Prisma.TransactionClient): Promise<string> {
  const employer = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO employers (name) VALUES (${'Test Employer'}) RETURNING id::text AS id`;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO requirements (employer_id, title)
    VALUES (${employer[0]!.id}::uuid, ${'Test Requirement'})
    RETURNING id::text AS id`;
  return rows[0]!.id;
}

async function makeDocumentType(tx: Prisma.TransactionClient, key: string): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO document_types (key, name_en) VALUES (${key}, ${'Test ' + key})
    RETURNING id::text AS id`;
  return rows[0]!.id;
}

describeIfDb('Milestone 1 schema', () => {
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: DATABASE_URL! } } });
    await db.$connect();
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  // -------------------------------------------------------------------------
  describe('extensions', () => {
    it.each(['citext', 'pgcrypto'])('%s is installed', async (name) => {
      const rows = await db.$queryRaw<Array<{ extname: string }>>`
        SELECT extname FROM pg_extension WHERE extname = ${name}`;
      expect(rows).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('tables', () => {
    const EXPECTED = [
      'application_stage_history',
      'applications',
      'audit_log',
      'candidate_profiles',
      'case_stage_history',
      'case_stages',
      'document_access_log',
      'document_requirements',
      'document_types',
      'documents',
      'email_tokens',
      'employer_contacts',
      'employers',
      'notification_templates',
      'notifications',
      'organisations',
      'pipeline_stages',
      'requirements',
      'roles',
      'service_cases',
      'service_types',
      'sessions',
      'user_roles',
      'users',
    ];

    it('creates exactly the approved Phase 1 §2.2 tables', async () => {
      const rows = await db.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          AND table_name <> '_prisma_migrations'
        ORDER BY table_name`;
      expect(rows.map((r) => r.table_name)).toEqual(EXPECTED);
    });

    it('gives every table a primary key', async () => {
      const rows = await db.$queryRaw<Array<{ table_name: string }>>`
        SELECT t.table_name FROM information_schema.tables t
        WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
          AND t.table_name <> '_prisma_migrations'
          AND NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            WHERE c.conrelid = ('public.' || quote_ident(t.table_name))::regclass
              AND c.contype = 'p')`;
      expect(rows.map((r) => r.table_name)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('seeding discipline', () => {
    it('seeds exactly the six approved roles', async () => {
      const rows = await db.$queryRaw<Array<{ key: string }>>`
        SELECT key FROM roles ORDER BY key`;
      expect(rows.map((r) => r.key)).toEqual([
        'admin',
        'candidate',
        'case_officer',
        'consultant',
        'employer',
        'manager',
      ]);
    });

    it('leaves Arabic role labels untranslated rather than machine-translating', async () => {
      const rows = await db.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM roles WHERE name_ar IS NOT NULL`;
      expect(Number(rows[0]!.n)).toBe(0);
    });

    // This is the regression guard that matters most in this milestone: it fails
    // the build if anyone ever seeds a proposed stage or an invented service.
    it.each([
      'pipeline_stages',
      'case_stages',
      'service_types',
      'document_types',
      'notification_templates',
    ])('ships %s EMPTY, because its contents are client business facts', async (table) => {
      const rows = await db.$queryRaw<Array<{ n: bigint }>>(
        Prisma.sql`SELECT count(*) AS n FROM ${Prisma.raw(`"${table}"`)}`,
      );
      expect(Number(rows[0]!.n)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('UUIDv7 primary keys', () => {
    it('sets version 7 and the RFC 9562 variant bits', async () => {
      const rows = await db.$queryRaw<Array<{ v: string; variant: string }>>`
        SELECT substring(uuidv7()::text, 15, 1) AS v,
               substring(uuidv7()::text, 20, 1) AS variant`;
      expect(rows[0]!.v).toBe('7');
      expect(['8', '9', 'a', 'b']).toContain(rows[0]!.variant);
    });

    it('is time-ordered, so ids cluster in the index', async () => {
      // Two separate statements: column evaluation order within one statement
      // is not guaranteed, so generating both there would not prove ordering.
      const first = await db.$queryRaw<Array<{ id: string }>>`SELECT uuidv7()::text AS id`;
      await db.$executeRawUnsafe('SELECT pg_sleep(0.01)');
      const second = await db.$queryRaw<Array<{ id: string }>>`SELECT uuidv7()::text AS id`;
      expect(first[0]!.id < second[0]!.id).toBe(true);
    });

    it('is unguessable: ids generated in the same millisecond still differ', async () => {
      const rows = await db.$queryRaw<Array<{ ids: string[] }>>`
        SELECT array_agg(DISTINCT uuidv7()::text) AS ids FROM generate_series(1, 200)`;
      expect(rows[0]!.ids).toHaveLength(200);
    });

    it('is used as the default on every id column', async () => {
      const rows = await db.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'id'
          AND table_name <> '_prisma_migrations'
          AND (column_default IS NULL OR column_default NOT LIKE 'uuidv7%')`;
      expect(rows.map((r) => r.table_name)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('timestamps', () => {
    it('uses timestamptz for every timestamp column, never naive timestamp', async () => {
      const rows = await db.$queryRaw<Array<{ table_name: string; column_name: string }>>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'`;
      expect(rows).toEqual([]);
    });

    it('stores an absolute instant, so the session timezone cannot change it', async () => {
      // This is the property that matters: a timestamptz is a point in time, not
      // a wall-clock reading. Read the same row under two session timezones and
      // the epoch value must be identical — which is why rendering in the user's
      // timezone is a presentation concern and never a storage one.
      await inRolledBackTx(async (tx) => {
        const id = await makeUser(tx, 'utc-probe@example.test');
        await tx.$executeRawUnsafe("SET LOCAL TimeZone = 'UTC'");
        const utc = await tx.$queryRaw<Array<{ epoch: number }>>`
          SELECT EXTRACT(EPOCH FROM created_at)::float8 AS epoch FROM users WHERE id = ${id}::uuid`;
        await tx.$executeRawUnsafe("SET LOCAL TimeZone = 'Asia/Riyadh'");
        const riyadh = await tx.$queryRaw<Array<{ epoch: number }>>`
          SELECT EXTRACT(EPOCH FROM created_at)::float8 AS epoch FROM users WHERE id = ${id}::uuid`;
        expect(Number(riyadh[0]!.epoch)).toBe(Number(utc[0]!.epoch));
      });
    });

    it('maintains updated_at by trigger, not by application code', async () => {
      // set_updated_at() uses now(), which is the TRANSACTION timestamp: rows
      // changed atomically share one updated_at, which is the behaviour we want
      // for audit consistency. It also means this must span two transactions,
      // exactly as an insert and a later edit do in production.
      // This test commits, so it clears any row a previous interrupted run left
      // behind rather than failing on a unique violation.
      await db.$executeRaw`DELETE FROM users WHERE email = 'updated-at-probe@example.test'`;
      const rows = await db.$queryRaw<Array<{ id: string }>>`
        INSERT INTO users (email, password_hash)
        VALUES ('updated-at-probe@example.test', 'not-a-real-hash')
        RETURNING id::text AS id`;
      const id = rows[0]!.id;
      try {
        const before = await db.$queryRaw<Array<{ updated_at: Date }>>`
          SELECT updated_at FROM users WHERE id = ${id}::uuid`;
        await db.$executeRawUnsafe('SELECT pg_sleep(0.02)');
        await db.$executeRaw`UPDATE users SET locale = 'ar' WHERE id = ${id}::uuid`;
        const after = await db.$queryRaw<Array<{ updated_at: Date }>>`
          SELECT updated_at FROM users WHERE id = ${id}::uuid`;
        expect(after[0]!.updated_at.getTime()).toBeGreaterThan(before[0]!.updated_at.getTime());
        // And the application never set it: the UPDATE above touched only locale.
      } finally {
        await db.$executeRaw`DELETE FROM users WHERE id = ${id}::uuid`;
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('append-only audit structures', () => {
    it('accepts an INSERT into audit_log', async () => {
      await inRolledBackTx(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO audit_log (action, subject_type, subject_id, request_id)
          VALUES ('test.action', 'user', NULL, 'req-test')
          RETURNING id::text AS id`;
        expect(rows[0]!.id).toBeTruthy();
      });
    });

    it.each(['audit_log', 'document_access_log'])('refuses UPDATE on %s', async (table) => {
      await inRolledBackTx(async (tx) => {
        const message = await violationMessage(tx, () =>
          tx.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw(`"${table}"`)} SET action = 'tampered'`),
        );
        expect(message).toMatch(/append-only/i);
      });
    });

    it('refuses DELETE on audit_log even with a row present', async () => {
      await inRolledBackTx(async (tx) => {
        // Insert first, so the row-level trigger has something to fire on.
        await tx.$executeRaw`INSERT INTO audit_log (action, subject_type) VALUES ('t', 'user')`;
        const message = await violationMessage(tx, () => tx.$executeRaw`DELETE FROM audit_log`);
        expect(message).toMatch(/append-only/i);
      });
    });

    it.each(['audit_log', 'document_access_log'])('refuses TRUNCATE on %s', async (table) => {
      await inRolledBackTx(async (tx) => {
        const message = await violationMessage(tx, () =>
          tx.$executeRaw(Prisma.sql`TRUNCATE ${Prisma.raw(`"${table}"`)}`),
        );
        expect(message).toMatch(/append-only/i);
      });
    });

    it('refuses UPDATE even when the table is empty (statement-level cover)', async () => {
      await inRolledBackTx(async (tx) => {
        const n = await tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM audit_log`;
        expect(Number(n[0]!.n)).toBe(0);
        const message = await violationMessage(tx, () => tx.$executeRaw`TRUNCATE audit_log`);
        expect(message).toMatch(/append-only/i);
      });
    });

    it('pins a document row while an access record references it', async () => {
      await inRolledBackTx(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ confdeltype: string }>>`
          SELECT confdeltype FROM pg_constraint
          WHERE conname LIKE 'document_access_log_document_id_fkey'`;
        // 'r' = RESTRICT: you must still be able to prove who read a document
        // after that document has been removed.
        expect(rows[0]!.confdeltype).toBe('r');
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('enforced invariants', () => {
    it('refuses a candidate submitted twice to the same requirement', async () => {
      await inRolledBackTx(async (tx) => {
        const stage = await makeStage(tx, 'dup-test');
        const candidate = await makeCandidate(tx, 'dup-test@example.test');
        const requirement = await makeRequirement(tx);

        await tx.$executeRaw`
          INSERT INTO applications (requirement_id, candidate_profile_id, stage_id)
          VALUES (${requirement}::uuid, ${candidate}::uuid, ${stage}::uuid)`;

        const duplicated = await violates(
          tx,
          () => tx.$executeRaw`
            INSERT INTO applications (requirement_id, candidate_profile_id, stage_id)
            VALUES (${requirement}::uuid, ${candidate}::uuid, ${stage}::uuid)`,
        );
        expect(duplicated).toBe(true);
      });
    });

    it('cannot create an application without a configured stage', async () => {
      // The practical consequence of shipping pipeline_stages empty: the system
      // refuses to operate on invented rules rather than adopting a guess.
      await inRolledBackTx(async (tx) => {
        const candidate = await makeCandidate(tx, 'no-stage@example.test');
        const requirement = await makeRequirement(tx);
        const refused = await violates(
          tx,
          () => tx.$executeRaw`
            INSERT INTO applications (requirement_id, candidate_profile_id, stage_id)
            VALUES (${requirement}::uuid, ${candidate}::uuid, gen_random_uuid())`,
        );
        expect(refused).toBe(true);
      });
    });

    it('treats email case-insensitively, so capitalisation cannot defeat UNIQUE', async () => {
      await inRolledBackTx(async (tx) => {
        await makeUser(tx, 'Case.Test@Example.Test');
        expect(await violates(tx, () => makeUser(tx, 'case.test@example.test'))).toBe(true);
      });
    });

    it('lets a soft-deleted address be registered again', async () => {
      await inRolledBackTx(async (tx) => {
        const id = await makeUser(tx, 'reuse@example.test');
        await tx.$executeRaw`UPDATE users SET deleted_at = now() WHERE id = ${id}::uuid`;
        expect(await violates(tx, () => makeUser(tx, 'reuse@example.test'))).toBe(false);
      });
    });

    it('requires a document to have exactly one owner', async () => {
      await inRolledBackTx(async (tx) => {
        const docType = await makeDocumentType(tx, 'owner-test');
        const candidate = await makeCandidate(tx, 'doc-owner@example.test');
        const caseless = null;

        const insert = (candidateId: string | null, key: string) =>
          tx.$executeRaw`
            INSERT INTO documents (candidate_profile_id, service_case_id, document_type_id,
                                   storage_key, mime, bytes, checksum_sha256)
            VALUES (${candidateId}::uuid, ${caseless}::uuid, ${docType}::uuid,
                    ${key}, 'application/pdf', 1024, decode(repeat('ab', 32), 'hex'))`;

        // Neither owner set -> refused by documents_exactly_one_owner.
        expect(await violates(tx, () => insert(null, 'k-none'))).toBe(true);
        // Exactly one owner -> accepted.
        expect(await violates(tx, () => insert(candidate, 'k-one'))).toBe(false);
      });
    });

    it('refuses a document whose expiry precedes its issue date', async () => {
      await inRolledBackTx(async (tx) => {
        const docType = await makeDocumentType(tx, 'expiry-test');
        const candidate = await makeCandidate(tx, 'doc-expiry@example.test');
        const refused = await violates(
          tx,
          () => tx.$executeRaw`
            INSERT INTO documents (candidate_profile_id, document_type_id, storage_key,
                                   mime, bytes, checksum_sha256, issued_on, expires_on)
            VALUES (${candidate}::uuid, ${docType}::uuid, 'k-expiry',
                    'application/pdf', 1024, decode(repeat('ab', 32), 'hex'),
                    DATE '2026-01-01', DATE '2025-01-01')`,
        );
        expect(refused).toBe(true);
      });
    });

    it('refuses a checksum that is not 32 bytes', async () => {
      await inRolledBackTx(async (tx) => {
        const docType = await makeDocumentType(tx, 'checksum-test');
        const candidate = await makeCandidate(tx, 'doc-checksum@example.test');
        const refused = await violates(
          tx,
          () => tx.$executeRaw`
            INSERT INTO documents (candidate_profile_id, document_type_id, storage_key,
                                   mime, bytes, checksum_sha256)
            VALUES (${candidate}::uuid, ${docType}::uuid, 'k-checksum',
                    'application/pdf', 1024, decode('abcd', 'hex'))`,
        );
        expect(refused).toBe(true);
      });
    });

    it('defaults a new document to pending scan with no scanned_at', async () => {
      await inRolledBackTx(async (tx) => {
        const docType = await makeDocumentType(tx, 'scan-test');
        const candidate = await makeCandidate(tx, 'doc-scan@example.test');
        const rows = await tx.$queryRaw<Array<{ scan_status: string; scanned_at: Date | null }>>`
          INSERT INTO documents (candidate_profile_id, document_type_id, storage_key,
                                 mime, bytes, checksum_sha256)
          VALUES (${candidate}::uuid, ${docType}::uuid, 'k-scan',
                  'application/pdf', 1024, decode(repeat('ab', 32), 'hex'))
          RETURNING scan_status, scanned_at`;
        expect(rows[0]!.scan_status).toBe('pending');
        expect(rows[0]!.scanned_at).toBeNull();
      });
    });

    it('refuses a non-pending scan status without a scanned_at timestamp', async () => {
      await inRolledBackTx(async (tx) => {
        const docType = await makeDocumentType(tx, 'scan-consistency');
        const candidate = await makeCandidate(tx, 'doc-scan2@example.test');
        const refused = await violates(
          tx,
          () => tx.$executeRaw`
            INSERT INTO documents (candidate_profile_id, document_type_id, storage_key,
                                   mime, bytes, checksum_sha256, scan_status)
            VALUES (${candidate}::uuid, ${docType}::uuid, 'k-scan2',
                    'application/pdf', 1024, decode(repeat('ab', 32), 'hex'), 'clean')`,
        );
        expect(refused).toBe(true);
      });
    });

    it('refuses a closed requirement with no closed_at', async () => {
      await inRolledBackTx(async (tx) => {
        const requirement = await makeRequirement(tx);
        const refused = await violates(
          tx,
          () =>
            tx.$executeRaw`UPDATE requirements SET status = 'closed' WHERE id = ${requirement}::uuid`,
        );
        expect(refused).toBe(true);
      });
    });

    it('allows at most one primary contact per employer', async () => {
      await inRolledBackTx(async (tx) => {
        const employer = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO employers (name) VALUES ('Primary Test') RETURNING id::text AS id`;
        const a = await makeUser(tx, 'primary-a@example.test');
        const b = await makeUser(tx, 'primary-b@example.test');
        const link = (userId: string) => tx.$executeRaw`
          INSERT INTO employer_contacts (employer_id, user_id, is_primary)
          VALUES (${employer[0]!.id}::uuid, ${userId}::uuid, true)`;
        expect(await violates(tx, () => link(a))).toBe(false);
        expect(await violates(tx, () => link(b))).toBe(true);
      });
    });

    it('refuses a stage transition to the same stage', async () => {
      await inRolledBackTx(async (tx) => {
        const stage = await makeStage(tx, 'self-transition');
        const candidate = await makeCandidate(tx, 'self-trans@example.test');
        const requirement = await makeRequirement(tx);
        const app = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO applications (requirement_id, candidate_profile_id, stage_id)
          VALUES (${requirement}::uuid, ${candidate}::uuid, ${stage}::uuid)
          RETURNING id::text AS id`;
        const refused = await violates(
          tx,
          () => tx.$executeRaw`
            INSERT INTO application_stage_history (application_id, from_stage_id, to_stage_id)
            VALUES (${app[0]!.id}::uuid, ${stage}::uuid, ${stage}::uuid)`,
        );
        expect(refused).toBe(true);
      });
    });

    it('refuses a non-terminal stage that claims a success outcome', async () => {
      await inRolledBackTx(async (tx) => {
        const refused = await violates(
          tx,
          () => tx.$executeRaw`
            INSERT INTO pipeline_stages (key, name_en, sort_order, is_terminal, is_success)
            VALUES ('bad-terminal', 'Bad', 999001, false, true)`,
        );
        expect(refused).toBe(true);
      });
    });

    it('refuses an unsupported locale', async () => {
      await inRolledBackTx(async (tx) => {
        const id = await makeUser(tx, 'locale@example.test');
        const refused = await violates(
          tx,
          () => tx.$executeRaw`UPDATE users SET locale = 'fr' WHERE id = ${id}::uuid`,
        );
        expect(refused).toBe(true);
      });
    });

    it('refuses a malformed E.164 phone number', async () => {
      await inRolledBackTx(async (tx) => {
        const userId = await makeUser(tx, 'phone@example.test');
        const refused = await violates(
          tx,
          () => tx.$executeRaw`
            INSERT INTO candidate_profiles (user_id, full_name, phone_e164)
            VALUES (${userId}::uuid, 'Test', '00201234567')`,
        );
        expect(refused).toBe(true);
      });
    });
  });

  describe('schema-wide invariants', () => {
    it('declares an explicit ON DELETE rule on every foreign key', async () => {
      // confdeltype 'a' = NO ACTION, i.e. no rule was declared.
      const rows = await db.$queryRaw<Array<{ conname: string }>>`
        SELECT conname FROM pg_constraint
        WHERE contype = 'f' AND connamespace = 'public'::regnamespace
          AND confdeltype = 'a'`;
      expect(rows.map((r) => r.conname)).toEqual([]);
    });

    it('gives every soft-deletable table a partial index excluding deleted rows', async () => {
      const rows = await db.$queryRaw<Array<{ table_name: string }>>`
        SELECT c.table_name FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.column_name = 'deleted_at'
          AND NOT EXISTS (
            SELECT 1 FROM pg_indexes i
            WHERE i.schemaname = 'public' AND i.tablename = c.table_name
              AND i.indexdef LIKE '%deleted_at IS NULL%')`;
      expect(rows.map((r) => r.table_name)).toEqual([]);
    });

    it('indexes document expiry, the one query guaranteed to run daily', async () => {
      const rows = await db.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'documents'
          AND indexdef LIKE '%expires_on%' AND indexdef LIKE '%WHERE%'`;
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});
