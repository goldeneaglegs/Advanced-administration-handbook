import type { Prisma } from '@prisma/client';

/**
 * Enqueues a notification row.
 *
 * APPROVED DECISION: Milestone 2 only WRITES these rows. Nothing is sent, and
 * no email provider is chosen — delivery is Milestone 9.
 *
 * THE PAYLOAD DELIBERATELY CARRIES NO TOKEN, and this has a consequence worth
 * recording now. Only the SHA-256 of a token is stored in `email_tokens`
 * (src/lib/auth/tokens.ts), so putting the plaintext into `payload_json` would
 * put it at rest in the database and undo that protection.
 *
 * CONSEQUENCE FOR MILESTONE 9: a queued row therefore cannot, by itself,
 * produce a usable verification or reset link. Milestone 9 must either send
 * these emails synchronously at request time, while the plaintext is still in
 * memory, or introduce a deliberately short-lived encrypted hand-off. That is
 * a Milestone 9 design decision; it is flagged here rather than pre-empted.
 *
 * Phase 1 §12 also applies: notification content stays minimal — something
 * changed, please sign in — so that personal data does not cross the residency
 * boundary through the email channel.
 */
export type NotificationTemplateKey = 'auth.verify_email' | 'auth.password_reset' | 'auth.invite';

export async function enqueueNotification(
  tx: Prisma.TransactionClient,
  userId: string,
  templateKey: NotificationTemplateKey,
  payload: Prisma.InputJsonValue = {},
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO notifications (user_id, channel, template_key, payload_json)
    VALUES (${userId}::uuid, 'email', ${templateKey}, ${payload})`;
}
