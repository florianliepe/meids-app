const crypto = require("node:crypto");

const GRAPH_ALGORITHM_VERSION = "graph-projection-v2";

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function conceptIdFromNodeKey(nodeKey) {
  const match = String(nodeKey || "").match(/^concept:([0-9a-f-]{36})$/i);
  return match?.[1] || null;
}

async function available(client) {
  const result = await client.query("SELECT to_regclass('knowledge.graph_edge') AS graph_edge");
  return Boolean(result.rows[0]?.graph_edge);
}

async function persistGraphProjection(client, mapping, twinId, nodes, edges, modelProvenance = {}) {
  if (!(await available(client))) return { status: "migration_required", persisted: false };
  const projectedAt = new Date().toISOString();
  const inputHash = stableHash({ nodes, edges });

  await client.query(
    "UPDATE knowledge.graph_node SET is_stale = true, updated_at = now() WHERE tenant_id = $1 AND twin_id = $2",
    [mapping.tenant_id, twinId],
  );
  await client.query(
    "UPDATE knowledge.graph_edge SET is_stale = true, updated_at = now() WHERE tenant_id = $1 AND twin_id = $2",
    [mapping.tenant_id, twinId],
  );

  for (const node of nodes) {
    const sourceHash = stableHash(node);
    await client.query(
      `INSERT INTO knowledge.graph_node
        (tenant_id, twin_id, node_key, concept_id, node_type, label, review_state, projection, source_hash, algorithm_version, is_stale, last_projected_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, false, $11)
       ON CONFLICT (tenant_id, twin_id, node_key) DO UPDATE SET
         concept_id = EXCLUDED.concept_id,
         node_type = EXCLUDED.node_type,
         label = EXCLUDED.label,
         review_state = EXCLUDED.review_state,
         projection = EXCLUDED.projection,
         source_hash = EXCLUDED.source_hash,
         algorithm_version = EXCLUDED.algorithm_version,
         is_stale = false,
         last_projected_at = EXCLUDED.last_projected_at,
         updated_at = now()`,
      [mapping.tenant_id, twinId, node.node_key, conceptIdFromNodeKey(node.node_key), node.node_type || "concept", node.title || node.node_key, node.review_state || "candidate", JSON.stringify(node), sourceHash, GRAPH_ALGORITHM_VERSION, projectedAt],
    );
  }

  for (const edge of edges) {
    const sourceHash = stableHash(edge);
    await client.query(
      `INSERT INTO knowledge.graph_edge
        (tenant_id, twin_id, edge_key, source_node_key, target_node_key, relation_type, edge_class, review_state, confidence, evidence_refs, rationale, provenance, score_evidence, source_revision, target_revision, algorithm_version, model_provenance, source_hash, is_stale, last_projected_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13::jsonb, $14, $15, $16, $17::jsonb, $18, false, $19)
       ON CONFLICT (tenant_id, twin_id, edge_key) DO UPDATE SET
         source_node_key = EXCLUDED.source_node_key,
         target_node_key = EXCLUDED.target_node_key,
         relation_type = EXCLUDED.relation_type,
         edge_class = CASE WHEN knowledge.graph_edge.review_state = 'approved' AND knowledge.graph_edge.source_hash = EXCLUDED.source_hash THEN knowledge.graph_edge.edge_class ELSE EXCLUDED.edge_class END,
         review_state = CASE WHEN knowledge.graph_edge.review_state = 'approved' AND knowledge.graph_edge.source_hash = EXCLUDED.source_hash THEN knowledge.graph_edge.review_state ELSE EXCLUDED.review_state END,
         confidence = EXCLUDED.confidence,
         evidence_refs = EXCLUDED.evidence_refs,
         rationale = EXCLUDED.rationale,
         provenance = EXCLUDED.provenance,
         score_evidence = EXCLUDED.score_evidence,
         source_revision = EXCLUDED.source_revision,
         target_revision = EXCLUDED.target_revision,
         algorithm_version = EXCLUDED.algorithm_version,
         model_provenance = EXCLUDED.model_provenance,
         source_hash = EXCLUDED.source_hash,
         is_stale = false,
         last_projected_at = EXCLUDED.last_projected_at,
         updated_at = now()`,
      [mapping.tenant_id, twinId, edge.edge_key, edge.source, edge.target, edge.relation_type, edge.edge_class, edge.review_state, Number(edge.confidence || 0), JSON.stringify(edge.evidence_refs || []), edge.rationale || "", edge.provenance || "derived", JSON.stringify(edge.score_evidence || {}), Number(edge.source_revision || 1), Number(edge.target_revision || 1), GRAPH_ALGORITHM_VERSION, JSON.stringify({ ...modelProvenance, ...(edge.model_provenance || {}) }), sourceHash, projectedAt],
    );
  }

  await client.query(
    `INSERT INTO knowledge.graph_projection_run
      (tenant_id, twin_id, algorithm_version, input_hash, node_count, edge_count, status, details)
     VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7::jsonb)
     ON CONFLICT (tenant_id, twin_id, algorithm_version, input_hash) DO NOTHING`,
    [mapping.tenant_id, twinId, GRAPH_ALGORITHM_VERSION, inputHash, nodes.length, edges.length, JSON.stringify({ projected_at: projectedAt, model_provenance: modelProvenance })],
  );
  return { status: "persisted", persisted: true, algorithm_version: GRAPH_ALGORITHM_VERSION, input_hash: inputHash };
}

