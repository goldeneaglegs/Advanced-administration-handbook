-- Per-IP authentication throttling.
--
-- Phase 1 §4.1 requires throttling on BOTH axes. Milestone 1 provided the
-- per-account axis only (users.failed_login_count, users.locked_until), and
-- Phase 1 §1.3 ruled out Redis for v1 — so the per-IP axis is recorded here, in
-- PostgreSQL.
--
-- Both axes are needed and neither is sufficient alone: per-IP limits are
-- defeated by a botnet, and per-account limits let a single host spray many
-- accounts.
--
-- CLIENT IP: Milestone 2 records the SOCKET address only. A client-supplied
-- X-Forwarded-For is trivially spoofable, which would make this table look like
-- protection while providing none. Trusted-proxy configuration behind the
-- approved regional load balancer is a Milestone 10 deployment task, and is
-- recorded as a known limitation until then.
CREATE TABLE auth_attempts (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Nullable: a request can arrive with no resolvable socket address. Such an
  -- attempt is still recorded, so the gap is visible rather than silent.
  ip         inet,
  -- Which protected action was attempted. Text rather than an enum: the set of
  -- throttled endpoints changes as milestones add them, and that should not
  -- require a type migration.
  action     text        NOT NULL,
  succeeded  boolean     NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Serves every throttle query: failures for one ip + action inside a window.
CREATE INDEX auth_attempts_ip_action_time ON auth_attempts (ip, action, created_at DESC);
-- Serves pruning.
CREATE INDEX auth_attempts_created_at ON auth_attempts (created_at);

COMMENT ON TABLE auth_attempts IS
  'Per-IP authentication attempt log for throttling. Records the SOCKET address only (M2 limitation; trusted-proxy handling is M10). Pruned opportunistically in M2; a scheduled sweep belongs to the M9 job runner.';
