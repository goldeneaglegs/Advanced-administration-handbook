-- Attach the shared set_updated_at() trigger to every table carrying an
-- updated_at column.
--
-- Done in the database rather than the application so that a direct SQL
-- correction during an incident cannot leave a stale timestamp behind — which
-- would then be used as evidence of when a record last changed.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organisations', 'users', 'candidate_profiles', 'employers',
    'pipeline_stages', 'requirements', 'applications',
    'service_types', 'case_stages', 'service_cases',
    'document_types', 'documents', 'notification_templates'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t
    );
  END LOOP;
END;
$$;
