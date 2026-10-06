# Phase 0 — Product Definition (DRAFT FOR APPROVAL)

**Status:** Draft. Not approved. No production code written.
**Date:** 2026-10-06
**Branch:** `claude/global-app-master-build-vs6h2r`
**Author:** Lead product engineer / UX / security / QA / deployment (single owner)

---

## 0. How to read this document

This document separates three different kinds of statement. Please read the labels — they
matter for approval:

| Label | Meaning |
|---|---|
| **GROUNDED** | Taken from material you already approved (the Golden Eagle GS architect and QA skills installed in this workspace). Not invented. |
| **RECOMMENDED** | My professional recommendation. Reasoned, but yours to accept or reject. |
| **DECISION REQUIRED** | I deliberately did **not** fill this in. It is business fact, legal fact, or brand fact that I must not invent. Build cannot start until you supply it. |

Nothing in this document invents business rules, pricing, legal terms, company data, user
data, integrations, or content. Where those were needed, I left a **DECISION REQUIRED**
marker instead of a plausible-looking placeholder.

---

## 1. Blocking conflict I must raise before Phase 1

Your brief says: *"build a real production-quality application from zero."*

Your installed Golden Eagle GS architect skill says, as a core principle:

> Evolution, never revolution. Preserve approved architecture. Never rewrite stable
> systems. Extend instead of replace. Prefer adapters over rewrites.

Both skills also assume the platform is **WordPress + ACF + Elementor** (they mandate CPT
registration checks, ACF field mapping, template loading, PHP syntax validation, WordPress
coding standards).

These two instructions point in opposite directions. I will not resolve this silently,
because picking wrong wastes an entire build cycle. Three readings are possible:

- **(A) Greenfield replacement.** A new application that eventually replaces the WordPress
  site. Contradicts "never rewrite stable systems."
- **(B) Greenfield adjacent product.** A new application that runs *alongside* the existing
  WordPress site and owns a workflow WordPress is bad at (applicant tracking, document
  collection, case management). WordPress keeps marketing, SEO and content. This honours
  both instructions.
- **(C) Extension of WordPress.** Build inside the existing WordPress stack as a plugin or
  theme extension. Fully honours the skills, but caps you at WordPress's limits for
  stateful, multi-role, auditable workflow.

**RECOMMENDED: (B).** Reasons: it preserves your SEO, URLs, schema and breadcrumbs (which
the architect skill explicitly protects); it lets the operational workflow use a stack
actually designed for it; it isolates failure, so a bug in the new app cannot take down the
public site; and it gives a clean rollback — switch the entry-point link off and you are
back to today's state. Option C's cost is not the first release, it is year two:
role-based workflow, audit logging and document handling inside WordPress become permanent
maintenance debt. Option A throws away a working, indexed asset for no business reason.

**DECISION REQUIRED #1: Confirm A, B, or C.** Everything downstream depends on this.

### Second structural issue: repository

This session is scoped to one repository, `goldeneaglegs/advanced-administration-handbook`,
which is a fork of the WordPress Advanced Administration Handbook — a **documentation**
repository. A production application does not belong in it. Phase 0 is documentation, so
this file is safe here. Application code is not.

**RECOMMENDED:** create a dedicated repository (e.g. `goldeneaglegs/gegs-platform`) before
Phase 2. I can request it be added to this session.

**DECISION REQUIRED #2: Confirm the target repository for application code.**

---

## 2. Product purpose

**GROUNDED (from your architect skill):** Golden Eagle GS is a premium recruitment and
government services platform. Its design language is luxury, corporate, premium, minimal,
elegant, professional. Its architecture is employer-first, with a deliberately simple
candidate journey. Benchmarks are the global recruitment leaders (Randstad, Adecco, Hays,
Michael Page, Korn Ferry, Spencer Stuart, Egon Zehnder), GCC manpower companies, and premium
SaaS products (Stripe, Apple, Linear, Notion, Vercel) — for principles, never copied designs.

