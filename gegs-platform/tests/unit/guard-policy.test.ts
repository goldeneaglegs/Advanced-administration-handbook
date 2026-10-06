import { describe, expect, it } from 'vitest';
import { requirePolicy } from '@/lib/auth/guard';
import { ApiError } from '@/lib/api/errors';
import { statusForDecision } from '@/lib/auth/policy';
import type { Actor } from '@/lib/auth/policy';

/**
 * The guard's policy integration: that a refusal becomes the right error, and
 * that the four outcomes keep their approved status codes once they cross into
 * the HTTP layer.
 *
 * The policy's own matrix is already covered by tests/unit/policy.test.ts; this
 * file only proves the wiring.
 */
const SELF = 'user-self';
const OTHER = 'user-other';

function actor(roles: Actor['roles'], overrides: Partial<Actor> = {}): Actor {
  return { userId: SELF, roles, status: 'active', sessionValid: true, ...overrides };
}

function refusal(fn: () => void): ApiError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected a refusal, but the policy allowed it');
}

describe('requirePolicy — outcome to error mapping', () => {
  it('returns nothing when allowed, rather than a boolean a caller could ignore', () => {
    expect(requirePolicy(actor(['admin']), 'audit.read')).toBeUndefined();
  });

  it('maps no session to UNAUTHENTICATED', () => {
    const error = refusal(() =>
      requirePolicy(actor(['admin'], { sessionValid: false }), 'audit.read'),
    );
    expect(error.code).toBe('UNAUTHENTICATED');
  });

  it('maps a non-active account to UNAUTHENTICATED, not FORBIDDEN', () => {
    const error = refusal(() =>
      requirePolicy(actor(['admin'], { status: 'suspended' }), 'audit.read'),
    );
    expect(error.code).toBe('UNAUTHENTICATED');
  });

  it('maps an ungranted action to FORBIDDEN', () => {
    const error = refusal(() => requirePolicy(actor(['candidate']), 'audit.read'));
    expect(error.code).toBe('FORBIDDEN');
  });

  it('maps an unreachable record to NOT_FOUND, never FORBIDDEN', () => {
    // Phase 1 §4.2: a 403 would confirm the record exists.
    const error = refusal(() =>
      requirePolicy(actor(['consultant']), 'application.transition', { ownerUserId: OTHER }),
    );
    expect(error.code).toBe('NOT_FOUND');
  });

  it('gives an unreachable record the same wording as an absent one', () => {
    const unreachable = refusal(() =>
      requirePolicy(actor(['consultant']), 'application.read', { ownerUserId: OTHER }),
    );
    expect(unreachable.message).toBe('Not found.');
    // No hint that something existed and was withheld.
    expect(unreachable.message).not.toMatch(/permission|access|forbidden|owner/i);
  });

  it('fails closed when a record-scoped action is called with no subject', () => {
    const error = refusal(() => requirePolicy(actor(['consultant']), 'application.read'));
    expect(error.code).toBe('NOT_FOUND');
  });

  it('leaks no internal reason to the client', () => {
    const error = refusal(() => requirePolicy(actor(['candidate']), 'config.manage'));
    expect(error.message).not.toMatch(/role|grant|policy|action|config\.manage/i);
  });

  it.each([
    ['unauthenticated', 401],
    ['forbidden', 403],
    ['not_found', 404],
  ] as const)('%s still maps to %i at the HTTP layer', (outcome, status) => {
    expect(statusForDecision({ outcome, reason: '' })).toBe(status);
  });
});

describe('the privacy split survives the guard', () => {
  it('a consultant passes global candidate search', () => {
    expect(requirePolicy(actor(['consultant']), 'candidate_profile.search')).toBeUndefined();
  });

  it('the same consultant is refused detail on an unlinked candidate', () => {
    const error = refusal(() =>
      requirePolicy(actor(['consultant']), 'candidate_profile.read_detail', {
        candidateUserId: OTHER,
      }),
    );
    expect(error.code).toBe('NOT_FOUND');
  });

  it('admin is refused a document through the guard', () => {
    // The admin exception, enforced at the point of use.
    const error = refusal(() =>
      requirePolicy(actor(['admin']), 'document.read', { candidateUserId: SELF }),
    );
    expect(error.code).toBe('FORBIDDEN');
  });
});
