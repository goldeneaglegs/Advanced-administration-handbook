import type { Prisma } from '@prisma/client';

/**
 * Audit writer (Phase 1 §7).
 *
 * Takes a transaction client, not the global one, so the audit row commits in
 * the SAME transaction as the change it records. An audit log that can be out
 * of step with reality is worse than none, because it is trusted.
 *
 * The audit tables are append-only, enforced by database triggers from
 * Milestone 1 — there is no update or delete path here because none exists.
 */
export type AuditAction =
  | 'auth.register'
  | 'auth.email_verified'
  | 'auth.invite_accepted'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.password_reset_requested'
  | 'auth.password_reset'
  | 'auth.account_locked';

export interface AuditEntry {
  action: AuditAction;
  subjectType: string;
  subjectId?: string | null;
  actorUserId?: string | null;
  actorIp?: string | null;
  requestId?: string | null;
  /** Changed fields only — never whole rows, never a password or a token. */
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
}

export async function writeAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO audit_log (actor_user_id, actor_ip, action, subject_type, subject_id,
                           before_json, after_json, request_id)
    VALUES (${entry.actorUserId ?? null}::uuid,
            ${entry.actorIp ?? null}::inet,
            ${entry.action},
            ${entry.subjectType},
            ${entry.subjectId ?? null}::uuid,
            ${entry.before ?? null},
            ${entry.after ?? null},
            ${entry.requestId ?? null})`;
}
