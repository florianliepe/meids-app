BEGIN;

ALTER TABLE knowledge.concept
  ADD COLUMN IF NOT EXISTS approved_revision int;

ALTER TABLE knowledge.concept_revision
  ADD COLUMN IF NOT EXISTS blob_uri text,
  ADD COLUMN IF NOT EXISTS checksum text;

ALTER TABLE learning.increment
  ADD COLUMN IF NOT EXISTS blob_uri text;

ALTER TABLE runtime.outbox_event
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text;

ALTER TABLE runtime.outbox_event DROP CONSTRAINT IF EXISTS outbox_event_status_check;
ALTER TABLE runtime.outbox_event
  ADD CONSTRAINT outbox_event_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_dedupe_key
  ON runtime.outbox_event (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

DROP INDEX IF EXISTS runtime.idx_outbox_pending;
CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON runtime.outbox_event (next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS knowledge.review_action (
  review_action_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  concept_id uuid NOT NULL REFERENCES knowledge.concept(concept_id) ON DELETE CASCADE,
  revision int NOT NULL,
  action text NOT NULL CHECK (action IN ('approve', 'reject', 'request_changes')),
  actor_user_id text NOT NULL,
  rationale text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_action_concept
  ON knowledge.review_action (tenant_id, concept_id, revision, created_at DESC);

ALTER TABLE knowledge.source ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning.concept_delta ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.review_action ENABLE ROW LEVEL SECURITY;

CREATE POLICY source_access ON knowledge.source FOR ALL
  USING (
    tenant_id = app_security.setting('app.tenant_id')
    AND (
      owner_user_id = app_security.setting('app.user_id')
      OR twin_id = ANY(app_security.setting_list('app.allowed_twin_ids'))
    )
  )
  WITH CHECK (
    tenant_id = app_security.setting('app.tenant_id')
    AND owner_user_id = app_security.setting('app.user_id')
    AND twin_id = ANY(app_security.setting_list('app.allowed_twin_ids'))
  );

CREATE POLICY concept_delta_access ON learning.concept_delta FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM learning.increment increment_row
      WHERE increment_row.increment_id = concept_delta.increment_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM learning.increment increment_row
      WHERE increment_row.increment_id = concept_delta.increment_id
    )
  );

CREATE POLICY review_action_read ON knowledge.review_action FOR SELECT
  USING (
    tenant_id = app_security.setting('app.tenant_id')
    AND EXISTS (
      SELECT 1 FROM knowledge.concept concept_row
      WHERE concept_row.concept_id = review_action.concept_id
    )
  );

CREATE POLICY review_action_write ON knowledge.review_action FOR INSERT
  WITH CHECK (
    tenant_id = app_security.setting('app.tenant_id')
    AND actor_user_id = app_security.setting('app.user_id')
    AND EXISTS (
      SELECT 1 FROM twin.user_twin_access access
      JOIN knowledge.concept concept_row
        ON concept_row.tenant_id = access.tenant_id
        AND concept_row.twin_id = access.twin_id
      WHERE concept_row.concept_id = review_action.concept_id
        AND access.user_id = app_security.setting('app.user_id')
        AND access.access_role IN ('owner', 'reviewer')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge.review_action TO meids_app_runtime;

COMMIT;
