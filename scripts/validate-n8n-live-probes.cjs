const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const fixtureDir = path.join(root, "contracts", "n8n", "fixtures");
const probeDir = path.join(root, "contracts", "n8n", "live-probes");

const expectedAgents = {
  actor_twin: {
    file: "actor-twin.json",
    expectedStatus: "completed",
  },
  knowledge_fabric_agent: {
    file: "knowledge-fabric-agent.json",
    expectedStatus: "completed",
  },
  agentic_butler: {
    file: "agentic-butler.json",
    expectedStatus: "approval_required",
  },
};

function fail(message) {
  throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertProbeEnvelope(agentId, probe) {
  if (!probe || typeof probe !== "object") fail(`${agentId}: live_probe missing`);
  if (probe.agent_id !== agentId) fail(`${agentId}: live_probe.agent_id mismatch`);
  if (!probe.envelope_version) fail(`${agentId}: live_probe.envelope_version missing`);
  if (!probe.request_id) fail(`${agentId}: live_probe.request_id missing`);
  if (probe.intent !== "live_probe") fail(`${agentId}: live_probe.intent must be live_probe`);
  if (probe.input?.execute !== false) fail(`${agentId}: live_probe.input.execute must be false`);
  if (probe.context?.side_effect_policy !== "no_write_probe") {
    fail(`${agentId}: live_probe.context.side_effect_policy must be no_write_probe`);
  }
  const expectedCapabilities = probe.context?.expected_capabilities;
  const checkedCapabilities = probe.expected_response?.output?.capabilities_checked;
  if (!Array.isArray(expectedCapabilities) || expectedCapabilities.length < 5) {
    fail(`${agentId}: live_probe.context.expected_capabilities incomplete`);
  }
  if (!Array.isArray(checkedCapabilities) || checkedCapabilities.length !== expectedCapabilities.length) {
    fail(`${agentId}: live_probe.expected_response.output.capabilities_checked mismatch`);
  }
  if (probe.expected_response?.output?.side_effects !== "none") {
    fail(`${agentId}: live_probe.expected_response.output.side_effects must be none`);
  }
  if (probe.expected_response?.trace?.trace_id_required !== true) {
    fail(`${agentId}: live_probe.expected_response.trace.trace_id_required must be true`);
  }
}

function validateProbe(agentId, config) {
  const probePath = path.join(probeDir, config.file);
  if (!fs.existsSync(probePath)) fail(`${agentId}: missing standalone live probe ${config.file}`);
  const artifact = readJson(probePath);
  const fixture = readJson(path.join(fixtureDir, config.file));

  if (artifact.schema_version !== "0.1.0") fail(`${agentId}: schema_version must be 0.1.0`);
  if (artifact.agent_id !== agentId) fail(`${agentId}: artifact.agent_id mismatch`);
  if (artifact.contract_version !== fixture.contract_version) fail(`${agentId}: contract_version mismatch`);
  if (artifact.source_fixture !== fixture.source) fail(`${agentId}: source_fixture mismatch`);
  if (stableJson(artifact.live_probe) !== stableJson(fixture.live_probe)) {
    fail(`${agentId}: standalone live probe drifted from fixture.live_probe`);
  }
  assertProbeEnvelope(agentId, artifact.live_probe);

  const expected = artifact.live_probe.expected_response || {};
  if (expected.status !== config.expectedStatus) {
    fail(`${agentId}: live_probe.expected_response.status must be ${config.expectedStatus}`);
  }
  if (config.expectedStatus === "approval_required") {
    if (expected.approval?.required !== true) fail(`${agentId}: expected approval.required must be true`);
    if (!expected.approval?.gate) fail(`${agentId}: expected approval.gate missing`);
    if (!expected.approval?.proposed_action) fail(`${agentId}: expected approval.proposed_action missing`);
  }
}

for (const [agentId, config] of Object.entries(expectedAgents)) {
  validateProbe(agentId, config);
}

console.log(`n8n live probe validation passed: ${Object.keys(expectedAgents).length} standalone probes`);
