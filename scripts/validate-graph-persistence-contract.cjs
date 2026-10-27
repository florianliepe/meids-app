const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { stableHash, GRAPH_ALGORITHM_VERSION } = require("../backend/graphPersistence");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "backend", "migrations", "016_durable_knowledge_graph.sql"), "utf8");
const persistence = fs.readFileSync(path.join(root, "backend", "graphPersistence.js"), "utf8");
const workspace = fs.readFileSync(path.join(root, "backend", "workspaceApi.js"), "utf8");

for (const marker of [
  "CREATE TABLE IF NOT EXISTS knowledge.graph_node",
  "CREATE TABLE IF NOT EXISTS knowledge.graph_edge",
  "CREATE TABLE IF NOT EXISTS knowledge.graph_edge_review",
  "CREATE TABLE IF NOT EXISTS knowledge.graph_projection_run",
  "ENABLE ROW LEVEL SECURITY",
  "app.allowed_twin_ids",
]) assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

assert.match(persistence, /UPDATE knowledge\.graph_edge SET is_stale = true/);
assert.match(persistence, /ON CONFLICT \(tenant_id, twin_id, edge_key\) DO UPDATE/);
assert.match(persistence, /model_provenance/);
assert.match(persistence, /source_revision/);
assert.match(persistence, /source_hash = EXCLUDED\.source_hash/);
assert.match(persistence, /review_state = 'approved'/);
assert.match(persistence, /FROM audit\.event/);
assert.match(workspace, /persistGraphProjection/);
assert.match(workspace, /persistEdgeReview/);
assert.match(workspace, /access_role IN \('owner', 'reviewer'\)/);
assert.equal(GRAPH_ALGORITHM_VERSION, "graph-projection-v2");
assert.equal(stableHash({ a: 1 }), stableHash({ a: 1 }));
assert.notEqual(stableHash({ a: 1 }), stableHash({ a: 2 }));

process.stdout.write("graph persistence contract validation passed\n");
