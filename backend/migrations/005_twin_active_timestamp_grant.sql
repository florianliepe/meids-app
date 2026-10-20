BEGIN;

GRANT UPDATE (active_twin_id, updated_at)
  ON identity.app_user
  TO meids_app_runtime;

COMMIT;
