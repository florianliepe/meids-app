const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const fixtureDir = path.join(root, "contracts", "n8n", "fixtures");
const defaultOutputPath = path.join(root, "frontend", "assets", "n8n-contract-replay-status.json");
const requiredAgents = ["actor_twin", "knowledge_fabric_agent", "agentic_butler"];
const cases = ["request", "response", "approval_required", "failure"];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fail(message) {
  throw new Error(message);
}

function hasObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertEnvelope(fixture, caseName) {
  const envelope = fixture[caseName];
  if (!hasObject(envelope)) fail(`${fixture.agent_id}.${caseName}: envelope missing`);
  if (envelope.agent_id !== fixture.agent_id) fail(`${fixture.agent_id}.${caseName}: agent_id mismatch`);
  if (!envelope.envelope_version) fail(`${fixture.agent_id}.${caseName}: envelope_version missing`);
  if (!envelope.request_id) fail(`${fixture.agent_id}.${caseName}: request_id missing`);
  return envelope;
}

function replayRequest(fixture) {
  const request = assertEnvelope(fixture, "request");
  const checks = [];
  if (!request.intent) fail(`${fixture.agent_id}.request: intent missing`);
  checks.push("intent");
  if (!hasObject(request.principal) || !request.principal.twin_id) fail(`${fixture.agent_id}.request: principal.twin_id missing`);
  checks.push("principal");
  if (!hasObject(request.input)) fail(`${fixture.agent_id}.request: input missing`);
  checks.push("input");
  if (!hasObject(request.approval) || typeof request.approval.required !== "boolean") {
    fail(`${fixture.agent_id}.request: approval.required boolean missing`);
  }
  checks.push("approval_policy");
  return { case: "request", status: "passed", request_id: request.request_id, checks };
}

function replayResponse(fixture) {
  const response = assertEnvelope(fixture, "response");
  const checks = [];
  if (response.status !== "completed") fail(`${fixture.agent_id}.response: status must be completed`);
  checks.push("completed_status");
  if (!hasObject(response.output)) fail(`${fixture.agent_id}.response: output missing`);
  checks.push("output_contract");
  if (!hasObject(response.trace) || !response.trace.trace_id) fail(`${fixture.agent_id}.response: trace.trace_id missing`);
  checks.push("trace");
  return { case: "response", status: "passed", request_id: response.request_id, trace_id: response.trace.trace_id, checks };
}

function replayApprovalRequired(fixture) {
  const approval = assertEnvelope(fixture, "approval_required");
  const checks = [];
  if (approval.status !== "approval_required") fail(`${fixture.agent_id}.approval_required: status must be approval_required`);
  checks.push("approval_required_status");
  if (approval.approval?.required !== true) fail(`${fixture.agent_id}.approval_required: approval.required must be true`);
  checks.push("human_gate");
  if (!approval.approval?.gate) fail(`${fixture.agent_id}.approval_required: approval.gate missing`);
  checks.push("gate_name");
  if (!approval.approval?.proposed_action) fail(`${fixture.agent_id}.approval_required: approval.proposed_action missing`);
  checks.push("proposed_action");
  return { case: "approval_required", status: "passed", request_id: approval.request_id, gate: approval.approval.gate, checks };
}

function replayFailure(fixture) {
  const failure = assertEnvelope(fixture, "failure");
  const checks = [];
  if (failure.status !== "failed") fail(`${fixture.agent_id}.failure: status must be failed`);
  checks.push("failed_status");
  if (!failure.error?.code) fail(`${fixture.agent_id}.failure: error.code missing`);
  checks.push("error_code");
  if (!failure.error?.message) fail(`${fixture.agent_id}.failure: error.message missing`);
  checks.push("error_message");
  if (typeof failure.error?.recoverable !== "boolean") fail(`${fixture.agent_id}.failure: error.recoverable boolean missing`);
  checks.push("recoverability");
  return { case: "failure", status: "passed", request_id: failure.request_id, error_code: failure.error.code, checks };
}

