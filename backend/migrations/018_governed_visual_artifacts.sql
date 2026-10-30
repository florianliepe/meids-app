BEGIN;

CREATE TABLE IF NOT EXISTS knowledge.source_artifact (
  artifact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES identity.tenant(tenant_id),
  owner_user_id text NOT NULL REFERENCES identity.app_user(user_id),
  twin_id text NOT NULL REFERENCES twin.twin(twin_id),
  concept_id uuid REFERENCES knowledge.concept(concept_id) ON DELETE SET NULL,
  filename text NOT NULL,
  media_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL,
  blob_uri text NOT NULL,
  artifact_kind text NOT NULL DEFAULT 'source_visual'
    CHECK (artifact_kind IN ('source_document', 'source_visual')),
  review_state text NOT NULL DEFAULT 'review_needed'
    CHECK (review_state IN ('review_needed', 'approved', 'rejected')),
  visibility_scope text NOT NULL DEFAULT 'private'
    CHECK (visibility_scope IN ('private', 'twin_shared', 'team_shared', 'org_shared')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_artifact_concept
  ON knowledge.source_artifact (tenant_id, concept_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_artifact_twin_review
  ON knowledge.source_artifact (tenant_id, twin_id, review_state, created_at DESC);

ALTER TABLE knowledge.source_artifact ENABLE ROW LEVEL SECURITY;

CREATE POLICY source_artifact_read ON knowledge.source_artifact FOR SELECT
  USING (
    tenant_id = app_security.setting('app.tenant_id')
    AND (
      owner_user_id = app_security.setting('app.user_id')
      OR twin_id = ANY(app_security.setting_list('app.allowed_twin_ids'))
    )
  );

CREATE POLICY source_artifact_write ON knowledge.source_artifact FOR INSERT
  WITH CHECK (
    tenant_id = app_security.setting('app.tenant_id')
    AND owner_user_id = app_security.setting('app.user_id')
    AND twin_id = ANY(app_security.setting_list('app.allowed_twin_ids'))
  );

CREATE POLICY source_artifact_update ON knowledge.source_artifact FOR UPDATE
  USING (
    tenant_id = app_security.setting('app.tenant_id')
    AND twin_id = ANY(app_security.setting_list('app.allowed_twin_ids'))
  )
  WITH CHECK (
    tenant_id = app_security.setting('app.tenant_id')
    AND twin_id = ANY(app_security.setting_list('app.allowed_twin_ids'))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge.source_artifact TO meids_app_runtime;

COMMIT;
