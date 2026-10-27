const assert = require("node:assert/strict");
const {
  GRAPH_ALGORITHM_VERSION,
  persistGraphProjection,
  persistEdgeReview,
} = require("../backend/graphPersistence");

function fakeClient() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (/to_regclass/.test(sql)) return { rows: [{ graph_edge: "knowledge.graph_edge" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
}

async function main() {
  const client = fakeClient();
  const mapping = { tenant_id: "tenant-a", user_id: "reviewer-a", allowed_twin_ids: ["twin-a"] };
  const nodes = [
    { node_key: "concept:11111111-1111-4111-8111-111111111111", node_type: "concept", title: "Source", review_state: "approved" },
    { node_key: "concept:22222222-2222-4222-8222-222222222222", node_type: "concept", title: "Target", review_state: "approved" },
  ];
  const edges = [{
    edge_key: "edge:test",
    source: nodes[0].node_key,
    target: nodes[1].node_key,
    relation_type: "requires",
    edge_class: "candidate",
    review_state: "candidate",
    confidence: 0.8,
    evidence_refs: ["source:paragraph-4"],
    rationale: "Evidence-backed prerequisite.",
    provenance: "semantic-relation-proposer",
    source_revision: 2,
    target_revision: 3,
    model_provenance: { model: "test-model", prompt_version: "v1" },
  }];
  const result = await persistGraphProjection(client, mapping, "twin-a", nodes, edges, { embedding_model: "embedding-test" });
  assert.equal(result.persisted, true);
  assert.equal(result.algorithm_version, GRAPH_ALGORITHM_VERSION);

  const mutations = client.calls.filter((call) => /knowledge\.graph_(node|edge|projection_run)/.test(call.sql));
  assert.ok(mutations.length >= 6);
  for (const call of mutations) {
    if (call.params.length) {
      assert.equal(call.params[0], "tenant-a", "Every graph mutation must bind authenticated tenant first.");
      assert.equal(call.params[1], "twin-a", "Every graph mutation must bind validated twin second.");
    }
  }
  const edgeInsert = client.calls.find((call) => /INSERT INTO knowledge\.graph_edge\s/.test(call.sql));
  assert.ok(edgeInsert);
  assert.match(edgeInsert.sql, /source_hash = EXCLUDED\.source_hash/);
  assert.equal(edgeInsert.params[13], 2);
  assert.equal(edgeInsert.params[14], 3);
  assert.match(JSON.stringify(edgeInsert.params), /test-model/);

  await persistEdgeReview(client, mapping, "twin-a", edges[0], "accepted", "Reviewed evidence.");
  const reviewInsert = client.calls.find((call) => /INSERT INTO knowledge\.graph_edge_review/.test(call.sql));
  assert.ok(reviewInsert);
  assert.equal(reviewInsert.params[0], "tenant-a");
  assert.equal(reviewInsert.params[1], "twin-a");
  assert.equal(reviewInsert.params[5], "reviewer-a");
  assert.match(reviewInsert.params[6], /source_revision/);

  process.stdout.write("graph persistence behavioral test passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
