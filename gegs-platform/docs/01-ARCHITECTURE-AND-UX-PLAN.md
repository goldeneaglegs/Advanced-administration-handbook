# Phase 1 — Architecture and UX Plan (DRAFT FOR APPROVAL)

**Status:** Draft. Not approved. No production code written.
**Date:** 2026-10-06
**Depends on:** `00-PRODUCT-DEFINITION.md` §0a decisions — adjacent product, new repository,
GCC data residency, drafted business rules for client correction.

Labels carry the same meaning as in Phase 0: **GROUNDED** (from your approved material),
**RECOMMENDED** (my call, yours to reject), **DECISION REQUIRED** (business, legal or brand
fact I will not invent), **PROPOSAL** (a draft you asked me to write for you to correct).

---

## 1. System architecture

### 1.1 Topology

GCC residency is a hard constraint, so the architecture is a small number of long-lived
services in one Gulf region rather than a globally distributed edge deployment. This is a
genuine trade-off: we give up edge latency to keep every byte of personal data in-region.
For a product whose users are in the Gulf, that costs almost nothing and buys lawfulness.

```
                    Public internet
                          |
          +---------------+----------------+
          |                                |
   WordPress site                    CDN / WAF
   (existing, unchanged)             TLS termination, rate limit,
   marketing, SEO, content           bot filtering
   ONE outbound link  ------------->        |
   "Client & candidate portal"              |
                                   +--------+--------+
                                   |  Application    |   Next.js (SSR + route handlers)
                                   |  container x2+  |   stateless, autoscaled
                                   +--------+--------+
                                            |
                 +--------------------------+--------------------------+
                 |              |                       |             |
          +------+-----+  +-----+------+        +-------+------+  +---+--------+
          | PostgreSQL |  | Object     |        | Antivirus    |  | Email      |
          | primary    |  | storage    |        | scan worker  |  | adapter    |
          | + standby  |  | PRIVATE    |        | (quarantine  |  | (provider  |
          | in-region  |  | in-region  |        |  -> clean)   |  |  behind    |
          +------------+  +------------+        +--------------+  |  interface)|
                 |                                               +------------+
          +------+-----+
          | Scheduled  |   document expiry sweep, notification retry,
          | job runner |   session cleanup, audit log integrity check
          +------------+
```

**RECOMMENDED region and services:** a Gulf region of a major cloud (AWS `me-central-1`
UAE or `me-south-1` Bahrain; Azure UAE North; Google Cloud `me-central2` Dammam). Managed
PostgreSQL with a standby, S3-compatible private object storage, containers on a managed
runtime, managed CDN/WAF in front.

**Phase 2 pre-flight check, not an assumption:** before provisioning anything I will verify
that every service above is actually offered in the chosen region, and that the managed email
service is too. Regional service coverage in the Gulf is uneven and changes; I will confirm
it against the provider's live region table rather than assert it from memory.

**DECISION REQUIRED #13a:** which cloud account, and which of those regions. If you have an
existing hosting relationship, that probably wins on operational grounds alone.

### 1.2 The WordPress boundary

This is the architectural heart of option B, so it is stated as a rule rather than a diagram:

1. The application serves **no public, indexed URL**. Every route requires a session except
   sign-in, registration, email verification, password reset, and legal pages.
2. The application sends `X-Robots-Tag: noindex, nofollow` on every response and ships a
   `robots.txt` disallowing everything. Your WordPress SEO, schema and breadcrumbs cannot be
   affected by anything the app does, because the app is invisible to crawlers.
3. WordPress links **into** the app. The app never writes to WordPress, never shares its
   database, and never requires a WordPress plugin. Zero coupling, by design.
4. **Rollback is removing that one link.** No migration to unwind, no DNS change, no data
   to restore. Phase 0's rollback promise is kept by this rule and no other mechanism.

**RECOMMENDED hostname:** a dedicated subdomain (for example `portal.<your-domain>`) rather
than a path on the main site. A separate origin means separate cookies, a separate CSP, and a
compromise of one cannot read the other's session. A path-based deployment would share the
origin and throw that isolation away.

### 1.3 Why not serverless functions per route

Considered and rejected for v1: per-request cold starts hurt a form-heavy workflow app; the
antivirus scanner and the expiry sweep are long-running and fit badly in a function timeout;
and connection pooling against PostgreSQL from many short-lived functions needs a proxy,
which is a component added purely to work around the choice. Two long-lived containers are
simpler, cheaper at this scale, and easier to reason about during an incident.

---

## 2. Database schema

PostgreSQL. Phase 0 §7 named the entities; this is the executable shape. Migrations are
forward-only and reviewed; **no migration runs against production without an approved
rollback step beside it** (§14).

### 2.1 Conventions

- Primary keys are UUIDv7 — time-ordered, so they index well, but not sequential, so a
  candidate cannot guess another candidate's record id from their own.
- `created_at` / `updated_at` are `timestamptz`, always UTC. The database is never asked to
  know about a user's timezone; that is a rendering concern (§11).
- Soft delete (`deleted_at`) on records a user can remove. Hard delete only via the retention
  job, which is gated on **DECISION REQUIRED #9**.
- Money, if it ever appears, is `bigint` minor units plus an ISO-4217 code. Never a float.
- Every foreign key is declared with an explicit `ON DELETE` rule. No orphan rows.
- Enumerations that are **business rules** (stages, statuses you may correct) live in tables,
  not PostgreSQL enum types, so changing them is an admin edit and not a migration.
  Enumerations that are **system facts** (`scan_status`, `channel`) are native enums.

### 2.2 Tables