async function latestEdgeReviews(client, mapping, twinId, limit = 300) {
  if (!(await available(client))) return null;
  const result = await client.query(
    `WITH all_reviews AS (
       SELECT edge_key, decision, note, actor_user_id, created_at,
         NULLIF(edge_snapshot->>'source_revision', '')::int AS source_revision,
         NULLIF(edge_snapshot->>'target_revision', '')::int AS target_revision
       FROM knowledge.graph_edge_review
       WHERE tenant_id = $1 AND twin_id = $2
       UNION ALL
       SELECT resource_id AS edge_key, details->>'decision' AS decision,
         details->>'note' AS note, actor_user_id, created_at,
         NULLIF(details->>'source_revision', '')::int AS source_revision,
         NULLIF(details->>'target_revision', '')::int AS target_revision
       FROM audit.event
       WHERE tenant_id = $1 AND resource_type = 'knowledge.graph_edge'
         AND action = 'graph.edge.review' AND details->>'twin_id' = $2
     )
     SELECT DISTINCT ON (edge_key)
       edge_key, decision, note, actor_user_id AS reviewed_by, created_at AS reviewed_at,
       source_revision, target_revision
     FROM all_reviews
     ORDER BY edge_key, created_at DESC
     LIMIT $3`,
    [mapping.tenant_id, twinId, Math.min(500, Number(limit) || 300)],
  );
  return result.rows;
}

async function persistEdgeReview(client, mapping, twinId, edge, decision, note) {
  if (!(await available(client))) return false;
  await client.query(
    `INSERT INTO knowledge.graph_edge_review
      (tenant_id, twin_id, edge_key, decision, note, actor_user_id, edge_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [mapping.tenant_id, twinId, edge.edge_key, decision, note || null, mapping.user_id, JSON.stringify(edge)],
  );
  await client.query(
    `UPDATE knowledge.graph_edge SET
       review_state = $4,
       edge_class = CASE WHEN $4 = 'approved' AND edge_class = 'candidate' THEN 'inferred' ELSE edge_class END,
       updated_at = now()
     WHERE tenant_id = $1 AND twin_id = $2 AND edge_key = $3`,
    [mapping.tenant_id, twinId, edge.edge_key, decision === "accepted" ? "approved" : decision],
  );
  return true;
}

module.exports = {
  GRAPH_ALGORITHM_VERSION,
  stableHash,
  persistGraphProjection,
  latestEdgeReviews,
  persistEdgeReview,
};