**RECOMMENDED problem statement for the new application** (to be confirmed or replaced by
you):

> Recruitment and government-services work for GCC employers is executed today over email,
> WhatsApp, spreadsheets and paper documents. Nobody — employer, candidate, or Golden Eagle
> staff — can see the true state of a placement or an application at any moment. Documents
> expire silently. Compliance evidence is reconstructed after the fact. The product's purpose
> is to make every placement and every government-service case a single auditable record with
> one current status, visible to exactly the parties entitled to see it.

**DECISION REQUIRED #3:** Confirm, correct, or replace that problem statement. If the real
problem is different, say so in one sentence and I will rebuild Phase 0 around it. This is
the single highest-leverage answer you can give me.

**DECISION REQUIRED #4: Application name.** "Golden Eagle GS" is the company and the
existing brand. I will not coin a product name for you.

---

## 3. Target users and roles

**RECOMMENDED role model.** Six roles, least-privilege by default:

| Role | Who | Core need |
|---|---|---|
| `candidate` | Job seeker / service applicant | Apply once, upload documents once, see honest status |
| `employer` | Client company contact | Post a requirement, review shortlisted candidates, track placements |
| `consultant` | Golden Eagle recruiter | Own a pipeline, move candidates through stages, talk to both sides |
| `case_officer` | Golden Eagle government-services staff | Own a government-services case, track document and submission state |
| `manager` | Golden Eagle operations lead | See all pipelines and cases, reassign, approve exceptions |
| `admin` | System owner | Users, roles, service catalogue, audit log, configuration |

Design notes: `candidate` and `employer` are external and untrusted — they see only their
own records. `consultant` and `case_officer` see only assigned records. `manager` sees the
whole tenant. `admin` is operational, and critically **`admin` must not be able to read
candidate documents silently** — any such read is logged and attributable. That is a
deliberate privacy control, not an oversight.

**DECISION REQUIRED #5:** Confirm the role list. In particular: do employers get direct
portal access in v1, or does a consultant mediate everything? This materially changes scope.

---

## 4. Main user journeys

**RECOMMENDED.** Five journeys for v1:

1. **Candidate applies.** Lands on a role or service → one short form (identity + contact +
   the role) → account created → uploads required documents → sees a status timeline. No
   dead ends: every state tells them what happens next and who holds the ball.
2. **Employer raises a requirement.** Signs in → describes the requirement → sees it
   acknowledged with a named owner → receives a shortlist → accepts or rejects each
   candidate with a reason.
3. **Consultant runs a pipeline.** Sees assigned requirements → searches candidates →
   shortlists → moves candidates through defined stages → every stage change is audited.
4. **Case officer runs a government-services case.** Opens a case against a service type →
   sees the required document checklist → chases missing or expiring documents → records
   submission and outcome.
5. **Manager reviews.** Sees pipeline and case state across the organisation → spots stalled
   records → reassigns.

**DECISION REQUIRED #6: The actual pipeline stages.** Stage names and transition rules are
business rules. I will not invent them. Please supply the real recruitment stages and the
real government-services case stages, or confirm I should propose a draft for you to correct.

---

## 5. MVP scope

**RECOMMENDED.** Smallest release that is genuinely useful:

- Email + password authentication, verified email, password reset, session management
- Role-based access control across the six roles
- Candidate profile and document upload with virus scanning and type/size validation
- Requirement (job) records, owned by an employer, assigned to a consultant
- Application records joining candidate to requirement, with audited stage transitions
- Government-services case records with a document checklist per service type
- Document expiry tracking with notification before expiry
- Admin dashboard: users, roles, service catalogue, audit log
- Bilingual UI (English + Arabic) with full RTL
- Transactional email notifications
- Full audit log of every sensitive action
- Loading / empty / success / error state for every action
- Keyboard-accessible throughout, WCAG 2.2 AA target

---

## 6. Explicitly excluded from MVP

Stated plainly so that "not built" is never mistaken for "broken":

