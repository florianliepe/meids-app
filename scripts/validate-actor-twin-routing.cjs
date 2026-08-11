const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const fixturePath = path.join(root, "contracts", "n8n", "fixtures", "actor-twin-routing.json");

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
  const fixture = readJson(fixturePath);
  if (fixture.agent_id !== "actor_twin") fail("routing fixture must belong to actor_twin");
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