function replayLiveProbe(fixture) {
  if (!hasObject(fixture.live_probe)) return null;
  const probe = fixture.live_probe;
  if (probe.agent_id !== fixture.agent_id) fail(`${fixture.agent_id}.live_probe: agent_id mismatch`);
  if (!probe.envelope_version) fail(`${fixture.agent_id}.live_probe: envelope_version missing`);
  if (!probe.request_id) fail(`${fixture.agent_id}.live_probe: request_id missing`);
  const checks = [];
  if (probe.intent !== "live_probe") fail(`${fixture.agent_id}.live_probe: intent must be live_probe`);
  checks.push("live_probe_intent");
  if (probe.input?.execute !== false) fail(`${fixture.agent_id}.live_probe: input.execute must be false`);
  checks.push("no_execution");
  if (probe.context?.side_effect_policy !== "no_write_probe") fail(`${fixture.agent_id}.live_probe: side_effect_policy must be no_write_probe`);
  checks.push("no_write_boundary");
  if (!Array.isArray(probe.context?.expected_capabilities) || !probe.context.expected_capabilities.length) {
    fail(`${fixture.agent_id}.live_probe: expected_capabilities missing`);
  }
  checks.push("capability_contract");
  if (probe.expected_response?.trace?.trace_id_required !== true) {
    fail(`${fixture.agent_id}.live_probe: trace_id_required must be true`);
  }
  checks.push("trace_required");
  return { case: "live_probe", status: "passed", request_id: probe.request_id, checks };
}

function replayFixture(file) {
  const fixture = readJson(file);
  if (!requiredAgents.includes(fixture.agent_id)) fail(`${file}: unknown agent_id ${fixture.agent_id}`);
  if (!fixture.agent_name) fail(`${fixture.agent_id}: agent_name missing`);
  if (!fixture.contract_version) fail(`${fixture.agent_id}: contract_version missing`);
  for (const caseName of cases) assertEnvelope(fixture, caseName);
  const results = [
    replayRequest(fixture),
    replayResponse(fixture),
    replayApprovalRequired(fixture),
    replayFailure(fixture),
  ].concat(replayLiveProbe(fixture) || []);
  return {
    agent_id: fixture.agent_id,
    agent_name: fixture.agent_name,
    contract_version: fixture.contract_version,
    source: fixture.source || path.relative(root, file).replaceAll("\\", "/"),
    status: "passed",
    case_count: results.length,
    tested_cases: results.map((result) => result.case),
    statuses: ["documented", "fixture ready", "contract tested", "blocked"],
    live_status: "not_configured",
    live_status_label: "blocked",
    blocker: "Live n8n webhook is not configured in public fixture mode.",
    cases: results,
  };
}

function parseArgs(argv) {
  const args = { write: false, output: defaultOutputPath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") args.write = true;
    if (arg === "--output") {
      args.output = path.resolve(argv[index + 1] || "");
      index += 1;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = fs.readdirSync(fixtureDir).filter((file) => file.endsWith(".json")).sort();
  const agents = files.map((file) => replayFixture(path.join(fixtureDir, file)));
  const seen = new Set(agents.map((agent) => agent.agent_id));
  const missing = requiredAgents.filter((agent) => !seen.has(agent));
  if (missing.length) fail(`Missing fixtures: ${missing.join(", ")}`);
  const caseCount = agents.reduce((sum, agent) => sum + agent.case_count, 0);
  const artifact = {
    schema_version: "0.1.0",
    generated_at: new Date().toISOString(),
    status: "passed",
    fixture_count: agents.length,
    case_count: caseCount,
    statuses: ["documented", "fixture ready", "contract tested"],
    live_webhooks: {
      status: "not_configured",
      note: "Webhook URLs and secrets are intentionally excluded from public replay artifacts.",
    },
    agents,
  };
  if (args.write) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  }
  console.log(`n8n fixture replay passed: ${agents.length} agents, ${caseCount} cases`);
  if (args.write) console.log(`replay status written: ${path.relative(root, args.output).replaceAll("\\", "/")}`);
}

main();
