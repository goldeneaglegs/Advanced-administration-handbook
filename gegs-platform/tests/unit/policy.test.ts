import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  type Action,
  GRANTS,
  RECORD_SCOPED,
  ROLE_KEYS,
  type RoleKey,
  UNDECIDED_ACTIONS,
} from '@/lib/auth/actions';
import { type Actor, can, statusForDecision, type Subject } from '@/lib/auth/policy';

/**
 * The generated authorisation matrix (Phase 1 §14.2).
 *
 * "For a product holding identity documents under six roles, the test that
 * matters most is not 'does the happy path work' but 'can role X reach record Y
 * that does not belong to them'."
 *
 * Generated from ROLE_KEYS × ACTIONS × own/other rather than hand-written, so
 * adding an action or a role without deciding its grants fails the build.
 */
const SELF = 'user-self';
const OTHER = 'user-other';
const MY_EMPLOYER = 'employer-mine';
const THEIR_EMPLOYER = 'employer-theirs';

function actor(roles: readonly RoleKey[], overrides: Partial<Actor> = {}): Actor {
  return {
    userId: SELF,
    roles,
    status: 'active',
    sessionValid: true,
    employerId: roles.includes('employer') ? MY_EMPLOYER : null,
    ...overrides,
  };
}

/** A record attributed to the actor, in every way a record can be. */
const OWN: Subject = {
  candidateUserId: SELF,
  employerId: MY_EMPLOYER,
  ownerUserId: SELF,
};

/** The same record shape, attributed to somebody else entirely. */
const OTHERS: Subject = {
  candidateUserId: OTHER,
  employerId: THEIR_EMPLOYER,
  ownerUserId: OTHER,
};

describe('catalogue integrity', () => {
  it('every granted action exists in the catalogue', () => {
    const known = new Set<string>(ACTIONS);
    for (const role of ROLE_KEYS) {
      for (const action of GRANTS[role]) {
        expect(known.has(action), `${role} grants unknown action ${action}`).toBe(true);
      }
    }
  });

  it('every record-scoped action exists in the catalogue', () => {
    for (const action of RECORD_SCOPED) expect(ACTIONS).toContain(action);
  });

  it('every action is either granted to someone or explicitly undecided', () => {
    // The guard against a silently unreachable action: a new entry must be
    // granted or declared undecided, never left to rot.
    const granted = new Set<string>(ROLE_KEYS.flatMap((r) => [...GRANTS[r]]));
    const orphans = ACTIONS.filter((a) => !granted.has(a) && !UNDECIDED_ACTIONS.has(a));
    expect(orphans, `ungranted and not declared undecided: ${orphans.join(', ')}`).toEqual([]);
  });

  it('maps each outcome to exactly one status', () => {
    expect(statusForDecision({ outcome: 'allow', reason: '' })).toBe(200);
    expect(statusForDecision({ outcome: 'unauthenticated', reason: '' })).toBe(401);
    expect(statusForDecision({ outcome: 'forbidden', reason: '' })).toBe(403);
    // Phase 1 §4.2: unreachable is NOT FOUND, never forbidden.
    expect(statusForDecision({ outcome: 'not_found', reason: '' })).toBe(404);
  });
});

describe('step 1 — session and account state', () => {
  it.each(ROLE_KEYS)('%s with no valid session is unauthenticated', (role) => {
    const decision = can(actor([role], { sessionValid: false }), 'org.overview', OWN);
    expect(decision.outcome).toBe('unauthenticated');
  });

  it.each(['invited', 'suspended'])('an %s account is unauthenticated', (status) => {
    expect(can(actor(['manager'], { status }), 'org.overview', OWN).outcome).toBe(
      'unauthenticated',
    );
  });

  it('checks the session before the grant, so a suspended admin is 401 not 403', () => {
    const decision = can(actor(['admin'], { status: 'suspended' }), 'audit.read');
    expect(decision.outcome).toBe('unauthenticated');
  });
});

describe('the generated matrix — role x action x own/other', () => {
  for (const role of ROLE_KEYS) {
    const granted = new Set<string>(GRANTS[role]);

    for (const action of ACTIONS) {
      const expectation = UNDECIDED_ACTIONS.has(action)
        ? 'forbidden'
        : granted.has(action)
          ? 'allow'
          : 'forbidden';

      it(`${role} / ${action} / own record -> ${expectation}`, () => {
        const decision = can(actor([role]), action as Action, OWN);
        if (expectation === 'allow') expect(decision.outcome).toBe('allow');
        else expect(decision.outcome).toBe('forbidden');
      });

      // The question that matters: reaching somebody else's record.
      const otherExpectation = UNDECIDED_ACTIONS.has(action)
        ? 'forbidden'
        : !granted.has(action)
          ? 'forbidden'
          : // Granted. Only a manager reaches another party's record; for
            // everyone else a record-scoped action must come back NOT FOUND.
            role === 'manager' || !RECORD_SCOPED.has(action)
            ? 'allow'
            : 'not_found';

      it(`${role} / ${action} / another party's record -> ${otherExpectation}`, () => {
        const decision = can(actor([role]), action as Action, OTHERS);
        expect(decision.outcome).toBe(otherExpectation);
      });
    }
  }
});

