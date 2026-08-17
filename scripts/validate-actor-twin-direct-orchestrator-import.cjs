const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const workflowPath = process.argv[2]
  ? path.resolve(root, process.argv[2])
  : path.join(root, "workflows", "n8n", "import-ready", "actor-twin-direct-orchestrator.uat-live-urls.import.json");

function fail(message) {
  console.error(JSON.stringify({ status: "failed", workflow: path.relative(root, workflowPath), error: message }, null, 2));
  process.exit(1);
}

function readWorkflow() {
  if (!fs.existsSync(workflowPath)) fail("workflow import file not found");
  try {
    return JSON.parse(fs.readFileSync(workflowPath, "utf8"));
  } catch (error) {
    fail(`workflow import file is not valid JSON: ${error.message}`);
  }
}

function nodeByName(workflow, name) {
  return (workflow.nodes || []).find((node) => node.name === name);
}

function assertIncludes(value, needle, label) {
  if (!String(value || "").includes(needle)) fail(`${label} missing: ${needle}`);
}

function assertRegex(value, regex, label) {
  if (!regex.test(String(value || ""))) fail(`${label} missing pattern: ${regex}`);
}

const workflow = readWorkflow();
const requiredNodes = [
  "Receive request",
  "Actor Twin AI Agent",
  "Normalize route decision",
  "Switch by route",
  "Call Knowledge Fabric Agent",
  "Call Agentic Butler",
  "Finalize Actor Twin response",
  "Return JSON",
  "Actor Twin Chat Model",
];

for (const name of requiredNodes) {
  if (!nodeByName(workflow, name)) fail(`required node not found: ${name}`);
}

const receive = nodeByName(workflow, "Receive request");
if (receive.parameters?.path !== "meids/actor-twin/chat") {
  fail(`Receive request path must be meids/actor-twin/chat, got ${receive.parameters?.path || "<missing>"}`);
}

const normalizeCode = nodeByName(workflow, "Normalize route decision").parameters?.jsCode || "";
assertIncludes(normalizeCode, "const embedded = safeJson(aiText) || safeJson(ai?.output) || safeJson(ai) || {};", "Normalize route decision");
assertIncludes(normalizeCode, "return '';", "Normalize route decision fallback");
assertIncludes(normalizeCode, "pending okf", "Knowledge Fabric ingest intent routing");
assertIncludes(normalizeCode, "source note", "Knowledge Fabric source-note routing");
assertIncludes(normalizeCode, "targetAgent = delegationTarget ||", "Target-agent derivation");
assertRegex(normalizeCode, /ingest_or_stage_knowledge'[\s\S]*\? 'knowledge_fabric_agent'/, "Knowledge Fabric target routing");
assertRegex(normalizeCode, /activate_skill','create_skill'[\s\S]*\? 'agentic_butler'/, "Agentic Butler target routing");

const finalizeCode = nodeByName(workflow, "Finalize Actor Twin response").parameters?.jsCode || "";
assertIncludes(finalizeCode, "route.decision === 'create_skill'", "Create-skill approval boundary");
assertIncludes(finalizeCode, "explicitSkillCreationIntent(originalText)", "Explicit skill creation approval gate");
assertIncludes(finalizeCode, "approvalRequired = Boolean(skillActivationApproval)", "Approval narrowing");
assertIncludes(finalizeCode, "delegated_autonomous", "Autonomous delegation trace state");
assertIncludes(finalizeCode, "outputAnswer(delegateOutput)", "Delegate output rendering");

const knowledgeCall = nodeByName(workflow, "Call Knowledge Fabric Agent");
const butlerCall = nodeByName(workflow, "Call Agentic Butler");
assertIncludes(knowledgeCall.parameters?.url, "/webhook/meids/knowledge-fabric/ingest", "Knowledge Fabric URL");
assertIncludes(butlerCall.parameters?.url, "/webhook/meids/agentic-butler/run", "Agentic Butler URL");

const connections = workflow.connections || {};
const switchOutputs = connections["Switch by route"]?.main || [];
const switchTargets = switchOutputs.flat().map((item) => item.node);
for (const expected of ["Call Knowledge Fabric Agent", "Call Agentic Butler", "Finalize Actor Twin response"]) {
  if (!switchTargets.includes(expected)) fail(`Switch by route does not connect to ${expected}`);
}
const switchNode = nodeByName(workflow, "Switch by route");
const switchRules = switchNode.parameters?.rules?.values || [];
if (JSON.stringify(switchRules).includes("route_decision.approval_required")) {
  fail("Switch by route must not stop approval-required routes before delegation; create_skill must call Agentic Butler first");
}
const butlerOutputIndexes = switchOutputs
  .map((output, index) => ({ index, targets: (output || []).map((item) => item.node) }))
  .filter((output) => output.targets.includes("Call Agentic Butler"))
  .map((output) => output.index);
if (!butlerOutputIndexes.includes(2)) {
  fail("Switch by route output index 2 must route Agentic Butler targets, including create_skill, to Call Agentic Butler");
}

console.log(JSON.stringify({
  status: "passed",
  workflow: path.relative(root, workflowPath),
  webhook_path: receive.parameters.path,
  nodes: requiredNodes.length,
  checks: [
    "direct_orchestrator_nodes_present",
    "active_actor_twin_webhook_path",
    "embedded_ai_json_precedence",
    "no_answer_direct_default_before_actor_route",
    "knowledge_fabric_ingest_keywords",
    "agentic_butler_autonomous_boundary",
    "skill_creation_approval_boundary",
    "skill_creation_delegates_before_approval",
    "live_delegate_urls",
  ],
}, null, 2));
