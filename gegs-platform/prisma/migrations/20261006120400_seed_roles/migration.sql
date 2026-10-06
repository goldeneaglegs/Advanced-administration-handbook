-- The six RBAC roles, from the APPROVED Phase 0 §3 role model.
--
-- This is the only seed data in Milestone 1. It is approved client-reviewed
-- content, not invented business data: the six roles and their meanings were
-- set out in Phase 0 §3 and signed off. The Milestone 3 authorisation policy
-- layer cannot be built or tested without them.
--
-- It is a SEPARATE migration so it can be reverted on its own, without
-- touching the schema, if the role model changes.
--
-- name_ar is deliberately NULL. Phase 1 §12: no machine-translated Arabic
-- ships. These render the English and are reported as untranslated until the
-- client supplies the Arabic.
--
-- NOT seeded anywhere in Milestone 1, because they are proposals or client
-- facts rather than approved data: pipeline_stages, case_stages, service_types,
-- document_types, notification_templates.
INSERT INTO roles (key, name_en, name_ar) VALUES
  ('candidate',    'Candidate',          NULL),
  ('employer',     'Employer',           NULL),
  ('consultant',   'Consultant',         NULL),
  ('case_officer', 'Case officer',       NULL),
  ('manager',      'Operations manager', NULL),
  ('admin',        'Administrator',      NULL)
ON CONFLICT (key) DO NOTHING;
