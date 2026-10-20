BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app_security;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS twin;
CREATE SCHEMA IF NOT EXISTS knowledge;
CREATE SCHEMA IF NOT EXISTS learning;
CREATE SCHEMA IF NOT EXISTS agent;
CREATE SCHEMA IF NOT EXISTS runtime;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE OR REPLACE FUNCTION app_security.setting(name text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting(name, true), '')
$$;

CREATE OR REPLACE FUNCTION app_security.setting_list(name text)
RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN app_security.setting(name) IS NULL THEN ARRAY[]::text[]
    ELSE string_to_array(app_security.setting(name), ',')
  END
$$;

CREATE TABLE IF NOT EXISTS identity.tenant (
  tenant_id text PRIMARY KEY,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.app_user (
  user_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES identity.tenant(tenant_id),
  entra_object_id text NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entra_object_id)
);

CREATE TABLE IF NOT EXISTS identity.security_group (
  group_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES identity.tenant(tenant_id),
  display_name text NOT NULL,
  entra_group_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.user_group (
  tenant_id text NOT NULL REFERENCES identity.tenant(tenant_id),
  user_id text NOT NULL REFERENCES identity.app_user(user_id),
  group_id text NOT NULL REFERENCES identity.security_group(group_id),
  PRIMARY KEY (tenant_id, user_id, group_id)
);

CREATE TABLE IF NOT EXISTS twin.twin (
  twin_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES identity.tenant(tenant_id),
  owner_user_id text NOT NULL REFERENCES identity.app_user(user_id),
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS twin.user_twin_access (
  tenant_id text NOT NULL REFERENCES identity.tenant(tenant_id),
  user_id text NOT NULL REFERENCES identity.app_user(user_id),
  twin_id text NOT NULL REFERENCES twin.twin(twin_id),
  access_role text NOT NULL CHECK (access_role IN ('owner', 'editor', 'reviewer', 'viewer')),
  granted_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, twin_id)
);

CREATE TABLE IF NOT EXISTS knowledge.source (
  source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES identity.tenant(tenant_id),
  owner_user_id text NOT NULL REFERENCES identity.app_user(user_id),
  twin_id text NOT NULL REFERENCES twin.twin(twin_id),
  source_type text NOT NULL,
  blob_uri text,
  repository_ref text,
  checksum text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge.concept (
  concept_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES identity.tenant(tenant_id),
  owner_user_id text NOT NULL REFERENCES identity.app_user(user_id),
  twin_id text NOT NULL REFERENCES twin.twin(twin_id),
  canonical_key text NOT NULL,
  title text NOT NULL,
  visibility_scope text NOT NULL DEFAULT 'private'
    CHECK (visibility_scope IN ('private', 'twin_shared', 'team_shared', 'org_shared')),
  review_state text NOT NULL DEFAULT 'review_needed'
    CHECK (review_state IN ('draft', 'review_needed', 'updated', 'approved', 'rejected', 'archived')),
  current_revision int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, twin_id, canonical_key)
);

CREATE TABLE IF NOT EXISTS knowledge.concept_revision (
  concept_id uuid NOT NULL REFERENCES knowledge.concept(concept_id) ON DELETE CASCADE,
  revision int NOT NULL,
  tenant_id text NOT NULL,
  owner_user_id text NOT NULL,
  twin_id text NOT NULL,
  content jsonb NOT NULL,
  change_reason text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (concept_id, revision)
);

CREATE TABLE IF NOT EXISTS knowledge.evidence (
  evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id uuid NOT NULL REFERENCES knowledge.concept(concept_id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  owner_user_id text NOT NULL,
  twin_id text NOT NULL,
  source_id uuid REFERENCES knowledge.source(source_id),
  citation jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5,4),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge.concept_access_grant (
  grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id uuid NOT NULL REFERENCES knowledge.concept(concept_id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'group')),
  subject_id text NOT NULL,
  permission text NOT NULL DEFAULT 'read' CHECK (permission IN ('read', 'review', 'edit')),
  granted_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (concept_id, subject_type, subject_id, permission)
);

CREATE TABLE IF NOT EXISTS knowledge.chunk (
  chunk_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id uuid NOT NULL REFERENCES knowledge.concept(concept_id) ON DELETE CASCADE,
  revision int NOT NULL,
  tenant_id text NOT NULL,
  owner_user_id text NOT NULL,
  twin_id text NOT NULL,
  chunk_ordinal int NOT NULL,
  chunk_text text NOT NULL,
  search_document_id text NOT NULL UNIQUE,
  acl_version text NOT NULL DEFAULT 'v1',
  indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (concept_id, revision, chunk_ordinal)
);

CREATE TABLE IF NOT EXISTS learning.increment (
  increment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  owner_user_id text NOT NULL,
  twin_id text NOT NULL,
  trace_id text,
  increment_type text NOT NULL,
  summary text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_state text NOT NULL DEFAULT 'review_needed'
    CHECK (review_state IN ('review_needed', 'updated', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning.concept_delta (
  delta_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  increment_id uuid NOT NULL REFERENCES learning.increment(increment_id) ON DELETE CASCADE,
  concept_id uuid REFERENCES knowledge.concept(concept_id),
  operation text NOT NULL CHECK (operation IN ('create', 'update', 'merge', 'relate')),
  delta jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent.agent_release (
  release_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  agent_key text NOT NULL,
  version text NOT NULL,
  system_instruction_ref text NOT NULL,
  workflow_ref text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, agent_key, version)
);

CREATE TABLE IF NOT EXISTS agent.config_assignment (
  assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  release_id uuid NOT NULL REFERENCES agent.agent_release(release_id),
  subject_type text NOT NULL CHECK (subject_type IN ('tenant', 'group', 'user', 'twin')),
  subject_id text NOT NULL,
  priority int NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, release_id, subject_type, subject_id)
);

CREATE TABLE IF NOT EXISTS agent.workflow_binding (
  binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  release_id uuid NOT NULL REFERENCES agent.agent_release(release_id),
  n8n_workflow_id text NOT NULL,
  tool_name text NOT NULL,
  tool_contract_version text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runtime.outbox_event (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit.event (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  actor_user_id text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_twin_access_user ON twin.user_twin_access (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_concept_scope ON knowledge.concept (tenant_id, twin_id, review_state, visibility_scope);
CREATE INDEX IF NOT EXISTS idx_concept_owner ON knowledge.concept (tenant_id, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_grant_subject ON knowledge.concept_access_grant (tenant_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_chunk_concept ON knowledge.chunk (tenant_id, concept_id, revision);
CREATE INDEX IF NOT EXISTS idx_learning_review ON learning.increment (tenant_id, twin_id, review_state);
CREATE INDEX IF NOT EXISTS idx_assignment_subject ON agent.config_assignment (tenant_id, subject_type, subject_id, enabled);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON runtime.outbox_event (status, created_at) WHERE status IN ('pending', 'failed');

CREATE OR REPLACE FUNCTION app_security.can_read_concept(concept_row knowledge.concept)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT concept_row.tenant_id = app_security.setting('app.tenant_id')
    AND (
      concept_row.owner_user_id = app_security.setting('app.user_id')
      OR EXISTS (
        SELECT 1 FROM knowledge.concept_access_grant grant_row
        WHERE grant_row.concept_id = concept_row.concept_id
          AND grant_row.tenant_id = concept_row.tenant_id
          AND grant_row.subject_type = 'user'
          AND grant_row.subject_id = app_security.setting('app.user_id')
      )
      OR (concept_row.visibility_scope = 'twin_shared' AND concept_row.twin_id = ANY(app_security.setting_list('app.allowed_twin_ids')))
      OR (concept_row.visibility_scope = 'team_shared' AND EXISTS (
        SELECT 1 FROM knowledge.concept_access_grant grant_row
        WHERE grant_row.concept_id = concept_row.concept_id
          AND grant_row.tenant_id = concept_row.tenant_id
          AND grant_row.subject_type = 'group'
          AND grant_row.subject_id = ANY(app_security.setting_list('app.group_ids'))
      ))
      OR concept_row.visibility_scope = 'org_shared'
    )
$$;

ALTER TABLE knowledge.concept ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.concept_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.chunk ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.concept_access_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning.increment ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent.agent_release ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent.config_assignment ENABLE ROW LEVEL SECURITY;

CREATE POLICY concept_read ON knowledge.concept FOR SELECT USING (app_security.can_read_concept(concept));
CREATE POLICY concept_write ON knowledge.concept FOR ALL
  USING (tenant_id = app_security.setting('app.tenant_id') AND owner_user_id = app_security.setting('app.user_id'))
  WITH CHECK (tenant_id = app_security.setting('app.tenant_id') AND owner_user_id = app_security.setting('app.user_id'));

CREATE POLICY revision_access ON knowledge.concept_revision FOR ALL
  USING (EXISTS (SELECT 1 FROM knowledge.concept c WHERE c.concept_id = concept_revision.concept_id))
  WITH CHECK (tenant_id = app_security.setting('app.tenant_id') AND owner_user_id = app_security.setting('app.user_id'));
CREATE POLICY evidence_access ON knowledge.evidence FOR ALL
  USING (EXISTS (SELECT 1 FROM knowledge.concept c WHERE c.concept_id = evidence.concept_id))
  WITH CHECK (tenant_id = app_security.setting('app.tenant_id') AND owner_user_id = app_security.setting('app.user_id'));
CREATE POLICY chunk_access ON knowledge.chunk FOR SELECT
  USING (EXISTS (SELECT 1 FROM knowledge.concept c WHERE c.concept_id = chunk.concept_id));
CREATE POLICY chunk_write ON knowledge.chunk FOR ALL
  USING (tenant_id = app_security.setting('app.tenant_id') AND owner_user_id = app_security.setting('app.user_id'))
  WITH CHECK (tenant_id = app_security.setting('app.tenant_id') AND owner_user_id = app_security.setting('app.user_id'));
CREATE POLICY grant_read ON knowledge.concept_access_grant FOR SELECT
  USING (EXISTS (SELECT 1 FROM knowledge.concept c WHERE c.concept_id = concept_access_grant.concept_id));
CREATE POLICY grant_write ON knowledge.concept_access_grant FOR ALL
  USING (tenant_id = app_security.setting('app.tenant_id') AND granted_by = app_security.setting('app.user_id'))
  WITH CHECK (tenant_id = app_security.setting('app.tenant_id') AND granted_by = app_security.setting('app.user_id'));
CREATE POLICY learning_access ON learning.increment FOR ALL
  USING (tenant_id = app_security.setting('app.tenant_id') AND (owner_user_id = app_security.setting('app.user_id') OR twin_id = ANY(app_security.setting_list('app.allowed_twin_ids'))))
  WITH CHECK (tenant_id = app_security.setting('app.tenant_id') AND owner_user_id = app_security.setting('app.user_id'));
CREATE POLICY release_read ON agent.agent_release FOR SELECT
  USING (tenant_id = app_security.setting('app.tenant_id') AND status = 'approved');
CREATE POLICY assignment_read ON agent.config_assignment FOR SELECT
  USING (
    tenant_id = app_security.setting('app.tenant_id') AND enabled AND (
      subject_type = 'tenant'
      OR (subject_type = 'user' AND subject_id = app_security.setting('app.user_id'))
      OR (subject_type = 'twin' AND subject_id = ANY(app_security.setting_list('app.allowed_twin_ids')))
      OR (subject_type = 'group' AND subject_id = ANY(app_security.setting_list('app.group_ids')))
    )
  );

COMMIT;
