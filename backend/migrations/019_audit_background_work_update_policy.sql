BEGIN;

ALTER TABLE audit.event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_event_background_work_update_own ON audit.event;
CREATE POLICY audit_event_background_work_update_own ON audit.event FOR UPDATE
  USING (
    tenant_id = app_security.setting('app.tenant_id')
    AND actor_user_id = app_security.setting('app.user_id')
    AND resource_type = 'agent.background_work'
  )
  WITH CHECK (
    tenant_id = app_security.setting('app.tenant_id')
    AND actor_user_id = app_security.setting('app.user_id')
    AND resource_type = 'agent.background_work'
    AND action IN ('agent.work.queued', 'agent.work.processing', 'agent.work.completed', 'agent.work.failed')
  );

GRANT UPDATE ON audit.event TO meids_app_runtime;

COMMIT;
