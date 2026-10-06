import { ApiError } from '@/lib/api/errors';
import { getDb } from '@/lib/db';
import type { Action } from '@/lib/auth/actions';
import { ROLE_KEYS, type RoleKey } from '@/lib/auth/actions';
import { THROTTLE } from '@/lib/auth/params';
import { type Actor, type Decision, can, type Subject } from '@/lib/auth/policy';
import { SESSION_COOKIE, resolveSession } from '@/lib/auth/session';
import { checkIpBudget, recordAttempt, type ThrottledAction } from '@/lib/auth/throttle';
import {
  getRequestContext,
  readCookie,
  readJsonBody,
  requireCsrf,
  type RequestContext,
} from '@/lib/auth/request-context';

/**
 * The guards every state-changing auth endpoint runs, in a fixed order.
 *
 * Order matters and is deliberate:
 *   1. CSRF — a forged cross-site request is rejected before it can consume any
 *      throttle budget, so an attacker cannot exhaust a victim's allowance from
 *      another site.
 *   2. Per-IP budget — checked before any database lookup of the subject, so a
 *      spraying client learns nothing at all.
 *
 * Centralised so that seven endpoints cannot drift apart, and so that adding an
 * endpoint without its guards is a visible omission rather than a silent one.
 */
export interface GuardedRequest {
  context: RequestContext;
  body: Record<string, unknown>;
}

const BUDGETS: Record<ThrottledAction, { windowMs: number; max: number }> = {
  login: THROTTLE.login.volume,
  forgot_password: THROTTLE.forgotPasswordIp,
  register: THROTTLE.register,
  verify_email: THROTTLE.tokenSubmit,
  reset_password: THROTTLE.tokenSubmit,
  accept_invite: THROTTLE.tokenSubmit,
};

export async function guard(request: Request, action: ThrottledAction): Promise<GuardedRequest> {
  const context = getRequestContext(request);
  const body = await readJsonBody(request);

  requireCsrf(request, context, body);

  const decision = await checkIpBudget(context.ip, action, BUDGETS[action]);
  if (!decision.allowed) {
    await recordAttempt(context.ip, action, false);
    throw new ApiError('RATE_LIMITED', 'Too many attempts. Try again shortly.');
  }

  return { context, body };
}

/* ---------------------------------------------------------------------------
 * Authorisation (Milestone 3 batch 2)
 *
 * The guard above serves the UNAUTHENTICATED auth endpoints — register, verify,
 * reset and friends — which have no actor and so nothing to authorise.
 * Everything below is the authenticated path: it turns a request into an Actor
 * and runs the committed policy engine against it.
 *
 * NO ENDPOINT IS CHANGED BY THIS BATCH. `/api/me` is specified to return roles
 * and act on none, so retrofitting a policy call onto it would alter approved
 * Milestone 2 behaviour. These functions are the mechanism the record-scoped
 * endpoints will call from Milestone 5 onward, built and proven first — the
 * same ordering that put Milestone 3 ahead of the features it protects.
 * ------------------------------------------------------------------------- */

/** An anonymous actor: no session, so step 1 of the policy refuses it. */
const ANONYMOUS: Actor = { userId: '', roles: [], status: 'anonymous', sessionValid: false };

function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

/**
 * Builds the Actor for a request from its session cookie.
 *
 * Roles and employer membership are read from the database on every call, never
 * from the cookie or from any client-supplied value. A role cached in a token
 * would keep working after it was revoked; reading it fresh means a revoked
 * grant takes effect on the next request.
 *
 * An unrecognised role key in the database is DISCARDED rather than passed
 * through. `can()` would ignore it anyway, but dropping it here means a typo in
 * a future seed cannot silently widen anyone's reach.
 *
 * AMBIGUOUS EMPLOYER MEMBERSHIP. `employer_contacts` has PRIMARY KEY
 * (employer_id, user_id), so the approved schema permits one user under several
 * employers, while `Actor.employerId` holds one value. Whether that may happen
 * in v1 is an OPEN DECISION: no approved document permits it and none forbids
 * it, so this function asserts neither. What it must not do is choose. Picking
 * one employer would grant reach the actor may not have and silently withhold
 * the rest; leaving the field null would withhold reach silently too. So an
 * actor with more than one membership is REFUSED OUTRIGHT, through the same
 * ApiError mechanism every other failure here uses. Fail closed, and loudly
 * enough to be diagnosed, until the decision is taken.
 */