```sql
-- Identity -----------------------------------------------------------------
organisation      id, legal_name, country_code, created_at
users             id, email citext UNIQUE, password_hash, email_verified_at,
                  locale, timezone, status, failed_login_count, locked_until,
                  password_changed_at, created_at, last_login_at, deleted_at
roles             id, key UNIQUE, name_en, name_ar
user_roles        user_id FK, role_id FK, granted_by FK users, granted_at
                  PRIMARY KEY (user_id, role_id)
sessions          id, user_id FK, token_hash, ip inet, user_agent,
                  created_at, last_seen_at, expires_at, revoked_at
email_tokens      id, user_id FK, purpose, token_hash, expires_at, consumed_at

-- Parties ------------------------------------------------------------------
candidate_profiles  id, user_id FK UNIQUE, full_name, nationality_code, dob,
                    phone_e164, current_country_code, headline,
                    created_at, updated_at, deleted_at
employers           id, name, country_code, status, created_at, deleted_at
employer_contacts   employer_id FK, user_id FK, is_primary
                    PRIMARY KEY (employer_id, user_id)

-- Recruitment --------------------------------------------------------------
requirements      id, employer_id FK, title, description, country_code,
                  headcount, status, owner_user_id FK, created_at, closed_at
pipeline_stages   id, key UNIQUE, name_en, name_ar, sort_order,
                  is_terminal, is_success, active          -- seeded, editable
applications      id, requirement_id FK, candidate_profile_id FK,
                  stage_id FK, stage_changed_at, owner_user_id FK,
                  outcome_reason, created_at
                  UNIQUE (requirement_id, candidate_profile_id)
application_stage_history  id, application_id FK, from_stage_id, to_stage_id,
                  changed_by_user_id FK, reason, changed_at

-- Government services ------------------------------------------------------
service_types     id, key UNIQUE, name_en, name_ar, description_en,
                  description_ar, active, sort_order              -- seeded, editable
case_stages       id, service_type_id FK NULL, key, name_en, name_ar,
                  sort_order, is_terminal, active                 -- seeded, editable
service_cases     id, service_type_id FK, candidate_profile_id FK,
                  stage_id FK, stage_changed_at, owner_user_id FK,
                  reference, opened_at, closed_at, outcome
case_stage_history  id, case_id FK, from_stage_id, to_stage_id,
                  changed_by_user_id FK, reason, changed_at

-- Documents ----------------------------------------------------------------
document_types    id, key UNIQUE, name_en, name_ar, requires_expiry, active
document_requirements  id, service_type_id FK, document_type_id FK, mandatory
documents         id, owner_type, owner_id, document_type_id FK,
                  storage_key, mime, bytes, checksum_sha256,
                  issued_on, expires_on,
                  scan_status scan_status_enum,     -- pending|clean|infected|error
                  uploaded_by_user_id FK, created_at, deleted_at
document_access_log  id, document_id FK, actor_user_id FK, actor_ip inet,
                  action, created_at                 -- every read, append-only

-- Platform -----------------------------------------------------------------
notifications     id, user_id FK, channel, template_key, payload_json,
                  queued_at, sent_at, failed_at, failure_reason, attempts, read_at
notification_templates  id, template_key UNIQUE, subject_en, subject_ar,
                  body_en, body_ar, updated_by FK, updated_at
audit_log         id, actor_user_id FK NULL, actor_ip inet, action,
                  subject_type, subject_id, before_json, after_json,
                  request_id, created_at             -- append-only
```

### 2.3 Enforced invariants

Not comments in code — database constraints, so they hold even if application code has a bug:

- `UNIQUE (requirement_id, candidate_profile_id)` — a candidate cannot be submitted twice to
  the same requirement. Duplicate submission is a real and embarrassing failure in this
  industry; the database refuses it.
- `CHECK (expires_on IS NULL OR expires_on > issued_on)` on `documents`.
- `CHECK (document_type.requires_expiry = false OR expires_on IS NOT NULL)` enforced at the
  application boundary and asserted by test, since it spans two tables.
- `audit_log` and `document_access_log`: the application's database role is granted `INSERT`
  and `SELECT` only. **No `UPDATE` or `DELETE` grant exists.** Tamper-resistance is a
  privilege, not a promise.
- Partial index `WHERE deleted_at IS NULL` on every soft-deleted table's lookup columns.
- Index on `documents (expires_on) WHERE deleted_at IS NULL AND expires_on IS NOT NULL` — the
  expiry sweep is the one query guaranteed to run daily forever.

### 2.4 PROPOSAL — recruitment pipeline stages

You asked me to draft these for your correction. **These are my proposal, not your process.**
Seeded as editable rows in `pipeline_stages`.

| # | key | English | Arabic | Terminal | Success |
|---|---|---|---|---|---|
| 1 | `applied` | Applied | تم التقديم | no | – |
| 2 | `screening` | Screening | الفرز الأولي | no | – |
| 3 | `shortlisted` | Shortlisted | القائمة المختصرة | no | – |
| 4 | `client_review` | With client | قيد مراجعة العميل | no | – |
| 5 | `interview` | Interview | المقابلة | no | – |
| 6 | `offer` | Offer | العرض | no | – |
| 7 | `documents` | Documents & clearance | المستندات والتخليص | no | – |
| 8 | `deployed` | Deployed | تم الالتحاق | **yes** | **yes** |
| 9 | `withdrawn` | Withdrawn by candidate | انسحب المرشح | **yes** | no |
| 10 | `rejected` | Not selected | لم يتم الاختيار | **yes** | no |

Transition rule **PROPOSAL**: forward one step, or to any terminal stage, or back one step
with a recorded reason. Arbitrary jumps are refused. Every transition writes
`application_stage_history` and `audit_log`. The Arabic above is my translation and is
**marked for your review** — per Phase 0 §11 no machine-translated string ships unreviewed.

### 2.5 PROPOSAL — government services catalogue

**This is a structural placeholder, deliberately thin.** I know the *shape* of GCC
government-services work but not your licensed scope, so inventing a catalogue here would be
exactly the fabrication Phase 0 forbids. What I am proposing is the mechanism:

- `service_types` holds your catalogue, one row per service you are licensed to perform.
- `document_requirements` holds the checklist per service, with `mandatory` per row.
- `case_stages` can be global (`service_type_id IS NULL`) or per-service, so one unusual
  service does not force its stages on the rest.

A deliberately minimal starting `case_stages` set, global: `opened` → `documents_pending` →
`submitted` → `in_process` → `completed` (terminal) / `cancelled` (terminal).

