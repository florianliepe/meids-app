const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const expectedResponseStatus = {
  actor_twin: "completed",
  knowledge_fabric_agent: "completed",
  agentic_butler: "approval_required",
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(relativePath) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) fail(`Missing artifact: ${relativePath}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function byAgent(list, agentId) {
  return Array.isArray(list) ? list.find((item) => item.agent_id === agentId) || null : null;
}

function assertCommandStatus(command, agentId, source) {
  const expected = expectedResponseStatus[agentId];
  if (!expected) fail(`${source}: unexpected agent ${agentId}`);
  if (!command || !String(command).includes(`--response-status ${expected}`)) {
    fail(`${source}: ${agentId} must use --response-status ${expected}`);
  }
}

function assertAgentSet(agents, source) {
  const ids = new Set((agents || []).map((agent) => agent.agent_id));
  for (const agentId of Object.keys(expectedResponseStatus)) {
    if (!ids.has(agentId)) fail(`${source}: missing agent ${agentId}`);
  }
}

function validatePreflight() {
  const artifact = readJson("frontend/assets/n8n-live-readiness-preflight.json");
  assertAgentSet(artifact.agents, "n8n-live-readiness-preflight.json agents");
  assertAgentSet(artifact.next_actions, "n8n-live-readiness-preflight.json next_actions");
  for (const agentId of Object.keys(expectedResponseStatus)) {
    const agent = byAgent(artifact.agents, agentId);
    const action = byAgent(artifact.next_actions, agentId);
    assertCommandStatus(agent?.commands?.record_probe_evidence, agentId, "preflight agent command");
    assertCommandStatus(action?.record_probe_evidence, agentId, "preflight next action command");
  }
}

function validateHandoffCommands() {
  const artifact = readJson("frontend/assets/n8n-live-handoff-commands.json");
  assertAgentSet(artifact.agents, "n8n-live-handoff-commands.json agents");
  for (const agentId of Object.keys(expectedResponseStatus)) {
    const agent = byAgent(artifact.agents, agentId);
    const expected = expectedResponseStatus[agentId];
    if (agent.expected_response_status !== expected) {
      fail(`handoff commands: ${agentId} expected_response_status must be ${expected}`);
    }
    assertCommandStatus(agent.commands?.record_probe, agentId, "handoff command");
  }
}

function validateCompletionChecklist() {
  const artifact = readJson("frontend/assets/zielmodus-4-live-completion-checklist.json");
  assertAgentSet(artifact.agents, "zielmodus-4-live-completion-checklist.json agents");
  for (const agentId of Object.keys(expectedResponseStatus)) {
    const agent = byAgent(artifact.agents, agentId);
    const recordItem = (agent.open_items || []).find((item) => item.type === "live_probe");
    assertCommandStatus(recordItem?.command, agentId, "completion checklist probe command");
  }
}

validatePreflight();
validateHandoffCommands();
validateCompletionChecklist();

console.log("n8n live artifact semantics passed: response-status commands match agent gates");
