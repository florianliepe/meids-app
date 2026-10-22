BEGIN;

GRANT INSERT
  ON identity.tenant
  TO meids_app_runtime;

GRANT INSERT, UPDATE
  ON identity.app_user
  TO meids_app_runtime;

COMMIT;
