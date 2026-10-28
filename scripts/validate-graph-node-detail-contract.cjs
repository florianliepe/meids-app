const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  graphConceptId,
  conceptGraphNode,
  graphConceptEvidence,
  deriveGraphEdges,
} = require("../backend/workspaceApi");

const root = path.join(__dirname, "..");
const workspaceApi = fs.readFileSync(path.join(root, "backend", "workspaceApi.js"), "utf8");
const frontendApp = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");
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

const relatedConcept = {
  concept_id: "9af2cd49-f6df-4a52-b1f0-8dd2cb8dc3cb",
  path: "9af2cd49-f6df-4a52-b1f0-8dd2cb8dc3cb",
  title: "HR department operating model",
  summary: "Foundations and operating practices for HR departments.",
  description: "Foundations and operating practices for HR departments.",
  review_state: "pending-review",
  type: "OKF Concept",
  tags: ["hr"],
  source_refs: [{ sha256: "shared-source-hash", evidence_path: "blob://source/shared.pdf" }],
  relations: [],
};
const sourceConcept = {
  ...concept,
  source_refs: [{ sha256: "shared-source-hash", evidence_path: "blob://source/shared.pdf" }],
};
const projectedEdges = deriveGraphEdges([sourceConcept, relatedConcept]);
assert.equal(projectedEdges.length, 1);
assert.equal(projectedEdges[0].relation_type, "similar_to");
assert.equal(projectedEdges[0].edge_class, "inferred");
assert.equal(projectedEdges[0].review_state, "candidate");
assert.equal(projectedEdges[0].source_revision, 1);
assert.equal(projectedEdges[0].target_revision, 1);
assert.match(projectedEdges[0].rationale, /same governed evidence anchor/i);

const reviewedEdges = deriveGraphEdges([sourceConcept, relatedConcept], [{
  edge_key: projectedEdges[0].edge_key,
  decision: "accepted",
  note: "Confirmed during UAT.",
}]);
assert.equal(reviewedEdges[0].review_state, "approved");
assert.equal(reviewedEdges[0].edge_class, "inferred");

const invalidatedReview = deriveGraphEdges(
  [{ ...sourceConcept, revision: 2 }, { ...relatedConcept, revision: 1 }],
  [{
    edge_key: projectedEdges[0].edge_key,
    decision: "accepted",
    source_revision: 1,
    target_revision: 1,
  }],
)[0];
assert.equal(invalidatedReview.review_state, "candidate");
assert.equal(invalidatedReview.review_invalidated, "concept_revision_changed");

const explicitSource = {
  ...concept,
  relations: [{ target_concept_id: relatedConcept.concept_id, relation_type: "supports", confidence: 0.91 }],
};
const explicitEdges = deriveGraphEdges([explicitSource, { ...relatedConcept, tags: [], source_refs: [] }]);
const explicitEdge = explicitEdges.find((edge) => edge.relation_type === "supports" && edge.edge_class === "explicit");
assert.ok(explicitEdge);
assert.equal(explicitEdge.source, `concept:${conceptId}`);
assert.equal(explicitEdge.target, `concept:${relatedConcept.concept_id}`);

const semanticSource = {
  ...concept,
  source_refs: [{
    type: "merge_candidate_score",
    concept_id: relatedConcept.concept_id,
    classification: "near_match",
    vector_similarity: 0.91,
    lexical_overlap: 0.22,
    graph_proximity: 0,
    scope_compatible: true,
  }],
};
const semanticEdges = deriveGraphEdges([semanticSource, { ...relatedConcept, tags: [], source_refs: [] }]);
const semanticEdge = semanticEdges.find((edge) => edge.provenance === "semantic-duplicate-check");
assert.ok(semanticEdge);
assert.equal(semanticEdge.review_state, "candidate");
assert.equal(semanticEdge.score_evidence.vector_similarity, 0.91);

const proposedSource = {
  ...concept,
  source_refs: [{
    type: "semantic_relation_proposal",
    target_concept_id: relatedConcept.concept_id,
    relation_type: "requires",
    confidence: 0.93,
    evidence_refs: ["source:paragraph-4"],
    rationale: "The source explicitly identifies the target as a prerequisite.",
    model_provenance: { model: "test-model", prompt_version: "v1" },
  }],
};
const proposedEdge = deriveGraphEdges([proposedSource, { ...relatedConcept, tags: [], source_refs: [] }])
  .find((edge) => edge.provenance === "semantic-relation-proposer");
assert.ok(proposedEdge, "Evidence-backed semantic relation proposal must project a candidate edge.");
assert.equal(proposedEdge.edge_class, "candidate");
assert.equal(proposedEdge.review_state, "candidate");
assert.equal(proposedEdge.relation_type, "requires");
assert.equal(proposedEdge.confidence, 0.85, "Non-deterministic proposal confidence must be capped.");

const unsupportedProposal = deriveGraphEdges([{
  ...proposedSource,
  source_refs: [{ type: "semantic_relation_proposal", target_concept_id: relatedConcept.concept_id, relation_type: "requires", confidence: 0.8 }],
}, relatedConcept]).find((edge) => edge.provenance === "semantic-relation-proposer");
assert.equal(unsupportedProposal, undefined, "Semantic proposals without evidence and rationale must fail closed.");

assert.match(workspaceApi, /GET \/api\/okf\/graph\/node/);
assert.match(workspaceApi, /POST \/api\/okf\/graph\/edge-review/);
assert.doesNotMatch(workspaceApi, /const edges = \[\];/);
assert.match(workspaceApi, /graphNodeDetail[\s\S]*queryConcepts\(pool, mapping, twinId, conceptId\)/);
assert.match(workspaceApi, /graphNodeDetail[\s\S]*assertTwin\(mapping, url\.searchParams\.get\("twin"\)\)/);
assert.match(
  frontendApp,
  /const connectedCandidates = graphEdges[\s\S]*String\(graphEdgeClass\(edge\)\)\.includes\("candidate"\)/,
  "Selected-node quality actions must classify candidates through edge_class, not relation_type.",
);
assert.match(frontend, /Live detail is temporarily unavailable\. Showing the loaded graph snapshot\./);

console.log("Graph node detail contract validation passed.");
