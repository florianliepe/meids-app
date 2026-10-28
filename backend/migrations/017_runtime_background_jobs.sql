BEGIN;

CREATE TABLE IF NOT EXISTS runtime.background_job (
  job_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  actor_user_id text NOT NULL,
  twin_id text NOT NULL,
  job_type text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  binary_payload bytea,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts int NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 12),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  leased_at timestamptz,
  lease_expires_at timestamptz,
  leased_by text,
  result jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_background_job_claim
  ON runtime.background_job (next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_background_job_stale_lease
  ON runtime.background_job (lease_expires_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_background_job_owner
  ON runtime.background_job (tenant_id, actor_user_id, twin_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON runtime.background_job TO meids_app_runtime;

COMMIT;