**DECISION REQUIRED #7:** your actual service list, and the document checklist for each. Give
me this as a plain list and I will seed it. Until then the catalogue ships **empty**, and the
admin screen for it is the first thing you will use.

---

## 3. API contract

### 3.1 Shape

Next.js route handlers under `/api`, JSON over HTTPS. Not REST orthodoxy for its own sake —
resource-shaped where that is natural, action-shaped where the operation is a business verb
(advancing a stage is not a `PATCH`, it is a transition with its own rules and its own audit
record).

Every request carries a `request_id`, which appears in the audit log, the server log, and the
error shown to the user. When a user reports a problem, that one string finds everything.

### 3.2 Envelope

Success:
```json
{ "data": { ... }, "meta": { "request_id": "01JA...", "page": { "cursor": "...", "has_more": true } } }
```

Failure — one shape, always:
```json
{ "error": { "code": "VALIDATION_FAILED",
             "message": "Check the highlighted fields.",
             "fields": { "phone_e164": "Enter a phone number with country code." },
             "request_id": "01JA..." } }
```

`code` is for the client to branch on. `message` is for a human and is localised. `fields` maps
to form inputs so the UI can attach each error to its own input, which is what makes the form
usable with a screen reader (§13). **No stack trace, SQL fragment, internal path, or table name
ever appears in this envelope** — Phase 0 §10.

### 3.3 Endpoints

```
POST   /api/auth/register                 create account (candidate self-serve only)
POST   /api/auth/verify-email             consume token
POST   /api/auth/login                    -> session cookie
POST   /api/auth/logout
POST   /api/auth/forgot-password          always 202, never reveals existence
POST   /api/auth/reset-password
GET    /api/me                            session user + roles + locale

GET    /api/candidate/profile             own profile
PUT    /api/candidate/profile
GET    /api/candidate/applications
GET    /api/candidate/cases
GET    /api/candidate/documents
POST   /api/documents/upload-intent       -> { upload_url, document_id }   (§5)
POST   /api/documents/:id/complete        confirm upload, queue scan
GET    /api/documents/:id/download        -> 302 to short-lived signed URL, logged
DELETE /api/documents/:id

GET    /api/employers/:id/requirements
POST   /api/requirements
GET    /api/requirements/:id
PATCH  /api/requirements/:id
GET    /api/requirements/:id/applications

POST   /api/applications                             shortlist a candidate
GET    /api/applications/:id
POST   /api/applications/:id/transition              { to_stage, reason? }
GET    /api/applications/:id/history

GET    /api/cases
POST   /api/cases
GET    /api/cases/:id
POST   /api/cases/:id/transition
GET    /api/cases/:id/checklist                      requirement vs uploaded, per service

GET    /api/admin/users           POST /api/admin/users/:id/roles
PATCH  /api/admin/users/:id/status
GET    /api/admin/service-types   POST|PATCH /api/admin/service-types[/:id]
GET    /api/admin/document-types  POST|PATCH /api/admin/document-types[/:id]
GET    /api/admin/pipeline-stages PATCH /api/admin/pipeline-stages/:id
GET    /api/admin/templates       PATCH /api/admin/templates/:key
GET    /api/admin/audit-log       filter + cursor paginate, export CSV
```

### 3.4 Rules that apply to every endpoint

- **Authorisation is resolved server-side, per request, from the session** — never from a
  request body, header, or client claim. Phase 0 §10.
- Pagination is **cursor-based**, never `OFFSET`. Offset pagination silently skips and
  duplicates rows while another user is writing, which in a work queue means a candidate
  disappears from a consultant's list. Cursors do not have that failure.
- Mutations are idempotent where a retry is plausible: `upload-intent` and `transition`
  accept an `Idempotency-Key`, so a double-tap on a slow mobile connection cannot create two
  records or two audit entries.
- List endpoints are scoped by role in the query itself, not filtered after fetching. A
  candidate's query is `WHERE candidate_profile_id = <own>`; there is no code path that loads
  all rows and then hides some.

---

## 4. Authentication and authorisation

### 4.1 Authentication

- **Argon2id**, tuned to ~250 ms on the production container. Parameters recorded in the
  repository so a future cost increase is a deliberate, reviewed change.
- Minimum 12 characters, checked against a breached-password corpus. No composition rules —
  they push users toward `Password1!` and measurably weaken outcomes.
- **Opaque server-side sessions** in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Only the
  SHA-256 of the token is stored, so a database leak does not hand over live sessions.
  Not JWT: a workflow app must be able to revoke a session *now* — when a consultant leaves,
  when a device is lost. A stateless token cannot be revoked, only expired.
- Idle timeout 8 hours, absolute 30 days. Session rotated on privilege change.
- Login throttling per account **and** per IP, with `locked_until`. Both axes, because
  per-IP alone is defeated by a botnet and per-account alone lets one IP spray many accounts.
- `forgot-password` returns `202` whether or not the address exists. Enumeration of your
  candidate list is not available through this endpoint.
- Email verification required before any document upload.
- **RECOMMENDED for a later milestone, not v1:** TOTP second factor, mandatory for
  `manager` and `admin`. v1 ships without it; that is a stated limitation, not an oversight.
  **DECISION REQUIRED:** if staff handle identity documents from day one, you may want this
  in v1 — it is roughly one milestone of work.

### 4.2 Authorisation

A single server-side policy layer. Every handler's first statement is a policy call; there is
no second way to reach data.

```
can(actor, action, subject) -> allow | deny
```

Resolution order, deny by default:

1. Is the actor's session valid and their account active? No → 401.
2. Does any of the actor's roles grant `action`? No → 403.
3. For a record-scoped action, does the actor **reach** this record?
   - `candidate` → only records where they are the candidate.
   - `employer` → only records belonging to their employer.
   - `consultant` / `case_officer` → only records where they are `owner_user_id`.
   - `manager` → all records in the organisation.
   - `admin` → users, configuration and the audit log. **Not candidate documents.**
