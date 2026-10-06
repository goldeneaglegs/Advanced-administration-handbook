/**
 * The action catalogue and the role→action grant table.
 *
 * DERIVED, NOT INVENTED. Every grant below traces to approved material:
 *   * Phase 0 §3  — the six roles and their core needs
 *   * Phase 0 §8  — the screens each role owns
 *   * Phase 1 §3.3 — the API contract
 *   * Phase 1 §4.2 — the reach rules and the admin exception
 *
 * Where the approved documents do not settle a cell, the action is listed in
 * UNDECIDED_ACTIONS and granted to NOBODY. Deny-by-default (Phase 1 §4.2) then
 * refuses it, and the gap stays visible in the data instead of being guessed.
 */
export const ROLE_KEYS = [
  'candidate',
  'employer',
  'consultant',
  'case_officer',
  'manager',
  'admin',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ACTIONS = [
  // Candidate's own record (Phase 0 §8 Candidate)
  'candidate_profile.read_own',
  'candidate_profile.update_own',
  'document.upload_own',
  'document.read_own',
  'document.delete_own',
  'application.apply',
  'application.read_own',
  'case.read_own',

  // Browsing candidates who are not yet on a record the actor owns
  // (Phase 0 §8 Consultant: "candidate search · candidate detail").
  //
  // Two separate actions, because they carry different privacy weight:
  //   search      — GLOBAL, and authorises only a RESTRICTED, non-sensitive
  //                 projection. Being able to search does not imply detail.
  //   read_detail — RECORD-SCOPED. Full detail is reachable only when the
  //                 candidate is linked to a record the actor already reaches
  //                 under the existing rules.
  'candidate_profile.search',
  'candidate_profile.read_detail',

  // Requirements (Phase 0 §8 Employer, Consultant, Manager)
  'requirement.create',
  'requirement.read',
  'requirement.update',

  // Applications (Phase 0 §8 Employer "accept/reject candidate";
  // Consultant "shortlist builder · application detail with stage control")
  'application.shortlist',
  'application.read',
  'application.read_history',
  'application.transition',
  'application.decide',

  // Government-service cases (Phase 0 §8 Case officer, Manager)
  'case.create',
  'case.read',
  'case.read_checklist',
  'case.transition',

  // Reading a document attached to a record (Phase 1 §4.2 admin exception)
  'document.read',

  // Organisation-wide views and reassignment (Phase 0 §8 Manager)
  'org.overview',
  'record.reassign',

  // Administration (Phase 0 §8 Admin, Phase 1 §8)
  'user.list',
  'user.manage_roles',
  'user.manage_status',
  'config.manage',
  'audit.read',
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * Actions that are scoped to a specific record.
 *
 * For these, passing the role check is not enough: step 3 of Phase 1 §4.2 also
 * asks whether the actor REACHES this particular record. Everything else is a
 * global capability and needs no subject.
 */
export const RECORD_SCOPED: ReadonlySet<Action> = new Set<Action>([
  'candidate_profile.read_own',
  'candidate_profile.update_own',
  'candidate_profile.read_detail',
  'document.upload_own',
  'document.read_own',
  'document.delete_own',
  'document.read',
  'application.apply',
  'application.read_own',
  'application.read',
  'application.read_history',
  'application.transition',
  'application.decide',
  'case.read_own',
  'case.read',
  'case.read_checklist',
  'case.transition',
  'requirement.read',
  'requirement.update',
  'record.reassign',
]);

/**
 * Actions whose grant the approved documents do not settle.
 *
 * Currently EMPTY. The mechanism is kept because it is how a future
 * undecided action stays visible and denied rather than guessed: add it here
 * and deny-by-default refuses it for every role.
 *
 * It previously held candidate search, where Phase 0 §8/§9 required the
 * capability while Phase 1 §4.2 scoped consultants to `owner_user_id` records
 * and `candidate_profiles` has no owner column. That is now resolved: search is
 * a global action authorising a restricted projection, and full detail is a
 * separate record-scoped action reached through the linking record. No owner
 * column was added.
 */
export const UNDECIDED_ACTIONS: ReadonlySet<Action> = new Set<Action>();

/**
 * Role → granted actions.
 *
 * Deliberately NOT granted, and each omission is a derivation rather than an
 * oversight:
 *   * `manager` has no `application.transition` or `case.transition`: Phase 0
 *     §8 gives managers overview, all requirements, all cases and
 *     reassignment — stage control belongs to the consultant screen.
 *   * `admin` has no `document.read` of any kind. Phase 1 §4.2: "admin manages
 *     the system; it does not get silent access to people's passports."
 *   * `employer` has no `application.transition`; it has `application.decide`,
 *     the accept/reject from Phase 0 §8. Whether a decision is implemented as a
 *     stage transition is a Milestone 6 question.
 *   * `manager` has no `candidate_profile.search` or `read_detail`. Phase 0 §8
 *     gives candidate search to the consultant screen, and the decision
 *     resolving it named only Consultant and Case Officer. Deny-by-default is
 *     preserved for every other role.
 *
 * WHAT THIS LAYER DOES NOT DO: it authorises the two actions, it does not shape
 * the response. Returning only the restricted projection for
 * `candidate_profile.search` is the query's job when the search endpoint is
 * built (Milestone 6). The policy can distinguish the two actions; it cannot
 * enforce the columns.
 */
export const GRANTS: Readonly<Record<RoleKey, readonly Action[]>> = {
  candidate: [
    'candidate_profile.read_own',
    'candidate_profile.update_own',
    'document.upload_own',
    'document.read_own',
    'document.delete_own',
    'application.apply',
    'application.read_own',
    'case.read_own',
  ],
  employer: [
    'requirement.create',
    'requirement.read',
    'requirement.update',
    'application.read',
    'application.decide',
  ],
  consultant: [
    'candidate_profile.search',
    'candidate_profile.read_detail',
    'requirement.read',
    'application.shortlist',
    'application.read',
    'application.read_history',
    'application.transition',
    'document.read',
  ],
  case_officer: [
    'candidate_profile.search',
    'candidate_profile.read_detail',
    'case.create',
    'case.read',
    'case.read_checklist',
    'case.transition',
    'document.read',
  ],
  manager: ['org.overview', 'requirement.read', 'application.read', 'case.read', 'record.reassign'],
  admin: ['user.list', 'user.manage_roles', 'user.manage_status', 'config.manage', 'audit.read'],
} as const;
