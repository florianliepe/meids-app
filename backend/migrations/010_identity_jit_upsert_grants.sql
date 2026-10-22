BEGIN;

GRANT UPDATE
  ON identity.tenant
  TO meids_app_runtime;

GRANT INSERT, UPDATE
  ON identity.security_group
  TO meids_app_runtime;

GRANT INSERT
  ON identity.user_group
  TO meids_app_runtime;

COMMIT;