4. Is the state transition legal from the current stage (§2.4)? No → 409.

**The admin exception, stated plainly.** `admin` manages the system; it does not get silent
access to people's passports. If an admin genuinely must read a document, that read goes
through the same `/api/documents/:id/download` path, is written to `document_access_log` with
their identity, and is visible in the audit log. Privileged access that is logged and
attributable is the control; privileged access that is invisible is the risk.

**Not found vs forbidden:** a request for a record the actor cannot reach returns **404**, not
403. A 403 confirms the record exists, which leaks the size and shape of your candidate base.

---

## 5. File upload and storage

The highest-risk component in the product. Phase 0 §13 names it as such.

### 5.1 Flow

```
1. Client: POST /api/documents/upload-intent  { document_type_id, owner, mime, bytes }
   Server: authorise -> validate type against allow-list and size cap
           -> create `documents` row, scan_status = pending
           -> return a short-lived (5 min) pre-signed PUT URL, one object key, one use
2. Client: PUT file directly to private object storage. Never through the app container.
3. Client: POST /api/documents/:id/complete
   Server: read the object's real bytes -> verify magic bytes match the declared MIME
           -> compute sha256 -> store checksum and true size -> enqueue scan
4. Worker: antivirus scan -> scan_status = clean | infected | error
           infected -> object deleted, uploader notified, audit entry written
5. Read:   GET /api/documents/:id/download
           authorise -> require scan_status = 'clean'
           -> write document_access_log -> 302 to a 60-second signed URL
```

### 5.2 Rules

- The bucket is **private**. No public read policy, no public ACL, ever. Enforced by
  infrastructure configuration and asserted by a test that fails the build if a public grant
  appears.
- **Magic bytes decide the type, not the filename and not the client's `Content-Type`.** A
  file named `cv.pdf` that begins with `<?php` is rejected at step 3.
- Allow-list only: PDF, JPEG, PNG, and (**DECISION REQUIRED**) optionally DOCX. Size cap
  **RECOMMENDED** 10 MB per file. Everything else refused with a message naming what is
  accepted.
- Object keys are random UUIDs with no original filename and no extension. The display name
  lives in the database. A leaked key reveals nothing, and a crafted filename cannot traverse
  a path.
- **Nothing is readable until `scan_status = 'clean'`.** The candidate sees "Checking your
  file"; no other role sees the document at all.
- Storage encrypted at rest; TLS in transit; bucket pinned to the GCC region (§1.1).
- Deleting a document soft-deletes the row and deletes the object. The
  `document_access_log` entries survive — you must still be able to prove who read a document
  that has since been removed.
- Uploads are **not** proxied through the application container. Streaming 10 MB files through
  the app would make upload traffic compete with every other request; direct-to-storage keeps
  the app responsive and removes an entire class of memory-exhaustion failure.

---

## 6. Error handling

### 6.1 Four classes, four behaviours

| Class | Example | HTTP | User sees | Logged |
|---|---|---|---|---|
| Validation | Missing field, bad phone | 400 | Message attached to the specific input | No |
| Authorisation | Not your record | 404 / 403 | "You don't have access to this." | Yes, with actor |
| Conflict | Illegal stage transition, stale edit | 409 | What changed, and the current state | Yes |
| Unexpected | Database down, bug | 500 | "Something went wrong. Reference `01JA…`" | Yes, full detail server-side |

### 6.2 Rules

- **A success state renders only after the server confirms the write.** No optimistic UI on
  any audited action. If a consultant's screen says "Moved to Interview", the row moved.
  This is Phase 0 implementation rule 7 and it is not negotiable for a compliance product.
- Every unexpected error returns a `request_id` that the user can quote. Support stops being
  archaeology.
- Errors do not apologise and are never vague. They name what happened and what to do next —
  per the design skill's guidance on failure as direction.
- A failed background job (scan, email) is recorded with its failure reason, retried with
  backoff, and **surfaced in the admin dashboard**. A silently swallowed notification failure
  is a compliance exposure, which is why Phase 0 §13 lists it as a named risk.
- Concurrent edits use an optimistic `updated_at` check. Second writer gets a 409 telling
  them what changed, rather than silently overwriting a colleague's work.

---

## 7. Audit logging

### 7.1 What is logged

Every one of these writes an `audit_log` row: sign-in, failed sign-in, sign-out, password
change, password reset, role grant or revoke, user status change, document upload, document
read, document delete, application created, stage transition, case created, case transition,
case outcome, service-catalogue change, notification-template change, any data export.

### 7.2 How

- Written **in the same database transaction as the change itself**. The audit entry and the
  change commit together or neither does. An audit log that can be out of step with reality
  is worse than none, because it is trusted.
- `before_json` / `after_json` hold the changed fields only — not whole rows. A diff is
  readable; a snapshot pair is not, and storing whole rows duplicates personal data into a
  table that is never deleted.
- The application's database role has **no `UPDATE` or `DELETE` grant** on this table (§2.3).
- Personal data minimisation: the log records *that* document X was read by actor Y, never the
  document's contents.
- Retention: the audit log is **exempt from the §9 retention sweep** and kept for the
  statutory period. **DECISION REQUIRED #9a:** what is that period under the applicable GCC
  regime?
- Daily integrity check: the job runner verifies the id sequence has no gap and reports
  anomalies. A gap means something reached the table outside the application.

---

## 8. Admin dashboard structure

Eight sections, flat. No nesting deeper than two levels — an admin hunting for a setting
during an incident should not be navigating a tree.

```
Users          list, filter by role and status, invite, suspend, reassign roles,
               force password reset.  Never shows a password, never a document.
Roles          the six roles and their permissions, read-only in v1.
               Editable permissions is a v2 feature; a misconfigured role is a breach.
Service types  your catalogue (§2.5). Create, edit bilingual labels, activate,
               deactivate. Deactivate, never delete — existing cases reference it.
Document types create, edit, mark requires_expiry.
Checklists     document requirements per service type, mandatory per row.
Pipeline       stage labels and sort order (§2.4). Keys are immutable once used.
Templates      notification templates, bilingual, with a preview.
Audit log      filter by actor / action / subject / date. Export CSV.
               Read-only in the interface, because it is read-only in the database.
Operations     failed background jobs, pending scans, notification failures,
               documents expiring in the next 30/60/90 days.
```

