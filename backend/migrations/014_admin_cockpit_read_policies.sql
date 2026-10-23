BEGIN;

CREATE OR REPLACE FUNCTION app_security.is_application_manager()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app_security.setting('app.roles') IS NOT NULL
    AND string_to_array(app_security.setting('app.roles'), ',') && ARRAY['admin', 'owner']::text[]
$$;

DROP POLICY IF EXISTS concept_admin_read ON knowledge.concept;
CREATE POLICY concept_admin_read ON knowledge.concept FOR SELECT
  USING (
    tenant_id = app_security.setting('app.tenant_id')
    AND app_security.is_application_manager()
  );

DROP POLICY IF EXISTS learning_admin_read ON learning.increment;
CREATE POLICY learning_admin_read ON learning.increment FOR SELECT
  USING (
    tenant_id = app_security.setting('app.tenant_id')
    AND app_security.is_application_manager()
  );

DROP POLICY IF EXISTS audit_event_admin_read ON audit.event;
CREATE POLICY audit_event_admin_read ON audit.event FOR SELECT
  USING (
    tenant_id = app_security.setting('app.tenant_id')
    AND app_security.is_application_manager()
  );

GRANT EXECUTE ON FUNCTION app_security.is_application_manager() TO meids_app_runtime;

COMMIT;
