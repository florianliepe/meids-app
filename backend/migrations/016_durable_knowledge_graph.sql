BEGIN;

CREATE TABLE IF NOT EXISTS knowledge.graph_node (
  tenant_id text NOT NULL,
  twin_id text NOT NULL,
  node_key text NOT NULL,
  concept_id uuid REFERENCES knowledge.concept(concept_id) ON DELETE CASCADE,
  node_type text NOT NULL DEFAULT 'concept',
  label text NOT NULL,
  review_state text NOT NULL,
  projection jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_revision int,
  source_hash text NOT NULL,
  algorithm_version text NOT NULL,
  is_stale boolean NOT NULL DEFAULT false,
  last_projected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, twin_id, node_key)
);

CREATE TABLE IF NOT EXISTS knowledge.graph_edge (
  tenant_id text NOT NULL,
  twin_id text NOT NULL,
  edge_key text NOT NULL,
  source_node_key text NOT NULL,
  target_node_key text NOT NULL,
  relation_type text NOT NULL,
  edge_class text NOT NULL,
  review_state text NOT NULL,
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  rationale text,
  provenance text NOT NULL,
  score_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_revision int,
  target_revision int,
  algorithm_version text NOT NULL,
  model_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_hash text NOT NULL,
  is_stale boolean NOT NULL DEFAULT false,
  last_projected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, twin_id, edge_key),
  FOREIGN KEY (tenant_id, twin_id, source_node_key)
    REFERENCES knowledge.graph_node(tenant_id, twin_id, node_key) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, twin_id, target_node_key)
    REFERENCES knowledge.graph_node(tenant_id, twin_id, node_key) ON DELETE CASCADE,
  CHECK (relation_type IN ('supports', 'contradicts', 'requires', 'similar_to', 'causes', 'evidence_for', 'uses_skill', 'derived_from')),
  CHECK (edge_class IN ('explicit', 'inferred', 'candidate', 'duplicate-candidate', 'contradiction-candidate')),
  CHECK (review_state IN ('candidate', 'pending-review', 'approved', 'needs-rework', 'rejected', 'retired'))
);

CREATE TABLE IF NOT EXISTS knowledge.graph_edge_review (
  review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  twin_id text NOT NULL,
  edge_key text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('accepted', 'rejected', 'needs-rework')),
  note text,
  actor_user_id text NOT NULL,
  edge_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, twin_id, edge_key)
    REFERENCES knowledge.graph_edge(tenant_id, twin_id, edge_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge.graph_projection_run (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  twin_id text NOT NULL,
  algorithm_version text NOT NULL,
  input_hash text NOT NULL,
  node_count int NOT NULL,
  edge_count int NOT NULL,
  status text NOT NULL CHECK (status IN ('completed', 'failed')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, twin_id, algorithm_version, input_hash)
);

CREATE INDEX IF NOT EXISTS idx_graph_edge_scope
  ON knowledge.graph_edge (tenant_id, twin_id, review_state, edge_class, is_stale);
CREATE INDEX IF NOT EXISTS idx_graph_edge_source
  ON knowledge.graph_edge (tenant_id, twin_id, source_node_key);
CREATE INDEX IF NOT EXISTS idx_graph_edge_target
  ON knowledge.graph_edge (tenant_id, twin_id, target_node_key);
CREATE INDEX IF NOT EXISTS idx_graph_review_latest
  ON knowledge.graph_edge_review (tenant_id, twin_id, edge_key, created_at DESC);

ALTER TABLE knowledge.graph_node ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.graph_edge ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.graph_edge_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.graph_projection_run ENABLE ROW LEVEL SECURITY;

CREATE POLICY graph_node_scope ON knowledge.graph_node FOR ALL
  USING (tenant_id = app_security.setting('app.tenant_id') AND twin_id = ANY(app_security.setting_list('app.allowed_twin_ids')))
  WITH CHECK (tenant_id = app_security.setting('app.tenant_id') AND twin_id = ANY(app_security.setting_list('app.allowed_twin_ids')));
CREATE POLICY graph_edge_scope ON knowledge.graph_edge FOR ALL
  USING (tenant_id = app_security.setting('app.tenant_id') AND twin_id = ANY(app_security.setting_list('app.allowed_twin_ids')))
  WITH CHECK (tenant_id = app_security.setting('app.tenant_id') AND twin_id = ANY(app_security.setting_list('app.allowed_twin_ids')));
CREATE POLICY graph_edge_review_scope ON knowledge.graph_edge_review FOR ALL
  USING (tenant_id = app_security.setting('app.tenant_id') AND twin_id = ANY(app_security.setting_list('app.allowed_twin_ids')))
  WITH CHECK (tenant_id = app_security.setting('app.tenant_id') AND twin_id = ANY(app_security.setting_list('app.allowed_twin_ids')) AND actor_user_id = app_security.setting('app.user_id'));
CREATE POLICY graph_projection_run_scope ON knowledge.graph_projection_run FOR ALL
  USING (tenant_id = app_security.setting('app.tenant_id') AND twin_id = ANY(app_security.setting_list('app.allowed_twin_ids')))
  WITH CHECK (tenant_id = app_security.setting('app.tenant_id') AND twin_id = ANY(app_security.setting_list('app.allowed_twin_ids')));

GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge.graph_node TO meids_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge.graph_edge TO meids_app_runtime;
GRANT SELECT, INSERT ON knowledge.graph_edge_review TO meids_app_runtime;
GRANT SELECT, INSERT ON knowledge.graph_projection_run TO meids_app_runtime;

COMMIT;