**No vanity metrics anywhere.** Where a count appears it is counted at request time from the
database. Phase 0 §9 — and the Golden Eagle architect skill's rule against fabricated results.

---

## 9. Page-by-page wireframe plan

Mobile-first; the mobile layout is the primary design and the desktop layout is the
elaboration, not the reverse.

### Candidate dashboard — the most important screen in the product

This is where the product either earns trust or loses it. A candidate's real question is
always the same: *what is happening, and who is holding it up?* So the screen answers that
first and does nothing else above the fold.

```
MOBILE (360-767)                        DESKTOP (1024+)
+--------------------------+            +----------------------------------------------+
| [GE]      العربية  [≡]   |            | [GE] Golden Eagle      العربية   Ahmed [v]   |
+--------------------------+            +----------------------------------------------+
|                          |            |                                              |
| Your application         |            |  Your application                            |
| Senior Site Engineer     |            |  Senior Site Engineer · Doha                 |
|                          |            |                                              |
|  o Applied      12 Sep   |            |  o--o--o--*--o--o--o--o                      |
|  o Screening    19 Sep   |            |  Applied  Screen  Short  [With client]       |
|  * With client           |            |                                              |
|    since 2 Oct           |            |  With client since 2 October                 |
|    Golden Eagle is       |            |  Golden Eagle is waiting for the employer    |
|    waiting for the       |            |  to review your profile. Nothing is needed    |
|    employer to review.   |            |  from you right now.                          |
|    Nothing needed from   |            |                                              |
|    you right now.        |            +---------------------+------------------------+
|                          |            | Documents           | Need help?             |
+--------------------------+            | Passport    valid   | Your consultant        |
| Documents                |            | Photo       valid   | Fatima Al-...          |
| ! Passport expires in    |            | ! Passport expires  | Message                |
|   24 days      [Update]  |            |   in 24 days        |                        |
| v Photo        valid     |            |   [Update]          |                        |
+--------------------------+            +---------------------+------------------------+
```

Deliberate choices: the status timeline is **vertical on mobile**, because a horizontal
stepper at 360 px either truncates or shrinks labels below legibility. The current stage
states **who is holding the ball** in plain language — this is the single highest-value
sentence on the screen and the one most products omit. An expiring document is an action with
a button, not a red badge; a warning the user cannot act on is just anxiety.

### Consultant work queue — density without noise

```
DESKTOP
+--------------------------------------------------------------------------+
| My queue (14)            [ All stages v ] [ Search candidates     ]      |
+--------------------------------------------------------------------------+
| Candidate        Requirement            Stage        Waiting   Owner     |
| Ahmed H.         Senior Site Engineer   With client   4 days    me       |
| Priya N.         Senior Site Engineer   Interview     1 day     me       |
| Marcus O.        QA Inspector           Documents    11 days    me   (!) |
+--------------------------------------------------------------------------+
```

"Waiting" — days in the current stage — is the column that makes this screen useful, because
a stalled candidate is the actual failure mode of a recruitment pipeline. It is sortable and
it is the default sort, descending. The `(!)` marks a row past a stage-specific threshold.

On mobile this table becomes a list of cards; each card leads with candidate name and waiting
time, since those are the two fields a consultant scans for. **A horizontally scrolling table
is not an acceptable mobile treatment** and will not ship.

### Case detail — checklist as the spine

```
+--------------------------------------------------------------------------+
| Case GE-00042 · Work permit renewal        Stage: Documents pending      |
+--------------------------------------------------------------------------+
| Required documents                   3 of 5 received                     |
|  v  Passport copy        received · expires 14 Mar 2027                  |
|  v  Photograph           received                                        |
|  v  Employment contract  received                                        |
|  !  Medical certificate  not received        [ Request from candidate ]  |
|  !  Previous permit      not received        [ Request from candidate ]  |
+--------------------------------------------------------------------------+
| Advance stage  [ Submitted v ]                                           |
| Blocked: 2 mandatory documents are missing.                              |
+--------------------------------------------------------------------------+
```

The advance control is **visible but disabled**, with the reason stated beneath it. A hidden
control teaches nothing; a disabled control with a reason teaches the rule. The disabled
reason is in a live region so a screen-reader user hears why the action is unavailable.

Remaining screens follow Phase 0 §8 and these same patterns; I will not pad this document
with fourteen more ASCII sketches when the patterns above determine them.

---

## 10. Design system

**GROUNDED brand constraints** (architect skill): Gold + Navy identity. World Map concept.
Premium typography. Luxury, corporate, premium, minimal, elegant, professional. Motion with
purpose only. Evolution, not revolution.

The brief pins the colour direction, so I follow it exactly rather than spending that freedom
elsewhere. Where the brief leaves an axis free — type, spacing, surface treatment — I have
tried to make a choice specific to this product rather than a default.

### 10.1 Colour

**RECOMMENDED token values, pending DECISION REQUIRED #14 (your exact brand hex values).**
These are placeholders chosen to be *replaceable*: every colour is a token, used nowhere
literally, so substituting your real brand values is a one-file change.

```
--navy-900  #0B1A2F   page background (dark), primary text on light
--navy-700  #152A47   raised surface on dark
--navy-500  #2A4568   interactive borders on dark, muted headings
--gold-600  #A67F30   gold as a LINE or small mark on light: focus ring, active rule
--gold-500  #B8923F   primary button FILL (with navy-900 text, never white)
--gold-300  #D9BD7A   gold on dark backgrounds, focus ring on dark
--paper-50  #FBFAF8   page background (light)
--paper-200 #ECE8E1   decorative dividers ONLY
--line-500  #8B8172   input, control and table borders that convey a boundary
--ink-700   #3A4452   secondary text
--state: success #1F6B4A · warning #8A5A12 · danger #9B2C2C · info #1F4E6B
```

