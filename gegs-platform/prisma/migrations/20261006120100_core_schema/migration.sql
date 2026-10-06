-- Core schema — approved Phase 1 §2.2.
--
-- Conventions (Phase 1 §2.1), applied without exception below:
--   * Primary keys are UUIDv7.
--   * Every timestamp is timestamptz and stored in UTC. The database is never
--     told about a user's timezone; that is a rendering concern (Phase 1 §12).
--   * Soft delete (deleted_at) only where Phase 1 specifies it, with a partial
--     index so live-row lookups never scan deleted rows.
--   * Enumerations that are BUSINESS RULES are TABLES, not Postgres enums, so
--     correcting them is an admin edit rather than a migration. Those tables
--     ship EMPTY: the real values are client configuration, not code.
--   * Enumerations that are SYSTEM FACTS are native enums.
--   * Every foreign key declares an explicit ON DELETE rule. No orphan rows.

-- ---------------------------------------------------------------------------
-- System enumerations. These are facts about how the software works, not about
-- how the business works, so they are safe to fix in code.
-- ---------------------------------------------------------------------------
CREATE TYPE user_status          AS ENUM ('invited', 'active', 'suspended');
CREATE TYPE email_token_purpose  AS ENUM ('verify_email', 'reset_password');
CREATE TYPE employer_status      AS ENUM ('active', 'inactive');
CREATE TYPE requirement_status   AS ENUM ('open', 'closed');
CREATE TYPE scan_status          AS ENUM ('pending', 'clean', 'infected', 'error');
CREATE TYPE notification_channel AS ENUM ('email');

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
CREATE TABLE organisations (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  legal_name   text        NOT NULL,
  country_code char(2)     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN organisations.legal_name IS 'Company fact supplied by the client; never generated.';

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  -- citext, so a UNIQUE constraint cannot be defeated by changing
  -- capitalisation. Lowercasing in application code is not equivalent: one
  -- missed path is an account-takeover vector.
  email               citext      NOT NULL,
  password_hash       text        NOT NULL,
  email_verified_at   timestamptz,
  locale              text        NOT NULL DEFAULT 'en',
  timezone            text        NOT NULL DEFAULT 'UTC',
  status              user_status NOT NULL DEFAULT 'invited',
  failed_login_count  integer     NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  password_changed_at timestamptz,
  last_login_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT users_email_shape        CHECK (position('@' IN email) > 1),
  CONSTRAINT users_failed_login_count CHECK (failed_login_count >= 0),
  CONSTRAINT users_locale_supported   CHECK (locale IN ('en', 'ar'))
);
-- Partial unique index rather than a plain UNIQUE: a soft-deleted account must
-- not block re-registration of the same address.
CREATE UNIQUE INDEX users_email_unique_live ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX users_status_live ON users (status) WHERE deleted_at IS NULL;

CREATE TABLE roles (
  id      uuid PRIMARY KEY DEFAULT uuidv7(),
  key     text NOT NULL UNIQUE,
  name_en text NOT NULL,
  -- Nullable on purpose. Phase 1 §12: no machine-translated Arabic ships.
  -- A NULL here renders the English and is reported as untranslated.
  name_ar text
);

