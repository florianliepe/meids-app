const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const schemaPath = path.join(root, "contracts", "n8n", "schemas", "agent-response.schema.json");
const exampleDir = path.join(root, "contracts", "n8n", "adapter-examples");
const allowedAgents = new Set(["actor_twin", "knowledge_fabric_agent", "agentic_butler"]);
const allowedStatuses = new Set(["completed", "approval_required", "failed"]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fail(message) {
  throw new Error(message);
}

function hasObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertString(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string`);
}

function validateSchemaArtifact(schema) {
  if (schema.title !== "MeIDs n8n Agent Response") fail("schema title mismatch");
  const agentEnum = schema.properties?.agent_id?.enum || [];
  const statusEnum = schema.properties?.status?.enum || [];
  for (const agent of allowedAgents) {
    if (!agentEnum.includes(agent)) fail(`schema missing agent enum: ${agent}`);
  }
  for (const status of allowedStatuses) {
    if (!statusEnum.includes(status)) fail(`schema missing status enum: ${status}`);
  }
}

function validateTrace(response, label) {
  if (!hasObject(response.trace)) fail(`${label}: trace missing`);
  if (response.trace.stored !== true) fail(`${label}: trace.stored must be true`);
  assertString(response.trace.trace_id, `${label}: trace.trace_id`);
  if (!Array.isArray(response.trace.used_agents) || !response.trace.used_agents.length) {
    fail(`${label}: trace.used_agents must be a non-empty array`);
  }
}

function validateApproval(response, label) {
  if (!hasObject(response.approval)) fail(`${label}: approval missing`);
  if (response.approval.required !== true) fail(`${label}: approval.required must be true`);
  assertString(response.approval.gate, `${label}: approval.gate`);
  assertString(response.approval.summary, `${label}: approval.summary`);
  assertString(response.approval.proposed_action, `${label}: approval.proposed_action`);
}

function validateFailure(response, label) {
  if (!hasObject(response.error)) fail(`${label}: error missing`);
  assertString(response.error.code, `${label}: error.code`);
  assertString(response.error.message, `${label}: error.message`);
  if (typeof response.error.recoverable !== "boolean") fail(`${label}: error.recoverable must be boolean`);
}

function validateKnowledgeFabricOutput(response, label) {
  const output = response.output || {};
  if (output.review_state && !["pending_review", "pending-review"].includes(output.review_state)) {
    fail(`${label}: Knowledge Fabric adapter must keep generated concepts pending review`);
  }
  if (output.vector_refresh && !["deferred", "blocked"].includes(output.vector_refresh.status)) {
    fail(`${label}: Knowledge Fabric vector refresh must be deferred or blocked before approval`);
  }
  if (Array.isArray(output.candidate_edges)) {
    output.candidate_edges.forEach((edge, index) => {
      assertString(edge.source, `${label}: candidate_edges[${index}].source`);
      assertString(edge.target, `${label}: candidate_edges[${index}].target`);
      assertString(edge.relation_type, `${label}: candidate_edges[${index}].relation_type`);
      if (typeof edge.confidence !== "number" || edge.confidence < 0 || edge.confidence > 1) {
        fail(`${label}: candidate_edges[${index}].confidence must be 0..1`);
      }
    });
  }
}

function validateAgenticButlerOutput(response, label) {
  if (response.status === "completed") return;
  if (response.status === "approval_required" && response.agent_id === "agentic_butler") {
    const proposed = response.approval?.proposed_action || "";
    if (!/pause|approval|approve|before/i.test(proposed)) {
      fail(`${label}: Agentic Butler approval action must explicitly pause for human approval`);
    }
  }
}

function validateResponse(file) {
  const response = readJson(file);
  const label = path.relative(root, file).replaceAll("\\", "/");
  assertString(response.envelope_version, `${label}: envelope_version`);
  assertString(response.request_id, `${label}: request_id`);
  if (!allowedAgents.has(response.agent_id)) fail(`${label}: unknown agent_id ${response.agent_id}`);
  if (!allowedStatuses.has(response.status)) fail(`${label}: unknown status ${response.status}`);

  if (response.status === "completed") {
    if (!hasObject(response.output)) fail(`${label}: completed response.output missing`);
    validateTrace(response, label);
  }
  if (response.status === "approval_required") {
    validateApproval(response, label);
    validateTrace(response, label);
  }
  if (response.status === "failed") validateFailure(response, label);
  if (response.agent_id === "knowledge_fabric_agent") validateKnowledgeFabricOutput(response, label);
  if (response.agent_id === "agentic_butler") validateAgenticButlerOutput(response, label);
  return { file: label, agent_id: response.agent_id, status: response.status };
}

const schema = readJson(schemaPath);
validateSchemaArtifact(schema);

const files = fs
  .readdirSync(exampleDir)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => path.join(exampleDir, file));

if (files.length < 4) fail("expected at least four n8n adapter examples");

const results = files.map(validateResponse);
const statusSet = new Set(results.map((result) => result.status));
for (const status of allowedStatuses) {
  if (!statusSet.has(status)) fail(`adapter examples missing status: ${status}`);
}

console.log(`n8n response adapter validation passed: ${results.length} examples`);
