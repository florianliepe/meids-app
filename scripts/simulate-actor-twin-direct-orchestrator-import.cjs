const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const workflowPath = process.argv[2]
  ? path.resolve(root, process.argv[2])
  : path.join(root, "workflows", "n8n", "import-ready", "actor-twin-direct-orchestrator.uat-live-urls.import.json");

function fail(message, details = {}) {
  console.error(JSON.stringify({
    status: "failed",
    workflow: path.relative(root, workflowPath).replaceAll("\\", "/"),
    error: message,
    ...details,
  }, null, 2));
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

function fencedJson(value) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function invokeNormalize(jsCode, input, aiJson) {
  const sandbox = {
    $json: aiJson,
    $execution: { id: "sim_exec" },
    $: (name) => {
      if (name !== "Receive request") throw new Error(`Unexpected node lookup: ${name}`);
      return { first: () => ({ json: { body: input } }) };
    },
  };
  const wrapped = `(function(){\n${jsCode}\n})()`;
  const result = vm.runInNewContext(wrapped, sandbox, { timeout: 1000 });
  if (!Array.isArray(result) || !result[0]?.json?.route_decision) {
    throw new Error("Normalize node did not return [{ json: { route_decision } }]");
  }
  return result[0].json;
}

function makeEnvelope(query, contextRoute = {}) {
  return {
    envelope_version: "0.1.0",
    request_id: "sim_req",
    agent_id: "actor_twin",
    intent: "route_request",
    principal: { twin_id: "florian", display_name: "Florian" },
    input: { query, mode: "simulation" },
    context: contextRoute.decision ? { route_decision: contextRoute } : {},
  };
}

const workflow = readWorkflow();
const normalizeNode = nodeByName(workflow, "Normalize route decision");
if (!normalizeNode) fail("Normalize route decision node not found");
const jsCode = normalizeNode.parameters?.jsCode || "";
if (!jsCode) fail("Normalize route decision node has no jsCode");

const cases = [
  {
    case_id: "identity_answer_overrides_stale_context",
    input: makeEnvelope("who are you", {
      decision: "activate_skill",
      target_agent: "agentic_butler",
      intent: "activate_skill",
      handoff_required: true,
    }),
    ai: {
      output: fencedJson({
        answer: "I am Florian's Actor Twin.",
        route_decision: {
          decision: "answer_direct",
          target_agent: "actor_twin",
          intent: "answer_question",
          visible_state: "answering",
          approval_required: false,
          handoff_required: false,
          reason: "Identity question needs no worker handoff.",
        },
      }),
    },
    expected: { decision: "answer_direct", target_agent: "actor_twin", handoff_required: false, approval_required: false },
  },
  {
    case_id: "embedded_knowledge_ingest_routes_to_fabric",
    input: makeEnvelope("Remember this public-safe source note as pending OKF evidence: Client alignment meeting moved to Friday."),
    ai: {
      output: fencedJson({
        answer: "Staging this as pending OKF evidence.",
        route_decision: {
          decision: "ingest_or_stage_knowledge",
          target_agent: "knowledge_fabric_agent",
          intent: "ingest_concept",
          visible_state: "capturing_knowledge",
          approval_required: false,
          handoff_required: true,
          reason: "User asked to remember a source note.",
        },
      }),
    },
    expected: { decision: "ingest_or_stage_knowledge", target_agent: "knowledge_fabric_agent", handoff_required: true, approval_required: false },
  },
  {
    case_id: "keyword_knowledge_ingest_routes_without_embedded_json",
    input: makeEnvelope("Remember this public-safe source note as pending OKF evidence: Client alignment meeting moved to Friday."),
    ai: { output: "I will stage this as pending OKF evidence." },
    expected: { decision: "ingest_or_stage_knowledge", target_agent: "knowledge_fabric_agent", handoff_required: true, approval_required: false },
  },
  {
    case_id: "draft_email_routes_to_butler_without_approval",
    input: makeEnvelope("Write an email for the dev team to define the next features for the MeIDs app. Draft only; do not send."),
    ai: {
      output: fencedJson({
        answer: "Delegating draft-only work to Butler.",
        route_decision: {
          decision: "activate_skill",
          target_agent: "agentic_butler",
          intent: "activate_skill",
          visible_state: "activating_skill",
          approval_required: false,
          handoff_required: true,
          reason: "Draft-only artifact generation.",
        },
      }),
    },
    expected: { decision: "activate_skill", target_agent: "agentic_butler", handoff_required: true, approval_required: false },
  },
  {
    case_id: "create_skill_routes_to_butler_with_approval",
    input: makeEnvelope("Create a new skill for preparing a weekly executive steering update from email, calendar, and Teams exports."),
    ai: {
      output: fencedJson({
        answer: "I will ask Butler to create a pending skill proposal.",
        route_decision: {
          decision: "create_skill",
          target_agent: "agentic_butler",
          intent: "create_skill",
          visible_state: "approval_required",
          approval_required: true,
          handoff_required: true,
          reason: "Generated skills require approval before activation.",
        },
      }),
    },
    expected: { decision: "create_skill", target_agent: "agentic_butler", handoff_required: true, approval_required: true },
  },
  {
    case_id: "empty_ai_output_create_skill_guard",
    input: makeEnvelope("Create a new skill for preparing a weekly executive steering update from email, calendar, and Teams exports."),
    ai: { output: "{}" },
    expected: { decision: "create_skill", target_agent: "agentic_butler", handoff_required: true, approval_required: true },
  },
];

const results = [];
for (const item of cases) {
  let actual;
  try {
    actual = invokeNormalize(jsCode, item.input, item.ai).route_decision;
  } catch (error) {
    fail(`simulation failed for ${item.case_id}: ${error.message}`, { case_id: item.case_id });
  }
  const findings = [];
  for (const [key, expectedValue] of Object.entries(item.expected)) {
    if (actual[key] !== expectedValue) findings.push(`${key} expected ${expectedValue}, got ${actual[key]}`);
  }
  results.push({ case_id: item.case_id, status: findings.length ? "failed" : "passed", actual, findings });
}

const failed = results.filter((item) => item.status !== "passed");
if (failed.length) fail("Actor Twin direct orchestrator import simulation failed", { failed });

console.log(JSON.stringify({
  status: "passed",
  workflow: path.relative(root, workflowPath).replaceAll("\\", "/"),
  cases: results.length,
  checks: results.map((item) => item.case_id),
}, null, 2));
