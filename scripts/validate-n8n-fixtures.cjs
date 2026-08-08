const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const fixtureDir = path.join(root, "contracts", "n8n", "fixtures");
const requiredAgents = ["actor_twin", "knowledge_fabric_agent", "agentic_butler"];
const requiredSections = ["request", "response", "approval_required", "failure"];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fail(message) {
  throw new Error(message);
}

function assertEnvelope(sectionName, envelope, agentId) {
  if (!envelope || typeof envelope !== "object") fail(`${agentId}.${sectionName} is missing`);
  if (envelope.agent_id !== agentId) fail(`${agentId}.${sectionName}.agent_id mismatch`);
  if (!envelope.envelope_version) fail(`${agentId}.${sectionName}.envelope_version missing`);
  if (!envelope.request_id) fail(`${agentId}.${sectionName}.request_id missing`);
}

function validateFixture(file) {
  const fixture = readJson(file);
  if (!requiredAgents.includes(fixture.agent_id)) fail(`${file}: unknown agent_id ${fixture.agent_id}`);
  if (!fixture.contract_version) fail(`${fixture.agent_id}: contract_version missing`);
  for (const section of requiredSections) {
    assertEnvelope(section, fixture[section], fixture.agent_id);
  }
  if (!fixture.request.intent) fail(`${fixture.agent_id}: request.intent missing`);
  if (!fixture.request.principal?.twin_id) fail(`${fixture.agent_id}: request.principal.twin_id missing`);
  if (!fixture.request.input || typeof fixture.request.input !== "object") fail(`${fixture.agent_id}: request.input missing`);
  if (typeof fixture.request.approval?.required !== "boolean") {
    fail(`${fixture.agent_id}: request.approval.required boolean missing`);
  }
  if (fixture.response.status !== "completed") fail(`${fixture.agent_id}: response.status must be completed`);
  if (!fixture.response.output || typeof fixture.response.output !== "object") fail(`${fixture.agent_id}: response.output missing`);
  if (!fixture.response.trace?.trace_id) fail(`${fixture.agent_id}: response.trace.trace_id missing`);
  if (fixture.approval_required.status !== "approval_required") {
    fail(`${fixture.agent_id}: approval_required.status must be approval_required`);
  }
  if (fixture.approval_required.approval?.required !== true) {
    fail(`${fixture.agent_id}: approval_required.approval.required must be true`);
  }
  if (!fixture.approval_required.approval?.gate) fail(`${fixture.agent_id}: approval_required.approval.gate missing`);
  if (!fixture.approval_required.approval?.proposed_action) {
    fail(`${fixture.agent_id}: approval_required.approval.proposed_action missing`);
  }
  if (fixture.failure.status !== "failed") fail(`${fixture.agent_id}: failure.status must be failed`);
  if (!fixture.failure.error?.code) fail(`${fixture.agent_id}: failure.error.code missing`);
  if (!fixture.failure.error?.message) fail(`${fixture.agent_id}: failure.error.message missing`);
  if (typeof fixture.failure.error?.recoverable !== "boolean") {
    fail(`${fixture.agent_id}: failure.error.recoverable boolean missing`);
  }
  return fixture.agent_id;
}

const files = fs.readdirSync(fixtureDir).filter((file) => file.endsWith(".json"));
const seen = new Set(files.map((file) => validateFixture(path.join(fixtureDir, file))));
const missing = requiredAgents.filter((agent) => !seen.has(agent));
if (missing.length) fail(`Missing fixtures: ${missing.join(", ")}`);

console.log(`n8n fixture validation passed: ${files.length} fixtures, ${files.length * requiredSections.length} replay cases`);
