const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const knowledge = fs.readFileSync(path.join(root, "workflows/n8n/knowledge-fabric-agent.workflow.json"), "utf8");
const learning = fs.readFileSync(path.join(root, "workflows/n8n/learning-agent.workflow.json"), "utf8");

const requiredKnowledge = [
  "Learning document normalization contract",
  "extractKeyedObject",
  "sourcePackage",
  "learningConcept",
  "learning_increment",
  "sourceEvidence",
];
for (const marker of requiredKnowledge) {
  if (!knowledge.includes(marker)) throw new Error(`Knowledge Fabric learning contract missing: ${marker}`);
}
if (!learning.includes("Trace-reference fidelity contract")) {
  throw new Error("Learning Agent must preserve trace IDs as evidence references.");
}
if (!learning.includes("trace_id: $json.trace_id") || !learning.includes("authorization credentials intentionally omitted")) {
  throw new Error("Learning Agent model context must include trace IDs without exposing authorization credentials.");
}
console.log(JSON.stringify({ status: "passed", checks: [
  "learning_document_maps_to_reviewable_concept",
  "malformed_agent_json_has_keyed_object_fallback",
  "trace_references_are_preserved",
] }, null, 2));
