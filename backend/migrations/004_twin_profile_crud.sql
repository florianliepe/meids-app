BEGIN;

ALTER TABLE twin.twin
  ADD COLUMN IF NOT EXISTS profile jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE identity.app_user
  ADD COLUMN IF NOT EXISTS active_twin_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_user_active_twin_id_fkey'
      AND conrelid = 'identity.app_user'::regclass
  ) THEN
    ALTER TABLE identity.app_user
      ADD CONSTRAINT app_user_active_twin_id_fkey
      FOREIGN KEY (active_twin_id) REFERENCES twin.twin(twin_id) ON DELETE SET NULL;
  END IF;
END
$$;

GRANT UPDATE (active_twin_id) ON identity.app_user TO meids_app_runtime;
GRANT INSERT, UPDATE ON twin.twin TO meids_app_runtime;
GRANT INSERT, UPDATE, DELETE ON twin.user_twin_access TO meids_app_runtime;

COMMIT;
