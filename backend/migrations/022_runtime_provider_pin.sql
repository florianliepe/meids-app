BEGIN;

ALTER TABLE runtime.background_job
  ADD COLUMN IF NOT EXISTS runtime_provider text;

UPDATE runtime.background_job
SET runtime_provider = CASE
  WHEN payload ->> 'runtime_provider' IN ('n8n', 'azure_native')
    THEN payload ->> 'runtime_provider'
  WHEN created_at < timestamptz '2026-11-12T16:27:00Z'
    THEN 'n8n'
  ELSE 'azure_native'
END
WHERE runtime_provider IS NULL;

UPDATE runtime.background_job
SET status = 'dead_letter',
    result = jsonb_build_object(
      'status', 'blocked',
      'code', 'runtime_provider_missing_before_pin_migration',
      'retryable', false,
      'reconciliation_required', true
    ),
    last_error = 'Legacy nonterminal job had no persisted runtime provider and was not dispatched.',
    completed_at = now(),
    leased_at = NULL,
    lease_expires_at = NULL,
    leased_by = NULL,
    binary_payload = NULL,
    updated_at = now()
WHERE status IN ('pending', 'failed', 'processing')
  AND NOT (payload ->> 'runtime_provider' IN ('n8n', 'azure_native'));

ALTER TABLE runtime.background_job
  ALTER COLUMN runtime_provider SET NOT NULL;

ALTER TABLE runtime.background_job
  DROP CONSTRAINT IF EXISTS background_job_runtime_provider_check;

ALTER TABLE runtime.background_job
  ADD CONSTRAINT background_job_runtime_provider_check
  CHECK (runtime_provider IN ('n8n', 'azure_native'));

CREATE OR REPLACE FUNCTION runtime.prevent_background_job_runtime_provider_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.runtime_provider IS DISTINCT FROM OLD.runtime_provider THEN
    RAISE EXCEPTION 'runtime_provider is immutable for background job %', OLD.job_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS background_job_runtime_provider_immutable
  ON runtime.background_job;

CREATE TRIGGER background_job_runtime_provider_immutable
BEFORE UPDATE OF runtime_provider ON runtime.background_job
FOR EACH ROW
EXECUTE FUNCTION runtime.prevent_background_job_runtime_provider_update();

COMMIT;