CREATE TABLE user_roles (
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id    uuid        NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  granted_by uuid        REFERENCES users (id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_id ON user_roles (role_id);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Only the hash is stored, so a database leak does not hand over live
  -- sessions (Phase 1 §4.1).
  token_hash   bytea       NOT NULL UNIQUE,
  ip           inet,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX sessions_user_live ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expires_at ON sessions (expires_at);

CREATE TABLE email_tokens (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid                NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose     email_token_purpose NOT NULL,
  token_hash  bytea               NOT NULL UNIQUE,
  expires_at  timestamptz         NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz         NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_user_purpose ON email_tokens (user_id, purpose) WHERE consumed_at IS NULL;

-- ---------------------------------------------------------------------------
-- Parties
-- ---------------------------------------------------------------------------
CREATE TABLE candidate_profiles (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id              uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  full_name            text        NOT NULL,
  nationality_code     char(2),
  dob                  date,
  phone_e164           text,
  current_country_code char(2),
  headline             text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  CONSTRAINT candidate_phone_e164_shape CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT candidate_dob_past         CHECK (dob IS NULL OR dob < CURRENT_DATE)
);
CREATE UNIQUE INDEX candidate_profiles_user_unique ON candidate_profiles (user_id) WHERE deleted_at IS NULL;

CREATE TABLE employers (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  name         text            NOT NULL,
  country_code char(2),
  status       employer_status NOT NULL DEFAULT 'active',
  created_at   timestamptz     NOT NULL DEFAULT now(),
  updated_at   timestamptz     NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX employers_status_live ON employers (status) WHERE deleted_at IS NULL;

CREATE TABLE employer_contacts (
  employer_id uuid        NOT NULL REFERENCES employers (id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  is_primary  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employer_id, user_id)
);
-- At most one primary contact per employer.
CREATE UNIQUE INDEX employer_contacts_one_primary
  ON employer_contacts (employer_id) WHERE is_primary;
CREATE INDEX employer_contacts_user ON employer_contacts (user_id);

-- ---------------------------------------------------------------------------
-- Recruitment
--
-- pipeline_stages is DELIBERATELY EMPTY. The stages drafted in Phase 1 §2.4 are
-- proposals, not confirmed business facts, and are not seeded here. Until the
-- client supplies the real stages, no application row can be created — which is
-- the correct behaviour: the system refuses to operate on invented rules rather
-- than silently adopting a guess.
-- ---------------------------------------------------------------------------
CREATE TABLE pipeline_stages (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  key        text    NOT NULL UNIQUE,
  name_en    text    NOT NULL,
  name_ar    text,
  sort_order integer NOT NULL,
  is_terminal boolean NOT NULL DEFAULT false,
  -- NULL for non-terminal stages; only a terminal stage records success.
  is_success boolean,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_stage_success_only_terminal
    CHECK ((is_terminal AND is_success IS NOT NULL) OR (NOT is_terminal AND is_success IS NULL))
);
CREATE UNIQUE INDEX pipeline_stages_sort_order ON pipeline_stages (sort_order);
COMMENT ON TABLE pipeline_stages IS
  'Client-configured recruitment stages. Ships empty: Phase 1 §2.4 values are proposals, not approved business facts.';

CREATE TABLE requirements (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  employer_id   uuid               NOT NULL REFERENCES employers (id) ON DELETE RESTRICT,
  title         text               NOT NULL,
  description   text,
  country_code  char(2),
  headcount     integer            NOT NULL DEFAULT 1,
  status        requirement_status NOT NULL DEFAULT 'open',
  owner_user_id uuid               REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz        NOT NULL DEFAULT now(),
  updated_at    timestamptz        NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  CONSTRAINT requirements_headcount_positive CHECK (headcount > 0),
  CONSTRAINT requirements_closed_consistency
    CHECK ((status = 'closed' AND closed_at IS NOT NULL) OR (status = 'open' AND closed_at IS NULL))
);
CREATE INDEX requirements_employer ON requirements (employer_id);
CREATE INDEX requirements_owner_open ON requirements (owner_user_id) WHERE status = 'open';

CREATE TABLE applications (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  requirement_id       uuid        NOT NULL REFERENCES requirements (id) ON DELETE CASCADE,
  candidate_profile_id uuid        NOT NULL REFERENCES candidate_profiles (id) ON DELETE RESTRICT,
  stage_id             uuid        NOT NULL REFERENCES pipeline_stages (id) ON DELETE RESTRICT,
  stage_changed_at     timestamptz NOT NULL DEFAULT now(),
  owner_user_id        uuid        REFERENCES users (id) ON DELETE SET NULL,
  outcome_reason       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Phase 1 §2.3: a candidate cannot be submitted twice to the same
  -- requirement. Duplicate submission is a real and embarrassing failure in
  -- this industry, so the database refuses it rather than trusting the code.
  CONSTRAINT applications_one_per_candidate_per_requirement
    UNIQUE (requirement_id, candidate_profile_id)
);
CREATE INDEX applications_stage ON applications (stage_id);
CREATE INDEX applications_owner ON applications (owner_user_id);
CREATE INDEX applications_candidate ON applications (candidate_profile_id);
-- Supports the consultant work queue's default sort: longest time in stage
-- first (Phase 1 §9).
CREATE INDEX applications_stage_changed_at ON applications (stage_changed_at);

CREATE TABLE application_stage_history (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  application_id     uuid        NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  -- NULL on the first entry: the application had no prior stage.
  from_stage_id      uuid        REFERENCES pipeline_stages (id) ON DELETE RESTRICT,
  to_stage_id        uuid        NOT NULL REFERENCES pipeline_stages (id) ON DELETE RESTRICT,
  changed_by_user_id uuid        REFERENCES users (id) ON DELETE SET NULL,
  reason             text,
  changed_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_stage_history_no_self_transition
    CHECK (from_stage_id IS NULL OR from_stage_id <> to_stage_id)
);
CREATE INDEX application_stage_history_application ON application_stage_history (application_id, changed_at);

-- ---------------------------------------------------------------------------
-- Government services
--
-- service_types, case_stages and document_types ALL ship EMPTY. The client's
-- licensed service catalogue and its per-service document checklists are
-- DECISION REQUIRED #7 and are not invented here.
-- ---------------------------------------------------------------------------
CREATE TABLE service_types (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  key            text    NOT NULL UNIQUE,
  name_en        text    NOT NULL,
  name_ar        text,
  description_en text,
  description_ar text,
  active         boolean NOT NULL DEFAULT true,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE service_types IS
  'Client-licensed government services. Ships empty: DECISION REQUIRED #7. Deactivate, never delete — cases reference it.';

CREATE TABLE case_stages (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  -- NULL means the stage is global across every service type; a value scopes
  -- it to one service, so an unusual service does not impose its stages on the
  -- rest (Phase 1 §2.5).
  service_type_id uuid    REFERENCES service_types (id) ON DELETE CASCADE,
  key             text    NOT NULL,
  name_en         text    NOT NULL,
  name_ar         text,
  sort_order      integer NOT NULL,
  is_terminal     boolean NOT NULL DEFAULT false,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- A key is unique per service, and separately unique among the global stages.
CREATE UNIQUE INDEX case_stages_key_per_service
  ON case_stages (service_type_id, key) WHERE service_type_id IS NOT NULL;
CREATE UNIQUE INDEX case_stages_key_global
  ON case_stages (key) WHERE service_type_id IS NULL;
COMMENT ON TABLE case_stages IS
  'Client-configured case stages. Ships empty: Phase 1 §2.5 values are proposals, not approved business facts.';

CREATE TABLE service_cases (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  service_type_id      uuid        NOT NULL REFERENCES service_types (id) ON DELETE RESTRICT,
  candidate_profile_id uuid        NOT NULL REFERENCES candidate_profiles (id) ON DELETE RESTRICT,
  stage_id             uuid        NOT NULL REFERENCES case_stages (id) ON DELETE RESTRICT,
  stage_changed_at     timestamptz NOT NULL DEFAULT now(),
  owner_user_id        uuid        REFERENCES users (id) ON DELETE SET NULL,
  -- Human-readable reference. Nullable and NOT auto-generated: the format is a
  -- business convention and is not invented here.
  reference            text,
  outcome              text,
  opened_at            timestamptz NOT NULL DEFAULT now(),
  closed_at            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX service_cases_reference_unique ON service_cases (reference) WHERE reference IS NOT NULL;
CREATE INDEX service_cases_candidate ON service_cases (candidate_profile_id);
CREATE INDEX service_cases_owner_open ON service_cases (owner_user_id) WHERE closed_at IS NULL;
CREATE INDEX service_cases_type ON service_cases (service_type_id);
CREATE INDEX service_cases_stage_changed_at ON service_cases (stage_changed_at);

CREATE TABLE case_stage_history (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  case_id            uuid        NOT NULL REFERENCES service_cases (id) ON DELETE CASCADE,
  from_stage_id      uuid        REFERENCES case_stages (id) ON DELETE RESTRICT,
  to_stage_id        uuid        NOT NULL REFERENCES case_stages (id) ON DELETE RESTRICT,
  changed_by_user_id uuid        REFERENCES users (id) ON DELETE SET NULL,
  reason             text,
  changed_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_stage_history_no_self_transition
    CHECK (from_stage_id IS NULL OR from_stage_id <> to_stage_id)
);
CREATE INDEX case_stage_history_case ON case_stage_history (case_id, changed_at);

-- ---------------------------------------------------------------------------
-- Documents — the highest-risk data in the product (Phase 1 §13).
-- ---------------------------------------------------------------------------
CREATE TABLE document_types (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  key             text    NOT NULL UNIQUE,
  name_en         text    NOT NULL,
  name_ar         text,
  requires_expiry boolean NOT NULL DEFAULT false,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE document_types IS
  'Client-configured document types. Ships empty: tied to DECISION REQUIRED #7.';

CREATE TABLE document_requirements (
  id               uuid    PRIMARY KEY DEFAULT uuidv7(),
  service_type_id  uuid    NOT NULL REFERENCES service_types (id) ON DELETE CASCADE,
  document_type_id uuid    NOT NULL REFERENCES document_types (id) ON DELETE RESTRICT,
  mandatory        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_requirements_unique UNIQUE (service_type_id, document_type_id)
);

CREATE TABLE documents (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Phase 1 §2.2 described a polymorphic owner_type/owner_id pair. That cannot
  -- be enforced by a foreign key, so it is implemented here as two nullable
  -- FKs with a CHECK that exactly one is set: same flexibility, real
  -- referential integrity. Recorded as a deliberate improvement on the plan.
  candidate_profile_id uuid        REFERENCES candidate_profiles (id) ON DELETE RESTRICT,
  service_case_id      uuid        REFERENCES service_cases (id) ON DELETE RESTRICT,
  document_type_id     uuid        NOT NULL REFERENCES document_types (id) ON DELETE RESTRICT,
  -- Opaque object key. No original filename, no extension: a leaked key reveals
  -- nothing and a crafted filename cannot traverse a path (Phase 1 §5.2).
  storage_key          text        NOT NULL UNIQUE,
  display_name         text,
  mime                 text        NOT NULL,
  bytes                bigint      NOT NULL,
  checksum_sha256      bytea       NOT NULL,
  issued_on            date,
  expires_on           date,
  scan_status          scan_status NOT NULL DEFAULT 'pending',
  scanned_at           timestamptz,
  uploaded_by_user_id  uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  CONSTRAINT documents_exactly_one_owner
    CHECK (num_nonnulls(candidate_profile_id, service_case_id) = 1),
  CONSTRAINT documents_expiry_after_issue
    CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on > issued_on),
  CONSTRAINT documents_bytes_positive CHECK (bytes > 0),
  CONSTRAINT documents_checksum_length CHECK (octet_length(checksum_sha256) = 32),
  CONSTRAINT documents_scanned_at_set
    CHECK ((scan_status = 'pending' AND scanned_at IS NULL) OR (scan_status <> 'pending' AND scanned_at IS NOT NULL))
);
-- The expiry sweep is the one query guaranteed to run every day forever.
CREATE INDEX documents_expiring
  ON documents (expires_on)
  WHERE deleted_at IS NULL AND expires_on IS NOT NULL;
CREATE INDEX documents_candidate_live
  ON documents (candidate_profile_id) WHERE deleted_at IS NULL AND candidate_profile_id IS NOT NULL;
CREATE INDEX documents_case_live
  ON documents (service_case_id) WHERE deleted_at IS NULL AND service_case_id IS NOT NULL;
-- Drives the admin Operations panel's pending-scan queue.
CREATE INDEX documents_pending_scan ON documents (created_at) WHERE scan_status = 'pending';

-- ---------------------------------------------------------------------------
-- Platform
-- ---------------------------------------------------------------------------
CREATE TABLE notification_templates (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  template_key text NOT NULL UNIQUE,
  subject_en   text NOT NULL,
  subject_ar   text,
  body_en      text NOT NULL,
  body_ar      text,
  updated_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE notification_templates IS
  'Ships empty: template copy is client-approved content, not generated.';

CREATE TABLE notifications (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id        uuid                 NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  channel        notification_channel NOT NULL DEFAULT 'email',
  template_key   text                 NOT NULL,
  payload_json   jsonb                NOT NULL DEFAULT '{}'::jsonb,
  queued_at      timestamptz          NOT NULL DEFAULT now(),
  sent_at        timestamptz,
  failed_at      timestamptz,
  failure_reason text,
  attempts       integer              NOT NULL DEFAULT 0,
  read_at        timestamptz,
  CONSTRAINT notifications_attempts_non_negative CHECK (attempts >= 0),
  CONSTRAINT notifications_not_sent_and_failed
    CHECK (NOT (sent_at IS NOT NULL AND failed_at IS NOT NULL))
);
-- The delivery worker's queue: anything queued and not yet sent.
CREATE INDEX notifications_pending ON notifications (queued_at) WHERE sent_at IS NULL;
CREATE INDEX notifications_user ON notifications (user_id, queued_at DESC);
-- Surfaces delivery failures in the admin Operations panel. Phase 1 §13: a
-- silently swallowed notification failure is a compliance exposure.
CREATE INDEX notifications_failed ON notifications (failed_at) WHERE failed_at IS NOT NULL;