export async function resolveActor(request: Request): Promise<Actor> {
  const session = await resolveSession(readCookie(request, SESSION_COOKIE));
  if (!session) return ANONYMOUS;

  const rows = await getDb().$queryRaw<
    Array<{ status: string; role_keys: string[] | null; employer_ids: string[] | null }>
  >`
    SELECT u.status::text AS status,
           array_remove(array_agg(DISTINCT r.key), NULL) AS role_keys,
           array_remove(array_agg(DISTINCT ec.employer_id::text), NULL) AS employer_ids
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    LEFT JOIN employer_contacts ec ON ec.user_id = u.id
    WHERE u.id = ${session.userId}::uuid AND u.deleted_at IS NULL
    GROUP BY u.status`;

  const row = rows[0];
  if (!row) return ANONYMOUS;

  // Every membership, never an arbitrary one. See AMBIGUOUS EMPLOYER
  // MEMBERSHIP above for why this refuses instead of choosing.
  const employerIds = row.employer_ids ?? [];
  if (employerIds.length > 1) {
    // The wording is the generic internal message, identical to the fallback in
    // `toErrorBody`: the client learns nothing about employers, memberships or
    // their number. The request id is what makes the event traceable.
    throw new ApiError('INTERNAL', 'Something went wrong. Quote this reference if you contact us.');
  }

  return {
    userId: session.userId,
    roles: (row.role_keys ?? []).filter(isRoleKey),
    status: row.status,
    sessionValid: true,
    employerId: employerIds[0] ?? null,
  };
}

/** Maps a policy outcome to the error the client sees. */
function errorFor(decision: Decision): ApiError {
  switch (decision.outcome) {
    case 'unauthenticated':
      return new ApiError('UNAUTHENTICATED', 'Sign in to continue.');
    case 'forbidden':
      return new ApiError('FORBIDDEN', 'You do not have access to this.');
    case 'not_found':
      // Phase 1 §4.2: a record the actor cannot reach is NOT FOUND, never
      // forbidden. A 403 would confirm the record exists and leak the size and
      // shape of the candidate base. The wording is therefore identical to a
      // genuinely absent record.
      return new ApiError('NOT_FOUND', 'Not found.');
    case 'allow':
      // Unreachable: callers only build an error from a refusal. Failing closed
      // rather than returning something falsy keeps the type honest.
      return new ApiError('FORBIDDEN', 'You do not have access to this.');
  }
}

/**
 * Enforces the policy for an already-resolved actor.
 *
 * Throws the mapped ApiError on refusal and returns nothing on success, so a
 * caller cannot accidentally treat a denial as a pass by ignoring a boolean.
 */
export function requirePolicy(actor: Actor, action: Action, subject?: Subject): void {
  const decision = subject === undefined ? can(actor, action) : can(actor, action, subject);
  if (decision.outcome !== 'allow') throw errorFor(decision);
}

/**
 * The authenticated read guard: resolve the actor, then authorise.
 *
 * No CSRF and no throttle budget, because a read changes nothing. Returns the
 * Actor so the handler can scope its query without resolving the session twice.
 */
export async function authorize(
  request: Request,
  action: Action,
  subject?: Subject,
): Promise<Actor> {
  const actor = await resolveActor(request);
  requirePolicy(actor, action, subject);
  return actor;
}

/**
 * The authenticated write guard: CSRF, then authorise.
 *
 * Same ordering principle as the unauthenticated guard above — a forged
 * cross-site request is rejected before it can reach the policy or the
 * database, so it learns nothing about what exists.
 *
 * Deliberately NOT throttled: the per-IP budgets in THROTTLE cover the
 * unauthenticated surface, where an attacker has unlimited attempts. Applying
 * one of those budgets to an authenticated action would be inventing a limit
 * nobody approved.
 */
export async function guardAuthorized(
  request: Request,
  action: Action,
  subject?: Subject,
): Promise<{ actor: Actor; context: RequestContext; body: Record<string, unknown> }> {
  const context = getRequestContext(request);
  const body = await readJsonBody(request);

  requireCsrf(request, context, body);

  const actor = await resolveActor(request);
  requirePolicy(actor, action, subject);

  return { actor, context, body };
}
