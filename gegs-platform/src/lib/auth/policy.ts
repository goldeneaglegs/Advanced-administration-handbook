import {
  type Action,
  GRANTS,
  RECORD_SCOPED,
  type RoleKey,
  UNDECIDED_ACTIONS,
} from '@/lib/auth/actions';

/**
 * The authorisation policy layer (Phase 1 §4.2).
 *
 * One function, deny by default. Phase 1 requires that every handler's first
 * statement be a policy call and that there be no second way to reach data.
 *
 * NOT WIRED INTO ANY ENDPOINT in this batch, by instruction. It is built and
 * exhaustively tested before it starts gating live requests, which is the same
 * ordering that put Milestone 3 ahead of Milestones 5–8.
 *
 * Step 4 of §4.2 — "is the state transition legal from the current stage" — is
 * deliberately absent. It needs the stage machine, and the stages are still
 * client configuration (DECISION REQUIRED #6). A transition check here would
 * have to invent them.
 */

/** Why a request was refused. Maps to exactly one HTTP status. */
export type Outcome = 'allow' | 'unauthenticated' | 'forbidden' | 'not_found';

export interface Decision {
  outcome: Outcome;
  /** For logs and tests. Never shown to a user. */
  reason: string;
}

export interface Actor {
  userId: string;
  roles: readonly RoleKey[];
  /** Mirrors users.status; only 'active' may act. */
  status: string;
  /** False when no valid session resolved. */
  sessionValid: boolean;
  /** Set for an employer actor; identifies which employer they belong to. */
  employerId?: string | null;
}

/**
 * The record being acted on.
 *
 * Attribution fields only — whichever of them the record carries. A global
 * action passes no subject at all.
 */
export interface Subject {
  /** users.id of the candidate this record belongs to. */
  candidateUserId?: string | null;
  /** employers.id this record belongs to. */
  employerId?: string | null;
  /** users.id of the staff member who owns this record. */
  ownerUserId?: string | null;
}

const ALLOW: Decision = { outcome: 'allow', reason: 'granted' };

/** HTTP status for a decision. 404 for unreachable, per Phase 1 §4.2. */
export function statusForDecision(decision: Decision): number {
  switch (decision.outcome) {
    case 'allow':
      return 200;
    case 'unauthenticated':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
  }
}

function grantsAction(roles: readonly RoleKey[], action: Action): boolean {
  return roles.some((role) => GRANTS[role]?.includes(action));
}

/**
 * Whether the actor reaches this specific record (step 3 of §4.2).
 *
 * The rules, verbatim from the approved plan:
 *   candidate            → only records where they are the candidate
 *   employer             → only records belonging to their employer
 *   consultant/officer   → only records where they are owner_user_id
 *   manager              → all records in the organisation
 *   admin                → users, configuration and the audit log; NOT documents
 *
 * Employer reach is per DECISION #5 as finalised: limited to records belonging
 * to that employer, with no cross-employer access.
 */
function reaches(actor: Actor, action: Action, subject: Subject): boolean {
  // Manager first: organisation-wide reach, so no attribution is needed.
  if (actor.roles.includes('manager') && grantsAction(['manager'], action)) return true;

  if (actor.roles.includes('candidate') && grantsAction(['candidate'], action)) {
    if (subject.candidateUserId && subject.candidateUserId === actor.userId) return true;
  }

  if (actor.roles.includes('employer') && grantsAction(['employer'], action)) {
    // No cross-employer access. An employer actor with no employerId reaches
    // nothing, rather than everything.
    if (actor.employerId && subject.employerId && subject.employerId === actor.employerId) {
      return true;
    }
  }

  for (const role of ['consultant', 'case_officer'] as const) {
    if (actor.roles.includes(role) && grantsAction([role], action)) {
      if (subject.ownerUserId && subject.ownerUserId === actor.userId) return true;
    }
  }

  // `admin` is intentionally absent: it holds no record-scoped grant, so it
  // can never reach a candidate's document through this path.
  return false;
}

/**
 * can(actor, action, subject) -> allow | deny.
 *
 * Resolution order is exactly Phase 1 §4.2, and nothing short-circuits it:
 *   1. valid session and active account, else 401
 *   2. some role grants the action, else 403
 *   3. for a record-scoped action, the actor reaches this record, else 404
 *
 * Step 3 returns NOT FOUND rather than forbidden. A 403 would confirm the
 * record exists, which leaks the size and shape of the candidate base.
 */
export function can(actor: Actor, action: Action, subject?: Subject): Decision {
  if (!actor.sessionValid) {
    return { outcome: 'unauthenticated', reason: 'no valid session' };
  }
  if (actor.status !== 'active') {
    return { outcome: 'unauthenticated', reason: `account status is ${actor.status}` };
  }

  if (UNDECIDED_ACTIONS.has(action)) {
    // Granted to nobody on purpose; see UNDECIDED_ACTIONS.
    return { outcome: 'forbidden', reason: `${action} has no approved grant` };
  }

  if (!grantsAction(actor.roles, action)) {
    return { outcome: 'forbidden', reason: `no role grants ${action}` };
  }

  if (RECORD_SCOPED.has(action)) {
    if (!subject) {
      // A record-scoped action with no record cannot be evaluated, so it is
      // refused. Failing closed is the only safe reading of a missing subject.
      return {
        outcome: 'not_found',
        reason: `${action} is record-scoped but no subject was given`,
      };
    }
    if (!reaches(actor, action, subject)) {
      return { outcome: 'not_found', reason: `actor does not reach this record for ${action}` };
    }
  }

  return ALLOW;
}
