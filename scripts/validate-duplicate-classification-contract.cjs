const assert = require("node:assert/strict");
const { classifyDuplicateCandidate, summarizeDuplicateHit } = require("../backend/server");

assert.equal(classifyDuplicateCandidate({
  vectorScore: 0.93,
  lexicalScore: 0.18,
  scopeCompatible: true,
}).status, "near_match", "High vector similarity alone must not create a strong duplicate.");

assert.equal(classifyDuplicateCandidate({
  vectorScore: 0.93,
  lexicalScore: 0.42,
  scopeCompatible: true,
}).status, "strong_duplicate");

assert.equal(classifyDuplicateCandidate({
  vectorScore: 0.93,
  lexicalScore: 0.42,
  scopeCompatible: false,
}).status, "near_match", "A scope mismatch must block automatic strong-duplicate classification.");

assert.equal(classifyDuplicateCandidate({
  vectorScore: 0.65,
  lexicalScore: 0.1,
  scopeCompatible: true,
}).status, "related_only");

const summarized = summarizeDuplicateHit(
  { title: "Ownership routing rule", summary: "Preserve tenant and twin ownership." },
  { "@search.score": 0.8, title: "Unrelated retention probe", summary: "Synthetic persistence test." },
);
assert.equal(summarized.scores.raw_vector_search_score, 0.8);
assert.equal(summarized.scores.vector_similarity, 0.75);
assert.notEqual(summarized.classification, "strong_duplicate");

console.log("Duplicate classification contract validation passed.");
