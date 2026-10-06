import type { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import { GENERIC_TOKEN_FAILURE } from '@/lib/auth/messages';
import { hashToken } from '@/lib/auth/tokens';

export type TokenPurpose = 'verify_email' | 'reset_password' | 'accept_invite';

export interface UsableToken {
  tokenId: string;
  userId: string;
}

/**
 * Finds a usable token and consumes it, inside the caller's transaction.
 *
 * Lookup is by HASH, so the plaintext never needs to be compared in the
 * database and a leaked table yields nothing usable.
 *
 * `FOR UPDATE` is the important part: it locks the row for the transaction's
 * duration, so two requests racing with the same token cannot both pass the
 * "not yet consumed" check. Without it, single-use would be advisory rather
 * than enforced.
 *
 * Every failure — unknown, already consumed, expired, wrong purpose — raises
 * the SAME error, so the three cases cannot be told apart by a caller probing
 * tokens.
 */
export async function consumeToken(
  tx: Prisma.TransactionClient,
  plaintext: string,
  purpose: TokenPurpose,
): Promise<UsableToken> {
  const rows = await tx.$queryRaw<Array<{ id: string; user_id: string }>>`
    SELECT id::text AS id, user_id::text AS user_id
    FROM email_tokens
    WHERE token_hash = ${hashToken(plaintext)}
      AND purpose = ${purpose}::email_token_purpose
      AND consumed_at IS NULL
      AND expires_at > now()
    FOR UPDATE`;

  const row = rows[0];
  if (!row) throw new ApiError('UNAUTHENTICATED', GENERIC_TOKEN_FAILURE);

  await tx.$executeRaw`
    UPDATE email_tokens SET consumed_at = now() WHERE id = ${row.id}::uuid`;

  return { tokenId: row.id, userId: row.user_id };
}
