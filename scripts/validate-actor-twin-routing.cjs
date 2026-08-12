const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const fixturePath = path.join(root, "contracts", "n8n", "fixtures", "actor-twin-routing.json");
const actorFixturePath = path.join(root, "contracts", "n8n", "fixtures", "actor-twin.json");

const requiredRoutes = [
  "answer_direct",
  "retrieve_knowledge",
  "ingest_or_stage_knowledge",
  "activate_skill",
  "create_skill",
  "request_human_clarification",
];

const expectedTargets = {
  answer_direct: "actor_twin",
  retrieve_knowledge: "knowledge_fabric_agent",
  ingest_or_stage_knowledge: "knowledge_fabric_agent",
  activate_skill: "agentic_butler",
  create_skill: "agentic_butler",
  request_human_clarification: "human",
};

const allowedVisibleStates = new Set([
  "thinking",
  "answering",
  "using_knowledge",
  "activating_skill",
  "drafting_new_skill",
  "approval_required",
]);

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

function validate() {
  if (!fs.existsSync(fixturePath)) fail(`Missing routing fixture: ${rel(fixturePath)}`);
  if (!fs.existsSync(actorFixturePath)) fail(`Missing Actor Twin fixture: ${rel(actorFixturePath)}`);
  const actorFixture = readJson(actorFixturePath);
  const directRoute = actorFixture.response?.output?.route_decision;
  if (!isObject(directRoute)) fail("Actor Twin fixture response must include output.route_decision");
  if (directRoute.decision !== "answer_direct") fail("Actor Twin fixture direct response must declare answer_direct");
  if (directRoute.target_agent !== "actor_twin") fail("Actor Twin direct route must target actor_twin");
  if (directRoute.handoff_required !== false) fail("Actor Twin direct route must set handoff_required false");
  const fixture = readJson(fixturePath);
  if (fixture.agent_id !== "actor_twin") fail("routing fixture must belong to actor_twin");
  if (fixture.orchestration_model?.phase !== "uat_n8n_direct_orchestration") {
    fail("routing fixture must declare uat_n8n_direct_orchestration phase");
  }
  if (!String(fixture.orchestration_model?.key_point || "").includes("decision authority")) {
    fail("routing fixture must highlight Actor Twin as decision authority");
  }
  const delegatedAgents = fixture.orchestration_model?.delegated_agents || [];
  for (const agentId of ["knowledge_fabric_agent", "agentic_butler"]) {
    const delegated = delegatedAgents.find((agent) => agent.agent_id === agentId);
    if (!delegated) fail(`orchestration_model.delegated_agents missing ${agentId}`);
    if (!["n8n_http_request_or_execute_workflow", "n8n_direct"].includes(delegated.call_method)) {
      fail(`${agentId} must use direct n8n orchestration call method`);
    }
  }
  if (fixture.chat_surface_policy?.diagnostics !== "cockpit_only") {
    fail("Chat diagnostics policy must be cockpit_only");
  }
  if (fixture.chat_surface_policy?.manual_knowledge_fabric_activation !== false) {
    fail("Manual Knowledge Fabric activation must be disabled in Chat");
  }
  if (fixture.chat_surface_policy?.manual_agentic_butler_activation !== false) {
    fail("Manual Agentic Butler activation must be disabled in Chat");
  }
  const visibleStates = fixture.chat_surface_policy?.visible_states || [];
  for (const state of visibleStates) {
    if (!allowedVisibleStates.has(state)) fail(`Unsupported visible state: ${state}`);
  }
  const decisions = Array.isArray(fixture.route_decisions) ? fixture.route_decisions : [];
  const seen = new Map();
  for (const item of decisions) {
    const route = item.expected_route || {};
    if (!route.decision) fail(`${item.case_id || "case"} missing expected_route.decision`);
    if (seen.has(route.decision)) fail(`Duplicate route decision: ${route.decision}`);
    seen.set(route.decision, item);
    if (route.target_agent !== expectedTargets[route.decision]) {
      fail(`${route.decision} must target ${expectedTargets[route.decision]}, got ${route.target_agent}`);
    }
    if (!route.intent) fail(`${route.decision} missing intent`);
    if (!allowedVisibleStates.has(route.visible_state)) fail(`${route.decision} has invalid visible_state`);
    if (typeof route.approval_required !== "boolean") fail(`${route.decision} missing approval_required boolean`);
    if (!route.reason) fail(`${route.decision} missing reason`);
    if (!isObject(item.request)) fail(`${route.decision} missing request example`);
    if (["retrieve_knowledge", "ingest_or_stage_knowledge", "activate_skill", "create_skill"].includes(route.decision)) {
      const delegate = item.expected_delegate_envelope;
      if (!isObject(delegate)) fail(`${route.decision} missing expected_delegate_envelope`);
      if (delegate.agent_id !== route.target_agent) fail(`${route.decision} delegate agent_id mismatch`);
      if (delegate.intent !== route.intent) fail(`${route.decision} delegate intent mismatch`);
      if (delegate.call_method !== "n8n_direct") fail(`${route.decision} delegate must set call_method n8n_direct`);
      if (delegate.called_by !== "actor_twin") fail(`${route.decision} delegate must set called_by actor_twin`);
    }
    if (route.decision === "activate_skill") {
      if (item.request.selected_skill_status !== "approved") fail("activate_skill case must reference approved skill");
      if (!item.expected_delegate_envelope?.input?.skill_id) fail("activate_skill delegate missing skill_id");
    }
    if (route.decision === "create_skill") {
      if (route.approval_required !== true) fail("create_skill must require approval");
      if (route.skill_status !== "pending_approval") fail("create_skill must produce pending_approval status");
      if (item.expected_delegate_envelope?.context?.approval_policy !== "never_auto_approve_generated_skills") {
        fail("create_skill delegate must enforce never_auto_approve_generated_skills");
      }
    }
  }
  const missing = requiredRoutes.filter((route) => !seen.has(route));
  if (missing.length) fail(`Missing route decisions: ${missing.join(", ")}`);
  return { fixture, decisions };
}

const { decisions } = validate();
console.log(`Actor Twin routing validation passed: ${decisions.length} route decisions`);