**Measured, not asserted.** I computed every pair rather than claiming compliance, and two of
my first choices failed — both are corrected above:

| Pair | Ratio | Requirement | Verdict |
|---|---|---|---|
| navy-900 on paper-50 (body) | 16.73 | 4.5 | pass |
| ink-700 on paper-50 (secondary) | 9.46 | 4.5 | pass |
| navy-900 on gold-500 (primary button) | 6.00 | 4.5 | pass |
| gold-600 on paper-50 (focus ring, light) | 3.53 | 3.0 non-text | pass |
| gold-300 on navy-900 (focus ring, dark) | 9.57 | 3.0 non-text | pass |
| line-500 on paper-50 (input border) | 3.67 | 3.0 non-text | pass |
| paper-50 on navy-900 (body, dark) | 16.73 | 4.5 | pass |
| success / warning / danger / info on paper-50 | 6.17 / 5.67 / 7.21 / 8.53 | 4.5 | pass |
| ~~paper-50 on gold-500 (white on gold)~~ | **2.79** | 4.5 | **FAILED — rejected** |
| ~~gold-500 as a line on paper-50~~ | **2.79** | 3.0 | **FAILED — rejected** |

The two failures matter and are worth naming, because both are the obvious thing to do with a
gold brand colour:

1. **White text on a gold button fails** at 2.79:1. The primary button is therefore gold fill
   with **navy-900 text** (6.00:1). This is also the better-looking option at the premium
   register, but it is here because it is the only one that is legible.
2. **Gold-500 as a 2 px focus ring on a light page fails** the 3:1 non-text requirement of
   WCAG 2.2 SC 1.4.11 at 2.79:1 — an invisible focus ring for low-vision keyboard users, in a
   product they must use to apply for work. The focus ring is therefore `--gold-600`
   (3.53:1), which is close enough in hue to read as the same brand gold.

