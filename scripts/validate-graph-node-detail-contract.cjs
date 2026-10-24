const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  graphConceptId,
  conceptGraphNode,
  graphConceptEvidence,
} = require("../backend/workspaceApi");

const root = path.join(__dirname, "..");
const workspaceApi = fs.readFileSync(path.join(root, "backend", "workspaceApi.js"), "utf8");
const frontend = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");
const conceptId = "01dad037-c16c-42b4-9883-91908ac0446d";

assert.equal(graphConceptId(`concept:${conceptId}`), conceptId);
assert.equal(graphConceptId(conceptId), "");
assert.equal(graphConceptId("source:untrusted"), "");

const concept = {
  concept_id: conceptId,
  path: conceptId,
  title: "Foundations for HR departments",
  summary: "A reviewed knowledge increment.",
  review_state: "approved",
  type: "OKF Concept",
  tags: ["hr"],
  source_anchor: "blob://source/document.pdf",
  source_refs: [{ title: "document.pdf", evidence_path: "blob://source/document.pdf", review_state: "approved" }],
};
const node = conceptGraphNode(concept);
assert.equal(node.node_key, `concept:${conceptId}`);
assert.equal(node.actor_readiness, "ready");
assert.equal(node.okf_path, conceptId);

const evidence = graphConceptEvidence(concept);
assert.equal(evidence.length, 1);
assert.equal(evidence[0].path, "blob://source/document.pdf");
assert.equal(evidence[0].review_state, "approved");

assert.match(workspaceApi, /GET \/api\/okf\/graph\/node/);
assert.match(workspaceApi, /graphNodeDetail[\s\S]*queryConcepts\(pool, mapping, twinId, conceptId\)/);
assert.match(workspaceApi, /graphNodeDetail[\s\S]*assertTwin\(mapping, url\.searchParams\.get\("twin"\)\)/);
assert.match(frontend, /Live detail is temporarily unavailable\. Showing the loaded graph snapshot\./);

console.log("Graph node detail contract validation passed.");
