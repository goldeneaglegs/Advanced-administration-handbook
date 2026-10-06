-- Append-only audit structures — Phase 1 §7.
--
-- An audit log that can be out of step with reality is worse than none,
-- because it is trusted. Two tables below are therefore append-only, and that
-- is enforced by the database rather than promised by the application.
--
-- ENFORCEMENT, IN TWO LAYERS
--
--   1. Triggers (in this migration), at BOTH row level and statement level.
--      Both are needed: a FOR EACH ROW trigger does not fire when the
--      statement matches no rows, so `UPDATE audit_log SET ...` against an
--      empty table would otherwise succeed and the table would not be
--      append-only until its first row existed. The statement-level trigger
--      closes that. They bind EVERY connection, including the table owner and
--      a psql session during an incident.
--
--   2. Privileges (prisma/production-grants.sql, applied by an operator).
--      The application's database role is granted INSERT and SELECT only. This
--      is the control Phase 1 §2.3 specifies.
--
-- Both are included because they fail differently. A privilege grant does not
-- bind the owner, and a trigger can be dropped by the owner; together, no
-- single mistake in application code can rewrite history.

CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Nullable: a failed sign-in with an unknown address, or a scheduled job,
  -- has no actor. Those events still must be recorded.
  --
  -- ON DELETE RESTRICT, not SET NULL. Two reasons, and the first is the real one:
  --   1. SET NULL would DESTROY ATTRIBUTION. An audit row reading "someone read
  --      this passport" with no actor is not evidence. The whole purpose of this
  --      table is that privileged access is attributable, so the actor must
  --      survive for as long as the record does.
  --   2. SET NULL is also mechanically impossible here: PostgreSQL implements it
  --      as an UPDATE against this table, which the append-only triggers below
  --      refuse. The two requirements are incompatible, and attribution wins.
  --
  -- Consequence, deliberately accepted: a user row cannot be HARD-deleted while
  -- any audit record references them. Users are soft-deleted (Phase 1 §2.1), and
  -- audit_log is exempt from the retention sweep with its own statutory period
  -- (Phase 1 §7.2, DECISION REQUIRED #9a) — so erasure of a user is gated on
  -- their audit records ageing out first. That is a legal sequencing question,
  -- not a bug, and it is recorded as such.
  actor_user_id uuid        REFERENCES users (id) ON DELETE RESTRICT,
  actor_ip      inet,
  action        text        NOT NULL,
  subject_type  text        NOT NULL,
  subject_id    uuid,
  -- Changed fields only, never whole rows. A diff is readable; a snapshot pair
  -- is not, and storing whole rows would duplicate personal data into a table
  -- that is never deleted (Phase 1 §7.2).
  before_json   jsonb,
  after_json    jsonb,
  request_id    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_at ON audit_log (created_at DESC);
CREATE INDEX audit_log_actor ON audit_log (actor_user_id, created_at DESC);
CREATE INDEX audit_log_subject ON audit_log (subject_type, subject_id, created_at DESC);
CREATE INDEX audit_log_action ON audit_log (action, created_at DESC);
CREATE INDEX audit_log_request ON audit_log (request_id) WHERE request_id IS NOT NULL;

COMMENT ON TABLE audit_log IS
  'Append-only. No UPDATE or DELETE path exists in application code, and the database refuses both. Exempt from the retention sweep (Phase 1 §7.2); its retention period is DECISION REQUIRED #9a.';

CREATE TABLE document_access_log (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  -- ON DELETE RESTRICT, deliberately. You must still be able to prove who read
  -- a document after that document has been removed, so the log pins the row.
  document_id   uuid        NOT NULL REFERENCES documents (id) ON DELETE RESTRICT,
  -- RESTRICT for the same reason as audit_log.actor_user_id above: a document
  -- read must remain attributable to a person.
  actor_user_id uuid        REFERENCES users (id) ON DELETE RESTRICT,
  actor_ip      inet,
  action        text        NOT NULL,
  request_id    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_access_log_document ON document_access_log (document_id, created_at DESC);
CREATE INDEX document_access_log_actor ON document_access_log (actor_user_id, created_at DESC);

COMMENT ON TABLE document_access_log IS
  'Append-only. Records THAT a document was read, by whom, never its contents. This is what makes privileged access attributable rather than invisible (Phase 1 §4.2).';

-- ---------------------------------------------------------------------------
-- Layer 1: the trigger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Table % is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Audit records are evidence. Correct a mistake by appending a new row, never by editing or removing one.';
END;
$$;

-- Row level: refuses a mutation that touches any existing row.
CREATE TRIGGER audit_log_append_only_row
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER document_access_log_append_only_row
  BEFORE UPDATE OR DELETE ON document_access_log
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Statement level: refuses the statement even when it matches no rows, so the
-- table is append-only from creation rather than from its first row.
CREATE TRIGGER audit_log_append_only_stmt
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER document_access_log_append_only_stmt
  BEFORE UPDATE OR DELETE ON document_access_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- TRUNCATE supports only statement-level triggers.
CREATE TRIGGER audit_log_append_only_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER document_access_log_append_only_truncate
  BEFORE TRUNCATE ON document_access_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