A build-time test re-checks this whole table and fails on regression, so a future colour tweak
cannot quietly reintroduce either failure. **When your real brand hex values arrive
(DECISION REQUIRED #14), I will run exactly this check against them and report any pair that
fails rather than shipping it** — if your brand gold is lighter than #A67F30, the focus ring
will need a darker derived tone, and I will say so instead of quietly failing the standard.

Deliberate decisions:

- **Gold is reserved for action and position.** It marks the primary button (gold fill, navy
  text), the focus ring (`gold-600` on light, `gold-300` on dark), and the current stage. It is never decoration, never a gradient, never a background wash.
  Gold used everywhere stops meaning anything; gold used only for "this is where you are and
  this is what you do" makes the whole interface legible at a glance. This is the one place
  the design spends boldness.
- **Status colours are not brand colours.** An expiring passport must not be gold, because
  gold means "act here" and the two meanings would collide. The four state colours are
  deliberately muted so they read as institutional rather than alarming.
- **The World Map concept stays in WordPress.** The app is a workflow tool; a decorative world
  map behind a document checklist would be exactly the "redesign for aesthetics alone" the
  architect skill forbids. The brand continuity between site and app is carried by colour,
  type and logo — not by importing the marketing hero into an operational screen. *Flagging
  this as a design decision you may want to overrule.*

### 10.2 Typography

Bilingual Latin + Arabic is the hard constraint, and it is a typographic problem before it is
a CSS problem: two scripts with different vertical proportions in one type scale will drift
apart unless the families are metrically related.

**RECOMMENDED:**

- **UI, body, data: IBM Plex Sans + IBM Plex Sans Arabic.** One superfamily covering both
  scripts, with matched metrics and eight shared weights. This means one type scale, one
  vertical rhythm, and no per-locale spacing corrections — a real engineering saving across
  every screen, not an aesthetic preference. It is also open-licensed, so there is no font
  licence to renew or audit.
- **Page titles only: Noto Naskh Arabic for Arabic, paired with a transitional serif for
  Latin.** Naskh is the register of formal and official Arabic documents. For a product about
  permits, contracts and clearances, naskh is not a style choice — it is the correct register,
  and it will read to an Arabic-speaking user as institutionally serious in a way a geometric
  display face would not. This is the choice I would defend hardest in this document.

Scale (1.25 ratio, 16 px base): `12 · 14 · 16 · 20 · 25 · 31 · 39`. Body 16 px minimum —
never 14 px for content, because a large share of your candidates will read Arabic on a phone
in bright sunlight. Line length capped at 70 characters; line-height 1.6 body, 1.2 display.

**Avoided, per the design skill:** no all-caps labels (and all-caps is meaningless in Arabic
anyway, so it would break at the first locale switch); no single-word accenting in headings;
no monospace for data labels; no `→` appended to button text.

**DECISION REQUIRED #14a:** if Golden Eagle owns licensed brand typefaces, those win over
everything above — send the files and the licence terms.

### 10.3 Spacing, surface, motion

- 4 px base scale: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`. Nothing off-scale.
- Borders carry meaning: `--line-500` where a border defines a control a user must find
  (inputs, selects, table cells), `--paper-200` only where a line is decorative. A 1.17:1
  divider is fine as decoration and unacceptable as an input boundary.
- **Border radius encodes hierarchy** rather than being one global value: 0 on table rules
  and dividers, 4 px on inputs and buttons, 8 px on cards, 12 px on modals. One radius
  everywhere is a tell of a template; varying it by elevation is information.
- **One shadow, used twice.** Modals and dropdowns only — the things that genuinely float.
  Cards are separated by a 1 px `--paper-200` border, not a shadow. A page of identically
  shadowed cards is the SaaS-kit default the design skill warns against, and it also looks
  cheap at the premium register the brand requires.
- **Motion:** state transitions only — a drawer opening, a row confirming, a stage advancing.
  Durations 120 ms (local) / 200 ms (layout). **No entrance animations on page load**, no
  hover transitions on every card. `prefers-reduced-motion: reduce` removes all of it. This is
  the architect skill's "motion with purpose only", enforced by a convention: if an animation
  does not show *what changed*, it does not ship.

### 10.4 Components and their states

Every interactive component specifies all of: default · hover · focus-visible · active ·
disabled · loading · error · empty. A component is not done until all eight exist.

Inventory: Button (primary / secondary / ghost / destructive) · Input · Select · Combobox ·
Date field · File upload · Checkbox · Radio · Toggle · Form field wrapper (label + hint +
error, wired with `aria-describedby`) · Table + its mobile card equivalent · Stage timeline ·
Badge · Alert · Toast · Modal · Drawer · Tabs · Pagination · Avatar · Empty state ·
Skeleton · Checklist row.

**The focus ring is a 2 px `--gold-600` outline (`--gold-300` on dark) with a 2 px offset, on
every focusable element, and it is never removed.** `:focus-visible`, so it appears for keyboard users without
following mouse clicks around the screen.

---

## 11. Responsive behaviour

Breakpoints, named for what changes rather than for devices:

| Token | Width | Behaviour |
|---|---|---|
| `base` | 360–767 | One column. Bottom tab bar for primary navigation. Tables become cards. Vertical stage timeline. Full-width actions. Drawer instead of modal. |
| `md` | 768–1023 | Two columns where content earns it. Top navigation replaces the tab bar. Tables appear, horizontally complete — no inner scroll. |
| `lg` | 1024–1439 | Persistent left navigation for staff roles. Detail screens get a sidebar. Work queues gain columns. |
| `xl` | 1440+ | Content capped at 1280 px and centred. The queue table may use the extra width; prose does not. |

Rules: 360 px is the floor and is tested. Touch targets 44 × 44 px minimum. **No horizontal
page scroll at any width** — asserted by a Playwright check at every breakpoint. All spacing
uses logical properties (`padding-inline`, `margin-inline-start`), so RTL needs no mirrored
stylesheet. Tested at 360 / 414 / 768 / 1024 / 1440, in both directions.

---

## 12. Internationalisation

- `en` and `ar`. Locale is a URL segment (`/en/...`, `/ar/...`) so a link is shareable in the
  language it was sent in, and `<html lang dir>` is set from it on the server — no
  flash of wrong direction.
- `dir="rtl"` for Arabic, set server-side. Logical CSS only (§11).
- Directional icons (back, next, progress) mirror. Non-directional icons (document, user,
  calendar) do not. A mirrored clock is a bug, and a non-mirrored back arrow is also a bug.
- Numbers, dates and plurals via `Intl`, never hand-rolled.
- Timestamps stored UTC, rendered in the user's timezone. **Anything legally meaningful
  — a document expiry, a submission time — renders with its timezone shown explicitly.**
  "Expires 14 Mar 2027" without a zone is a support ticket waiting to happen.
- Translation keys only in components; no literal user-facing string in a component file,
  enforced by lint.
- **No machine-translated copy ships.** Untranslated keys render the English and are listed in
  a build report. The Arabic in §2.4 is my draft and is marked for your review.

---

## 13. Accessibility plan

Target **WCAG 2.2 AA**. Mandatory per the Golden Eagle QA skill, and a hard gate rather than
an aspiration — a candidate who cannot complete an application with a screen reader is a
candidate you have excluded.

- **Semantic HTML first.** Real `<button>`, `<a>`, `<table>`, `<form>`, `<fieldset>`. ARIA
  only where HTML has no element for the job (tabs, live regions). No `div` with a click
  handler, ever.
- **Keyboard:** every action reachable and operable by keyboard. Logical tab order following
  the visual order. Visible focus on everything (§10.4). Skip-to-content link. Escape closes
  modals and drawers; focus is trapped inside them and **returned to the trigger** on close.
- **Forms:** every input has a real `<label>`. Hints and errors are wired with
  `aria-describedby`. Errors are announced in a live region **and** attached to the field.
  On submit failure, focus moves to the first invalid field. Required fields marked in text,
  not by colour or an asterisk alone.
- **Asynchronous state:** loading announced via `aria-busy` and a polite live region. Toasts
  are live regions. The disabled-with-reason pattern in §9 puts the reason in a live region,
  so a blocked action explains itself to a screen-reader user exactly as it does visually.
- **Contrast:** AA for text (4.5:1) and WCAG 2.2 SC 1.4.11 for UI boundaries and the focus
  ring (3:1), light and dark, en and ar. The §10.1 table is the measured baseline and is
  re-verified by a build-time test.
- **Zoom and reflow:** usable at 200 % zoom and at 320 px CSS width with no loss of function
  and no two-dimensional scrolling.
- **Motion:** `prefers-reduced-motion` honoured globally.
- **Testing:** `axe-core` in the Playwright suite on every page, failing the build on a
  violation; plus a manual keyboard-only pass and a screen-reader pass (NVDA or VoiceOver) of
  the five journeys at every milestone. Automation catches perhaps half of what matters —
  the manual pass is not optional and its results are reported honestly.

---

## 14. Test plan

### 14.1 Layers

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | Validation schemas, policy layer, stage-transition rules, date and locale helpers |
| Integration | Vitest + a real PostgreSQL | Every endpoint against a live database. **No mocked database** — the invariants in §2.3 are the point, and a mock cannot enforce a constraint. |
| Authorisation | Vitest | A matrix of every role × every endpoint × own/other record. Generated, not hand-written, so a new endpoint without a policy fails the suite. |
| End-to-end | Playwright | The five journeys, in `en` and `ar`, at five widths, keyboard-only |
| Accessibility | axe-core in Playwright | Every page |
| Security | Automated | Dependency audit, secret scan, public-bucket assertion, security-header assertion |
| Manual | Checklist | Screen reader, real-device mobile, the negative paths in §14.3 |

### 14.2 The authorisation matrix is the centrepiece

For a product holding identity documents under six roles, the test that matters most is not
"does the happy path work" but "can role X reach record Y that does not belong to them". That
matrix is generated from the role list and the endpoint list, so adding an endpoint without a
policy entry **breaks the build**. Access control that is not tested exhaustively is access
control you are guessing about.

### 14.3 Negative paths explicitly tested

Unauthenticated access to every protected route · a candidate requesting another candidate's
document (expect 404, not 403) · an employer requesting another employer's requirement · an
admin requesting a candidate document (expect: permitted, logged, and the log entry asserted)
· an illegal stage transition · upload of a PHP file renamed `.pdf` · upload exceeding the
size cap · download of a document whose `scan_status` is `pending` · download of an `infected`
document · a replayed password-reset token · a revoked session · login throttling on both axes
· CSRF-less state change · concurrent edit conflict · `UPDATE` attempted on `audit_log`
(expect: refused by database privilege).

### 14.4 Milestone gate

Every milestone, before it is reported complete: lint · typecheck · all suites · a real
browser pass of the changed flows at three widths · keyboard pass · console and network clean
· empty and error states checked · unauthorised paths checked · secret scan clean.

**Any gate that was not run is reported as not run.** Phase 0 and the Golden Eagle QA skill
both require this, and it is the one rule in this document whose violation would make every
other claim in it worthless.

---

## 15. Deployment and rollback

### 15.1 Environments

`local` (Docker Compose) → `staging` (identical to production, seeded with synthetic data
only — **never a copy of production personal data**) → `production`.

### 15.2 Pipeline

```
push -> lint, typecheck, unit, integration (real Postgres), axe, secret scan
     -> build immutable image, tagged with the commit SHA
     -> deploy to staging -> Playwright end-to-end against staging
     -> manual approval gate
     -> migrate production -> deploy -> health check -> smoke test
```

- **Migrations run as a separate, reviewed step before the new image is live**, and every
  migration must be backward-compatible with the currently running version. That single rule
  is what makes a rollback possible without a database restore.
- Images are immutable and SHA-tagged. "Rollback" means pointing at the previous SHA.
- Secrets come from the platform's secret manager, injected as environment variables. **No
  secret in the repository, the image, or the build log** — asserted by the secret scan.
- Health endpoint checks database reachability, storage reachability, and pending migration
  count. It does not report "healthy" merely because the process is running.

### 15.3 Rollback procedure

| Situation | Action | Recovery time |
|---|---|---|
| Bad release, schema unchanged | Redeploy the previous image SHA | < 5 min |
| Bad release, additive schema change | Redeploy previous image; the additive change is inert and is removed in a later migration | < 5 min |
| Bad release, destructive schema change | Should not exist — destructive changes are split into expand / migrate / contract across three releases, so there is always a safe previous version | n/a by design |
| Data corruption | Restore from point-in-time recovery to just before the event; replay from the audit log what is known | < 1 h, **rehearsed** |
| **Total failure of the application** | **Remove the entry-point link in WordPress.** The public site is untouched and the business continues as it does today. | **< 1 min** |

That last row is the whole reason option B was the right answer to Phase 0's conflict. The
worst case is not an outage — it is a return to the status quo, reversible by one person in
under a minute without a deployment.

- Point-in-time recovery enabled; **restore rehearsed at least once before launch**, because
  an untested backup is a belief rather than a control.
- Every rollback writes an audit entry and an incident note.

---

## 16. Proposed milestones for Phase 2

Each ends with the §14.4 gate and an honest report, then stops for your approval.

| M | Scope | Why this order |
|---|---|---|
| 0 | Repository, CI, lint, typecheck, test harness, Docker Compose, empty migration, secret scan, health endpoint | The gates exist before the code they gate |
| 1 | Schema + migrations + seed of roles, stages, document types | Everything references this |
| 2 | Authentication: register, verify, login, logout, reset, sessions, throttling | Nothing is testable without identity |
| 3 | Policy layer + the generated authorisation matrix | Built *before* the features it protects, not after |
| 4 | Design system, tokens, components with all eight states, en/ar + RTL shell | Screens need a vocabulary first |
| 5 | Candidate journey: profile, upload, status timeline | The highest-trust surface; validates the hardest component (§5) early |
| 6 | Consultant: queue, requirements, applications, transitions, history | Core operational value |
| 7 | Cases: service types, checklists, transitions | Depends on 5's document machinery |
| 8 | Admin dashboard + audit log viewer + operations panel | Needs real data to be meaningful |
| 9 | Notifications, expiry sweep, retention job | Needs the whole model present |
| 10 | Hardening: headers, rate limits, security review, accessibility pass, performance budget | Final gate before launch |

Milestone 3 before 5–8 is the decision I would defend most strongly here. Building features
first and adding authorisation later is how products end up with the one unprotected endpoint
that leaks a candidate's passport.

---

## 17. What I need to proceed

**To start Milestone 0** I need only #2a and #13a:

- **#2a** The new repository name. I proposed `goldeneaglegs/gegs-platform`; the application
  name (#4) may give a better one.
- **#13a** Cloud account and Gulf region.

**Needed by the milestone shown, not before:**

| Need | By | Note |
|---|---|---|
| #4 Application name | M4 | Appears in the UI and in email |
| #5 Do employers self-serve in v1? | M1 | Changes schema and scope |
| #6 Correct my stage proposal (§2.4) | M1 | Seed data; cheap to change later, free to change now |
| #7 Service catalogue + checklists (§2.5) | M7 | Ships empty otherwise |
| #9 Retention periods | M9 | Legal answer |
| #9a Audit retention period | M9 | Legal answer |
| #10 Government API scope | M7 | Out of scope unless you say otherwise |
| #12 Email provider | M9 | Behind an adapter, so reversible |
| #14 Brand assets, exact hex, typeface licences | M4 | Tokens make substitution a one-file change |
| #15 Approved legal content | M10 | Privacy policy, terms, cookie notice |
| 2FA for staff in v1? (§4.1) | M2 | ~1 milestone of work if yes |
| DOCX uploads allowed? (§5.2) | M5 | PDF/JPEG/PNG otherwise |

**Still the most valuable thing you can tell me:** whether the problem statement in Phase 0 §2
is right. Everything above is built on it.

Per your collaboration rule, I stop here. No production code until you approve this plan.
