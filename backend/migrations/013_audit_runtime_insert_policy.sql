BEGIN;

ALTER TABLE audit.event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_event_runtime_insert ON audit.event;
CREATE POLICY audit_event_runtime_insert ON audit.event FOR INSERT
  WITH CHECK (
    tenant_id = app_security.setting('app.tenant_id')
    AND actor_user_id = app_security.setting('app.user_id')
    AND (
      COALESCE(details->>'twin_id', '') = ''
      OR details->>'twin_id' = ANY(app_security.setting_list('app.allowed_twin_ids'))
    )
    AND (
      COALESCE(details->>'active_twin_id', '') = ''
      OR details->>'active_twin_id' = ANY(app_security.setting_list('app.allowed_twin_ids'))
    )
  );

GRANT INSERT ON audit.event TO meids_app_runtime;

COMMIT;
