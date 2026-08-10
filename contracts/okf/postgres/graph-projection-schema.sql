-- MeIDs OKF graph projection schema
-- Status: public-safe design contract, not an executed migration.
-- Purpose: mirror approved and reviewable OKF Markdown/YAML graph files into
-- queryable Postgres tables without making Postgres the authoring source of truth.

create schema if not exists meids_okf;

create table if not exists meids_okf.graph_nodes (
  id bigserial primary key,
  node_key text not null,
  twin_id text not null,
  label text not null,
  node_type text not null,
  review_state text not null,
  concept_refs jsonb not null default '[]'::jsonb,
  source_path text not null,
  source_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint graph_nodes_node_key_unique unique (twin_id, node_key),
  constraint graph_nodes_review_state_check check (
    review_state in ('draft', 'candidate', 'pending-review', 'approved', 'needs-rework', 'rejected', 'retired')
  ),
  constraint graph_nodes_node_type_check check (
    node_type in ('cluster', 'concept', 'skill', 'task', 'person', 'project', 'risk', 'decision')
  )
);

create table if not exists meids_okf.graph_edges (
  id bigserial primary key,
  edge_key text not null,
  twin_id text not null,
  from_node_key text not null,
  to_node_key text not null,
  relation text not null,
  edge_class text not null,
  review_state text not null,
  confidence numeric(4,3) not null,
  evidence_refs jsonb not null default '[]'::jsonb,
  rationale text,
  source_path text not null,
  source_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint graph_edges_edge_key_unique unique (twin_id, edge_key),
  constraint graph_edges_from_node_fk foreign key (twin_id, from_node_key)
    references meids_okf.graph_nodes (twin_id, node_key),
  constraint graph_edges_to_node_fk foreign key (twin_id, to_node_key)
    references meids_okf.graph_nodes (twin_id, node_key),
  constraint graph_edges_review_state_check check (
    review_state in ('draft', 'candidate', 'pending-review', 'approved', 'needs-rework', 'rejected', 'retired')
  ),
  constraint graph_edges_relation_check check (
    relation in ('supports', 'contradicts', 'requires', 'similar_to', 'causes', 'evidence_for', 'uses_skill')
  ),
  constraint graph_edges_edge_class_check check (
    edge_class in ('explicit', 'inferred', 'candidate', 'duplicate-candidate', 'contradiction-candidate')
  ),
  constraint graph_edges_confidence_check check (confidence >= 0 and confidence <= 1)
);

create table if not exists meids_okf.graph_promotions (
  id bigserial primary key,
  promotion_id text not null unique,
  twin_id text not null,
  edge_key text not null,
  decision text not null,
  from_state text not null,
  to_review_state text not null,
  to_edge_class text not null,
  reviewer text,
  rationale text,
  evidence_refs jsonb not null default '[]'::jsonb,
  effects jsonb not null default '{}'::jsonb,
  promotion_path text not null,
  promotion_hash text not null,
  decided_at timestamptz not null default now(),
  constraint graph_promotions_edge_fk foreign key (twin_id, edge_key)
    references meids_okf.graph_edges (twin_id, edge_key),
  constraint graph_promotions_decision_check check (
    decision in ('approve', 'reject', 'needs-rework')
  ),
  constraint graph_promotions_state_check check (
    from_state = 'candidate'
    and to_review_state in ('approved', 'rejected', 'needs-rework')
  )
);

create table if not exists meids_okf.graph_projection_runs (
  id bigserial primary key,
  run_id text not null unique,
  twin_id text not null,
  source_repo text not null,
  source_branch text not null,
  source_commit_sha text not null,
  operation text not null,
  status text not null,
  node_count integer not null default 0,
  edge_count integer not null default 0,
  promotion_count integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  errors jsonb not null default '[]'::jsonb,
  constraint graph_projection_runs_operation_check check (
    operation in ('dry_run', 'upsert_projection', 'delete_projection', 'validate_only')
  ),
  constraint graph_projection_runs_status_check check (
    status in ('queued', 'running', 'passed', 'failed', 'blocked')
  )
);

create index if not exists graph_nodes_twin_review_idx
  on meids_okf.graph_nodes (twin_id, review_state, node_type);

create index if not exists graph_edges_twin_review_idx
  on meids_okf.graph_edges (twin_id, review_state, edge_class, relation);

create index if not exists graph_edges_from_idx
  on meids_okf.graph_edges (twin_id, from_node_key);

create index if not exists graph_edges_to_idx
  on meids_okf.graph_edges (twin_id, to_node_key);

create index if not exists graph_promotions_edge_idx
  on meids_okf.graph_promotions (twin_id, edge_key, decision);

create view if not exists meids_okf.trusted_graph_edges as
select
  edge_key,
  twin_id,
  from_node_key,
  to_node_key,
  relation,
  edge_class,
  confidence,
  evidence_refs,
  source_path,
  updated_at
from meids_okf.graph_edges
where review_state = 'approved'
  and edge_class in ('explicit', 'inferred')
  and jsonb_array_length(evidence_refs) > 0;

create view if not exists meids_okf.reviewable_graph_edges as
select
  edge_key,
  twin_id,
  from_node_key,
  to_node_key,
  relation,
  edge_class,
  review_state,
  confidence,
  evidence_refs,
  rationale,
  source_path,
  updated_at
from meids_okf.graph_edges
where review_state in ('candidate', 'pending-review', 'needs-rework');
