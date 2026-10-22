BEGIN;

CREATE TABLE IF NOT EXISTS agent.skill_spec (
  skill_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES identity.tenant(tenant_id),
  owner_user_id text NOT NULL REFERENCES identity.app_user(user_id),
  twin_id text NOT NULL REFERENCES twin.twin(twin_id),
  name text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'archived')),
  risk_class text NOT NULL DEFAULT 'medium'
    CHECK (risk_class IN ('low', 'medium', 'high', 'critical')),
  version text NOT NULL DEFAULT '0.1.0',
  spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, twin_id, name)
);

CREATE TABLE IF NOT EXISTS runtime.voice_concept_draft (
  draft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES identity.tenant(tenant_id),
  owner_user_id text NOT NULL REFERENCES identity.app_user(user_id),
  twin_id text NOT NULL REFERENCES twin.twin(twin_id),
  transcript text NOT NULL,
  category text NOT NULL,
  replies jsonb NOT NULL DEFAULT '[]'::jsonb,
  question_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  assessment jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_spec_scope
  ON agent.skill_spec (tenant_id, twin_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_concept_draft_scope
  ON runtime.voice_concept_draft (tenant_id, twin_id, owner_user_id, updated_at DESC);

ALTER TABLE agent.skill_spec ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime.voice_concept_draft ENABLE ROW LEVEL SECURITY;

CREATE POLICY skill_spec_access ON agent.skill_spec FOR ALL
  USING (
    tenant_id = app_security.setting('app.tenant_id')
    AND twin_id = ANY(app_security.setting_list('app.allowed_twin_ids'))
  )
  WITH CHECK (
    tenant_id = app_security.setting('app.tenant_id')
    AND owner_user_id = app_security.setting('app.user_id')
    AND twin_id = ANY(app_security.setting_list('app.allowed_twin_ids'))
  );

CREATE POLICY voice_concept_draft_access ON runtime.voice_concept_draft FOR ALL
  USING (
    tenant_id = app_security.setting('app.tenant_id')
    AND owner_user_id = app_security.setting('app.user_id')
    AND twin_id = ANY(app_security.setting_list('app.allowed_twin_ids'))
  )
  WITH CHECK (
    tenant_id = app_security.setting('app.tenant_id')
    AND owner_user_id = app_security.setting('app.user_id')
    AND twin_id = ANY(app_security.setting_list('app.allowed_twin_ids'))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON agent.skill_spec TO meids_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON runtime.voice_concept_draft TO meids_app_runtime;

COMMIT;