describe('the rules that carry the most weight', () => {
  it('a candidate cannot read another candidate, and gets 404 not 403', () => {
    const decision = can(actor(['candidate']), 'candidate_profile.read_own', OTHERS);
    expect(decision.outcome).toBe('not_found');
    expect(statusForDecision(decision)).toBe(404);
  });

  it('an employer cannot reach another employer (DECISION #5: no cross-employer access)', () => {
    const decision = can(actor(['employer']), 'requirement.read', {
      employerId: THEIR_EMPLOYER,
    });
    expect(decision.outcome).toBe('not_found');
  });

  it('an employer with no employerId reaches nothing rather than everything', () => {
    const decision = can(actor(['employer'], { employerId: null }), 'requirement.read', {
      employerId: MY_EMPLOYER,
    });
    expect(decision.outcome).toBe('not_found');
  });

  it('a consultant reaches only records they own', () => {
    expect(can(actor(['consultant']), 'application.transition', OWN).outcome).toBe('allow');
    expect(
      can(actor(['consultant']), 'application.transition', { ownerUserId: OTHER }).outcome,
    ).toBe('not_found');
  });

  it('a case officer cannot transition an application, nor a consultant a case', () => {
    expect(can(actor(['case_officer']), 'application.transition', OWN).outcome).toBe('forbidden');
    expect(can(actor(['consultant']), 'case.transition', OWN).outcome).toBe('forbidden');
  });

  it('a manager reaches every record but cannot transition one', () => {
    expect(can(actor(['manager']), 'case.read', OTHERS).outcome).toBe('allow');
    expect(can(actor(['manager']), 'application.read', OTHERS).outcome).toBe('allow');
    // Phase 0 §8 gives managers overview and reassignment, not stage control.
    expect(can(actor(['manager']), 'application.transition', OTHERS).outcome).toBe('forbidden');
  });

  it('ADMIN CANNOT READ A DOCUMENT — the admin exception', () => {
    // Phase 1 §4.2: "admin manages the system; it does not get silent access to
    // people's passports."
    for (const action of ['document.read', 'document.read_own'] as const) {
      expect(can(actor(['admin']), action, OWN).outcome).toBe('forbidden');
      expect(can(actor(['admin']), action, OTHERS).outcome).toBe('forbidden');
    }
  });

  it('admin holds no record-scoped grant at all', () => {
    const adminRecordScoped = GRANTS.admin.filter((a) => RECORD_SCOPED.has(a));
    expect(adminRecordScoped).toEqual([]);
  });

  it('a record-scoped action with no subject fails closed', () => {
    expect(can(actor(['consultant']), 'application.read').outcome).toBe('not_found');
  });

  it('a global action needs no subject', () => {
    expect(can(actor(['admin']), 'audit.read').outcome).toBe('allow');
    expect(can(actor(['manager']), 'org.overview').outcome).toBe('allow');
  });

  it('combining roles unions their grants without widening reach', () => {
    const both = actor(['candidate', 'consultant']);
    expect(can(both, 'application.transition', { ownerUserId: SELF }).outcome).toBe('allow');
    expect(can(both, 'application.transition', { ownerUserId: OTHER }).outcome).toBe('not_found');
  });

  it('a user with no roles is forbidden everything', () => {
    for (const action of ACTIONS) {
      expect(can(actor([]), action as Action, OWN).outcome).not.toBe('allow');
    }
  });
});

describe('candidate search — the resolved privacy split', () => {
  it('no action is left undecided', () => {
    // The mechanism stays for future use; today nothing should be in it.
    expect([...UNDECIDED_ACTIONS]).toEqual([]);
  });

  it.each(['consultant', 'case_officer'] as const)(
    '%s can search candidates globally, since the workflow requires it',
    (role) => {
      // Search is NOT record-scoped: a consultant must be able to find a
      // candidate who is not yet on any of their records, or shortlisting is
      // impossible (Phase 0 §8, §9 journey 3).
      expect(can(actor([role]), 'candidate_profile.search').outcome).toBe('allow');
      expect(can(actor([role]), 'candidate_profile.search', OTHERS).outcome).toBe('allow');
    },
  );

  it.each(['consultant', 'case_officer'] as const)(
    '%s gets full detail ONLY through a record they reach',
    (role) => {
      // Linked to a record they own -> allowed.
      expect(
        can(actor([role]), 'candidate_profile.read_detail', { ownerUserId: SELF }).outcome,
      ).toBe('allow');
      // Someone else's record -> not found, so searchability never implies detail.
      expect(
        can(actor([role]), 'candidate_profile.read_detail', { ownerUserId: OTHER }).outcome,
      ).toBe('not_found');
      // No linking record at all -> fails closed.
      expect(can(actor([role]), 'candidate_profile.read_detail').outcome).toBe('not_found');
    },
  );

  it('searching does not hand over the candidate database', () => {
    // The distinction that makes the privacy rule real: the same actor who may
    // search is refused detail on an unlinked candidate.
    const consultant = actor(['consultant']);
    expect(can(consultant, 'candidate_profile.search').outcome).toBe('allow');
    expect(
      can(consultant, 'candidate_profile.read_detail', { candidateUserId: OTHER }).outcome,
    ).toBe('not_found');
  });

  it('search is global and detail is record-scoped, by construction', () => {
    expect(RECORD_SCOPED.has('candidate_profile.search')).toBe(false);
    expect(RECORD_SCOPED.has('candidate_profile.read_detail')).toBe(true);
  });

  it.each(['candidate', 'employer', 'manager', 'admin'] as const)(
    'deny-by-default is preserved for %s',
    (role) => {
      expect(can(actor([role]), 'candidate_profile.search').outcome).toBe('forbidden');
      expect(can(actor([role]), 'candidate_profile.read_detail', OWN).outcome).toBe('forbidden');
    },
  );
});
