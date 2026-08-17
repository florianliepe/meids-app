const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultFile = path.join(root, "frontend", "assets", "n8n-live-probe-evidence.json");

const expectedResponseStatus = {
  actor_twin: "completed",
  knowledge_fabric_agent: "completed",
  agentic_butler: "completed",
};

function fail(message) {
  throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function evidenceFileFromArgs() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--file");
  if (index >= 0 && args[index + 1]) return path.resolve(root, args[index + 1]);
  const inline = args.find((arg) => arg.startsWith("--file="));
  return inline ? path.resolve(root, inline.slice("--file=".length)) : defaultFile;
}

function validateEntry(entry) {
  const agentId = entry?.agent_id;
  if (!expectedResponseStatus[agentId]) fail(`Unexpected or missing agent_id: ${agentId || "missing"}`);
  const expected = expectedResponseStatus[agentId];
  const command = String(entry.record_command_template || entry.record_command || "");
  if (entry.expected_response_status && entry.expected_response_status !== expected) {
    fail(`${agentId}: expected_response_status must be ${expected}`);
  }
  if (command && !command.includes(`--response-status ${expected}`)) {
    fail(`${agentId}: record command must use --response-status ${expected}`);
  }
  if (entry.status === "connected") {
    if (!entry.trace_id) fail(`${agentId}: connected evidence requires trace_id`);
    if (/demo|fixture|sample|placeholder/i.test(entry.trace_id)) {
      fail(`${agentId}: trace_id looks like demo or placeholder evidence`);
    }
    if (entry.demo === true) fail(`${agentId}: connected evidence cannot be demo=true`);
    const responseStatus = entry.evidence?.response_status;
    if (responseStatus !== expected) fail(`${agentId}: evidence.response_status must be ${expected}`);
  }
}

const file = evidenceFileFromArgs();
const artifact = readJson(file);
if (artifact.schema_version !== "0.1.0") fail("schema_version must be 0.1.0");
if (!Array.isArray(artifact.agents)) fail("agents must be an array");

const seen = new Set();
for (const entry of artifact.agents) {
  validateEntry(entry);
  seen.add(entry.agent_id);
}
for (const agentId of Object.keys(expectedResponseStatus)) {
  if (!seen.has(agentId)) fail(`Missing evidence entry for ${agentId}`);
}

const connected = artifact.agents.filter((entry) => entry.status === "connected" && entry.trace_id && entry.demo !== true);
if (artifact.status === "complete" && connected.length !== Object.keys(expectedResponseStatus).length) {
  fail("complete status requires connected non-demo evidence for every top-level agent");
}

console.log(`n8n live probe evidence validation passed: ${artifact.agents.length} agents`);
