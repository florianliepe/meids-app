const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const fixturePath = path.join(root, "contracts", "n8n", "fixtures", "agent-runtime-handoffs.json");

const expectedTargets = {
  answer_direct: "actor_twin",
  retrieve_knowledge: "knowledge_fabric_agent",
  ingest_or_stage_knowledge: "knowledge_fabric_agent",
  activate_skill: "agentic_butler",
  create_skill: "agentic_butler",
};

const expectedIntents = {
  answer_direct: "answer_question",
  retrieve_knowledge: "retrieve_context",
  ingest_or_stage_knowledge: "ingest_concept",
  activate_skill: "activate_skill",
  create_skill: "create_skill",
};

function rel(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function fail(message) {
  throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validateAgentResponse(response, expectedAgentId, label) {
  if (!isObject(response)) fail(`${label} response must be an object`);
  if (response.envelope_version !== "0.1.0") fail(`${label} response envelope_version must be 0.1.0`);
  if (!response.request_id) fail(`${label} response missing request_id`);
  if (response.agent_id !== expectedAgentId) fail(`${label} response agent_id must be ${expectedAgentId}`);
  if (!["completed", "approval_required", "failed"].includes(response.status)) fail(`${label} response has invalid status`);
  if (response.status === "completed" && !isObject(response.output)) fail(`${label} completed response missing output`);
  if (response.status === "approval_required") {
    if (!isObject(response.approval)) fail(`${label} approval response missing approval object`);
    if (response.approval.required !== true) fail(`${label} approval.required must be true`);
    for (const key of ["gate", "summary", "proposed_action"]) {
      if (!response.approval[key]) fail(`${label} approval missing ${key}`);
    }
  }
  if (!isObject(response.trace)) fail(`${label} response missing trace`);
  if (!response.trace.trace_id) fail(`${label} response trace missing trace_id`);
  if (!Array.isArray(response.trace.used_agents)) fail(`${label} response trace missing used_agents[]`);
}

function validateCase(item) {
  if (!item.case_id) fail("runtime handoff case missing case_id");
  if (!item.user_query) fail(`${item.case_id} missing user_query`);
  validateAgentResponse(item.actor_response, "actor_twin", `${item.case_id} actor`);
  const route = item.actor_response.output?.route_decision;
  if (!isObject(route)) fail(`${item.case_id} actor response missing output.route_decision`);
  if (!expectedTargets[route.decision]) fail(`${item.case_id} has unsupported route decision ${route.decision}`);
  if (route.target_agent !== expectedTargets[route.decision]) {
    fail(`${item.case_id} route target must be ${expectedTargets[route.decision]}, got ${route.target_agent}`);
  }
  if (route.intent !== expectedIntents[route.decision]) {
    fail(`${item.case_id} route intent must be ${expectedIntents[route.decision]}, got ${route.intent}`);
  }
  if (typeof route.approval_required !== "boolean") fail(`${item.case_id} route approval_required must be boolean`);
  if (typeof route.handoff_required !== "boolean") fail(`${item.case_id} route handoff_required must be boolean`);
  if (!route.reason) fail(`${item.case_id} route missing reason`);
  const expected = item.expected || {};
  if (expected.target_agent !== route.target_agent) fail(`${item.case_id} expected target mismatch`);
  if (expected.handoff_required !== route.handoff_required) fail(`${item.case_id} expected handoff_required mismatch`);
  if (!route.handoff_required) {
    if (item.target_response) fail(`${item.case_id} must not include a target_response when handoff is false`);
    if (expected.handoff_status !== "not_required") fail(`${item.case_id} direct route must expect not_required`);
    return;
  }
  validateAgentResponse(item.target_response, route.target_agent, `${item.case_id} target`);
  if (item.target_response.status !== expected.handoff_status) {
    fail(`${item.case_id} expected handoff_status ${expected.handoff_status}, got ${item.target_response.status}`);
  }
  if (route.decision === "create_skill" && item.target_response.status !== "approval_required") {
    fail(`${item.case_id} create_skill handoff must remain approval_required`);
  }
  if (route.decision === "activate_skill" && item.target_response.output?.skill_orchestrator !== "internal_component") {
    fail(`${item.case_id} activate_skill must keep skill_orchestrator as internal_component`);
  }
  if (route.decision === "ingest_or_stage_knowledge") {
    const output = item.target_response.output || {};
    if (output.review_state !== "pending_review") fail(`${item.case_id} staged knowledge must be pending_review`);
    if (output.vector_refresh !== "deferred_until_approved") fail(`${item.case_id} vector refresh must be deferred_until_approved`);
  }
}

function validate() {
  if (!fs.existsSync(fixturePath)) fail(`Missing runtime handoff fixture: ${rel(fixturePath)}`);
  const fixture = readJson(fixturePath);
  if (fixture.runtime_policy?.entry_agent !== "actor_twin") fail("Runtime entry agent must be actor_twin");
  if (fixture.runtime_policy?.knowledge_fabric_manual_activation !== false) fail("Knowledge Fabric manual activation must stay false");
  if (fixture.runtime_policy?.agentic_butler_manual_activation !== false) fail("Agentic Butler manual activation must stay false");
  if (fixture.runtime_policy?.skill_orchestrator_boundary !== "internal_component_of_agentic_butler") {
    fail("Skill Orchestrator boundary must be internal_component_of_agentic_butler");
  }
  const cases = Array.isArray(fixture.cases) ? fixture.cases : [];
  if (cases.length < 5) fail("Runtime handoff fixture must include at least five cases");
  const seen = new Set();
  for (const item of cases) {
    if (seen.has(item.case_id)) fail(`Duplicate runtime handoff case: ${item.case_id}`);
    seen.add(item.case_id);
    validateCase(item);
  }
  for (const required of Object.keys(expectedTargets)) {
    if (!cases.some((item) => item.actor_response?.output?.route_decision?.decision === required)) {
      fail(`Missing runtime handoff route decision: ${required}`);
    }
  }
  return cases.length;
}

try {
  const count = validate();
  console.log(`Agent runtime handoff validation passed: ${count} cases`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