- Payments and invoicing — **no payment integration in v1**
- Public job board SEO pages (these stay in WordPress under option B)
- CV parsing / AI matching / scoring
- Native mobile apps (the web app is mobile-first and installable instead)
- In-app chat or messaging (email only in v1)
- Multi-tenancy for other agencies — single organisation only
- Reporting and BI dashboards beyond simple counts
- E-signature
- Any government API integration (see DECISION REQUIRED #10)
- SMS and WhatsApp notifications

---

## 7. Data model

**RECOMMENDED** structure. This is architecture, not business data — no records, names,
prices or legal terms are invented here.

```
organisation        id, legal_name*, country*, created_at
user                id, email(unique), password_hash, email_verified_at, locale,
                    timezone, status, created_at, last_login_at
role                id, key, name                      -- the six roles in §3
user_role           user_id, role_id                   -- many-to-many
candidate_profile   id, user_id(unique), full_name, nationality, dob, phone_e164,
                    current_country, headline, created_at, updated_at
employer            id, name*, country*, primary_contact_user_id, status
requirement         id, employer_id, title, description, country, headcount,
                    status, owner_user_id(consultant), created_at, closed_at
application         id, requirement_id, candidate_profile_id, stage, stage_changed_at,
                    owner_user_id, rejection_reason, created_at
service_type        id, key, name_en, name_ar, description_en, description_ar, active
service_case        id, service_type_id, candidate_profile_id, status,
                    owner_user_id(case_officer), opened_at, closed_at, outcome
document_requirement  id, service_type_id, doc_type, mandatory, requires_expiry
document            id, owner_type, owner_id, doc_type, storage_key, mime, bytes,
                    checksum_sha256, issued_on, expires_on, scan_status,
                    uploaded_by_user_id, created_at
notification        id, user_id, channel, template_key, payload_json, sent_at, read_at
audit_log           id, actor_user_id, actor_ip, action, subject_type, subject_id,
                    before_json, after_json, created_at        -- append-only
session             id, user_id, token_hash, ip, user_agent, expires_at, revoked_at
```

`*` = field whose **content** is company/legal fact you must supply; the column is structure.

Three deliberate design decisions:

- `audit_log` is **append-only**. No update or delete path exists in application code. This
  is what makes compliance evidence trustworthy rather than reconstructed.
- `document` stores a `checksum_sha256` and a `scan_status`. A document is not visible to any
  consumer until `scan_status = clean`. An unscanned upload is never served.
- `document.storage_key` points at private object storage. **No document is ever served from
  a public URL** — every read is authorised, time-limited, and logged.

---

## 8. Required pages / screens

**Public:** sign in · register · verify email · forgot password · reset password · legal
pages (**content DECISION REQUIRED**) · 404 / 500.

**Candidate:** dashboard (status timeline) · my profile · my documents · apply to
requirement · my applications · my cases · account settings.

**Employer:** dashboard · my requirements · create requirement · requirement detail with
shortlist · accept/reject candidate · account settings.

**Consultant:** work queue · requirement detail · candidate search · candidate detail ·
shortlist builder · application detail with stage control.

**Case officer:** case queue · case detail with document checklist · document review.

**Manager:** organisation overview · all requirements · all cases · reassignment.

**Admin:** users · roles · service types & document requirements · audit log viewer ·
notification templates · system settings.

Every screen specifies four states: loading, empty, success, error. Per your rule 7, a
success state renders **only** after the server confirms the write.

---

## 9. Admin dashboard requirements

- User management: invite, suspend, reactivate, force password reset, assign/revoke roles
- Service catalogue: create and edit service types and their document requirements,
  bilingual labels — **the catalogue contents are DECISION REQUIRED #7**
- Audit log viewer: filter by actor, action, subject, date range; export; no edit, no delete
- Notification templates: editable bilingual subject and body
- No vanity metrics. No fabricated statistics. Counts shown are counted from the database at
  request time, or not shown at all.

---

## 10. Security and privacy requirements

- Argon2id password hashing; minimum length enforced; breached-password rejection
- Server-side session tokens, stored hashed, revocable; idle and absolute timeout
- RBAC enforced **server-side on every request**. Client-side role checks are presentation
  only and are never trusted.
- CSRF protection on all state-changing requests
- Rate limiting on authentication, password reset, upload, and search endpoints
- Secure headers: HSTS, CSP, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, frame denial
- Input validated against a schema on the server; output escaped by default
- Uploads: allow-list of MIME types, size cap, magic-byte verification, antivirus scan,
  stored outside the web root in private object storage, served only via short-lived
  authorised URLs
- Safe error handling: no stack traces, SQL, or internal paths ever reach a client response
- All secrets in environment variables. No credential, API key, or private URL in the
  repository — verified by an automated secret scan in the quality gate.
- Audit log for every sensitive action: sign-in, failed sign-in, role change, document
  read/upload/delete, stage transition, case outcome, export
- Data minimisation: the forms collect only fields the workflow actually consumes, per your
  architect skill's forms rule
- **DECISION REQUIRED #8: Data residency and applicable privacy law.** Where must personal
  data physically live, and which regime governs it (GDPR, Saudi PDPL, UAE PDPL, other)? This
  decides the hosting region and the retention rules, and it cannot be retrofitted cheaply.
- **DECISION REQUIRED #9: Retention periods.** How long do you keep candidate data after a
  closed application? This is a legal answer, not a technical one.

---

## 11. Internationalisation, locale, date/time, currency, RTL

- **Languages:** English and Arabic in v1 — **GROUNDED**, since your QA skill mandates RTL
  verification. **DECISION REQUIRED #11: any further languages?**
- **Direction:** full LTR and RTL. Logical CSS properties throughout
  (`margin-inline-start`, not `margin-left`), so direction is a document attribute rather
  than a second stylesheet.
- **Dates and times:** every timestamp stored in UTC. Rendered in the viewing user's
  timezone, with the timezone shown explicitly on anything legally meaningful (an expiry
  date, a submission time).
- **Numbers and names:** Arabic-Indic numeral rendering follows locale; person and company
  names are stored as Unicode and never transliterated automatically.
- **Currency:** no currency is displayed in v1, because payments are out of scope. If a fee
  must be shown, the amount and currency are company data — **DECISION REQUIRED**, and I will
  store minor units as integers, never floats.
- **Translation:** no machine-translated UI copy ships. Arabic strings are either supplied by
  you or flagged untranslated. I will not fabricate Arabic legal or service wording.

---

## 12. Recommended technology stack

Conditional on the answer to **DECISION REQUIRED #1**.

**If option B or A — RECOMMENDED:**

| Layer | Choice | Reason |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | One language across client and server; server-side rendering protects first-load speed on GCC mobile networks; mature i18n routing for `en`/`ar` with RTL |
| Database | PostgreSQL | Relational integrity is the whole point of this data model; row-level constraints; append-only audit log is natural |
| Access layer | Prisma | Typed schema, real migration history, reviewable diffs |
| Auth | Own session-based implementation on Argon2id | No third-party auth dependency, no per-user cost, no data residency surprise. More code than a SaaS, but it is code you own and can host anywhere §10 requires. |
| Files | S3-compatible private object storage | Private by default; pre-signed short-lived reads; region-pinnable for residency |
| Email | Provider-agnostic adapter behind one interface | **DECISION REQUIRED #12: which email provider?** The adapter means this choice is reversible. |
| Validation | Zod schemas shared by client and server | One schema, two enforcement points; server is authoritative |
| Styling | Tailwind CSS with design tokens | Tokens hold Gold + Navy; logical properties give RTL for free |
| Testing | Vitest (unit) · Playwright (end-to-end, incl. keyboard and RTL) | Real browser testing of the critical flows, as your quality gates demand |
| Hosting | **DECISION REQUIRED #13** — must satisfy §10 residency | |

Deliberately **not** chosen, and why: no component library with an opinionated look (it would
fight the luxury identity); no GraphQL (one client, no need, adds cache complexity); no
microservices (one team, one domain — distribution would be pure cost); no Redis in v1
(Postgres handles the load at this scale; adding it later is easy, removing it is not).

**If option C** — the stack is WordPress + ACF + Elementor, PHP, following WordPress coding
standards, CPTs for the entities in §7, and capability checks plus nonces on every action, as
your QA skill requires. I would then build this as a single purpose-built plugin, never as
theme functions, so that it is deactivatable — which is also its rollback.

---

## 13. Risks, decisions, and information still required

### Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Personal document store is a high-value breach target | Severe — legal, reputational | Private storage, authorised short-lived reads, audit every read, encryption at rest, least-privilege roles, no silent admin access |
| Wrong data residency decision | Severe — possible unlawful processing, forced migration | Resolve DECISION REQUIRED #8 **before** provisioning any infrastructure |
| Arabic/RTL treated as a late port | High — the premium identity collapses in RTL | RTL in the first milestone, logical properties only, RTL in the automated end-to-end suite |
| Invented business rules | High — rework, lost trust | Every stage name, service type and legal string gated behind a DECISION REQUIRED marker |
| Scope conflict with the "never rewrite" principle | High — wasted cycle | Resolved by DECISION REQUIRED #1 before Phase 1 |
| Document expiry notifications fail silently | Medium — compliance exposure | Notification send recorded in the database; failures retried and surfaced in the admin dashboard, never swallowed |
| Self-built authentication | Medium | Narrow, well-understood surface; Argon2id; rate limiting; tests for every negative path; security review gate each milestone |

### Decisions I have made (and will own)

1. Append-only audit log, no application delete path.
2. No document served from a public URL, ever.
3. Server-side authorisation on every request; client role checks are cosmetic.
4. UTC storage, local rendering, explicit timezone on legally meaningful times.
5. No machine-translated Arabic ships.
6. No fabricated statistics anywhere in the UI.
7. Email provider behind an adapter, so that choice stays reversible.

### Information still required — the full blocking list

| # | Question | Blocks |
|---|---|---|
| 1 | Greenfield replacement (A), adjacent product (B), or WordPress extension (C)? | Everything |
| 2 | Target repository for application code | Phase 2 |
| 3 | Confirm / correct the problem statement in §2 | Everything |
| 4 | Application name | Brand, Phase 1 |
| 5 | Confirm roles; do employers self-serve in v1? | Scope, schema |
| 6 | Real recruitment stages and real case stages | Core workflow |
| 7 | Government-services catalogue + document checklist per service | Core workflow |
| 8 | Data residency + governing privacy law | Hosting, schema, retention |
| 9 | Retention periods after case/application closure | Schema, jobs |
| 10 | Any government API integration in scope? | Architecture |
| 11 | Languages beyond English + Arabic | i18n |
| 12 | Email provider | Notifications |
| 13 | Hosting target and domain | Deployment |
| 14 | Brand assets: logo files, exact Gold and Navy hex values, licensed typefaces | Design system |
| 15 | Approved legal content: privacy policy, terms, cookie notice | Public pages |

Items 1, 3, 6, 7 and 8 are the true blockers. The other ten I can sequence around.

---

## 14. What happens next

Per your collaboration rule, I stop here and wait.

- **If you approve this document**, Phase 1 delivers: system architecture, database schema,
  API contract, auth design, file-storage design, error-handling strategy, audit-logging
  strategy, admin structure, page-by-page wireframe plan, design system (typography, spacing,
  colour, states, components), responsive behaviour for desktop/tablet/mobile, accessibility
  plan, test plan, and deployment + rollback plan. Then I stop again.
- **The fastest path:** answer items 1, 3, 6, 7 and 8. With those five I can write a Phase 1
  that is real rather than hedged.
- **If you would rather I propose drafts** for items 6 and 7 (stages and service catalogue)
  for you to correct, say so and I will — clearly labelled as proposals, never as fact.

No production code will be written before your approval.
