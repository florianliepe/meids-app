BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meids_app_runtime') THEN
    CREATE ROLE meids_app_runtime NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA identity, twin, knowledge, learning, agent, runtime, audit, app_security TO meids_app_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA identity, twin, agent TO meids_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA knowledge, learning, runtime TO meids_app_runtime;
GRANT INSERT ON ALL TABLES IN SCHEMA audit TO meids_app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA identity, twin, knowledge, learning, agent, runtime, audit TO meids_app_runtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA identity, twin, agent GRANT SELECT ON TABLES TO meids_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA knowledge, learning, runtime GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO meids_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit GRANT INSERT ON TABLES TO meids_app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity, twin, knowledge, learning, agent, runtime, audit
  GRANT USAGE, SELECT ON SEQUENCES TO meids_app_runtime;

COMMIT;
