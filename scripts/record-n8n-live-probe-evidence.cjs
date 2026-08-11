const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

const agents = {
  actor_twin: "Actor Twin",
  knowledge_fabric_agent: "Knowledge Fabric Agent",
  agentic_butler: "Agentic Butler",
};

const expectedResponseStatusByAgent = {
  actor_twin: "completed",
  knowledge_fabric_agent: "completed",
  agentic_butler: "approval_required",
};

function readArg(name) {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim();
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1]) return args[index + 1].trim();
  return "";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function usage() {
  console.log([
    "Usage:",
    "  node scripts/record-n8n-live-probe-evidence.cjs --agent actor_twin --trace-id trace_123 --execution-url https://... --response-status completed",
    "",
    "Required:",
    "  --agent actor_twin|knowledge_fabric_agent|agentic_butler",
    "  --trace-id <non-demo trace id returned by n8n>",
    "",
    "Optional:",
    "  --execution-url <public-safe n8n execution URL>",
    "  --response-status completed|approval_required|failed",
    "  --url-source runtime-asset|browser-local|github-pages-secret|manual",
    "  --ai-agent-node <n8n AI Agent node name>",
    "  --checked-at 2026-08-10T20:00:00.000Z",
    "  --output frontend/assets/n8n-live-probe-evidence.json",
  ].join("\n"));
}

if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const agentId = readArg("agent");
const traceId = readArg("trace-id");
const executionUrl = readArg("execution-url");
const responseStatus = readArg("response-status") || "completed";
const urlSource = readArg("url-source") || "manual";
const aiAgentNode = readArg("ai-agent-node");
const checkedAt = readArg("checked-at") || new Date().toISOString();
const outputArg = readArg("output");
const outputPath = outputArg
  ? path.resolve(root, outputArg)
  : path.join(root, "frontend", "assets", "n8n-live-probe-evidence.json");

if (!agentId || !agents[agentId]) {
  fail(`Invalid or missing --agent. Expected one of: ${Object.keys(agents).join(", ")}`);
}

if (!traceId) fail("Missing --trace-id. A non-demo n8n trace id is required.");
if (/demo|fixture|sample|placeholder/i.test(traceId)) {
  fail("--trace-id looks like demo or placeholder evidence. Use a real n8n trace id.");
}

if (executionUrl) {
  let parsed;
  try {
    parsed = new URL(executionUrl);
  } catch {
    fail("--execution-url must be a valid URL when provided.");
  }
  if (parsed.protocol !== "https:") fail("--execution-url must use https.");
  if (/(api[_-]?key|token|bearer|secret|password|pat_)/i.test(executionUrl)) {
    fail("--execution-url appears to contain a secret. Store only public-safe execution evidence.");
  }
}

const allowedStatuses = new Set(["completed", "approval_required", "failed"]);
if (!allowedStatuses.has(responseStatus)) {
  fail(`Invalid --response-status. Expected one of: ${Array.from(allowedStatuses).join(", ")}`);
}

const expectedResponseStatus = expectedResponseStatusByAgent[agentId];
if (responseStatus !== "failed" && responseStatus !== expectedResponseStatus) {
  fail(`${agentId} live probe evidence must use --response-status ${expectedResponseStatus}. Received ${responseStatus}.`);
}

if (Number.isNaN(Date.parse(checkedAt))) fail("--checked-at must be an ISO-compatible timestamp.");

const defaultArtifact = {
  schema_version: "0.1.0",
  status: "awaiting_live_probe_evidence",
  boundary: "Public-safe live probe evidence placeholder. Replace awaiting entries only after public UAT probes reach n8n and return non-demo trace ids.",
  agents: Object.entries(agents).map(([id, name]) => ({
    agent_id: id,
    agent_name: name,
    status: "awaiting_probe",
    trace_id: "",
    demo: false,
    expected_response_status: expectedResponseStatusByAgent[id],
    record_command_template: `node scripts/record-n8n-live-probe-evidence.cjs --agent ${id} --trace-id TRACE_ID_FROM_N8N --execution-url https://YOUR-N8N-HOST/workflow/.../executions/... --response-status ${expectedResponseStatusByAgent[id]} --url-source github-pages-secret`,
    next_action: `Run ${name} live probe and record returned trace id.`,
  })),
};

let artifact = defaultArtifact;
if (fs.existsSync(outputPath)) {
  artifact = JSON.parse(fs.readFileSync(outputPath, "utf8"));
}

if (!Array.isArray(artifact.agents)) artifact.agents = [];

const entry = {
  agent_id: agentId,
  agent_name: agents[agentId],
  status: responseStatus === "failed" ? "failed" : "connected",
  checked_at: new Date(checkedAt).toISOString(),
  trace_id: traceId,
  demo: false,
  url_source: urlSource,
  evidence: {
    response_status: responseStatus,
    expected_response_status: expectedResponseStatus,
  },
};

if (executionUrl) entry.evidence.n8n_execution_url = executionUrl;
if (aiAgentNode) {
  entry.ai_agent = {
    integrated: true,
    node: aiAgentNode,
  };
}
if (responseStatus === "approval_required") {
  entry.evidence.approval_gate_confirmed = true;
}

const existingIndex = artifact.agents.findIndex((agent) => agent.agent_id === agentId);
if (existingIndex >= 0) {
  artifact.agents[existingIndex] = entry;
} else {
  artifact.agents.push(entry);
}

const requiredIds = Object.keys(agents);
artifact.agents = requiredIds.map((id) => artifact.agents.find((agent) => agent.agent_id === id) || defaultArtifact.agents.find((agent) => agent.agent_id === id));

const connectedCount = artifact.agents.filter((agent) => agent.status === "connected" && agent.trace_id && agent.demo !== true).length;
artifact.status = connectedCount === requiredIds.length ? "complete" : "partial";
artifact.updated_at = new Date().toISOString();
artifact.summary = {
  agent_count: requiredIds.length,
  connected_agent_count: connectedCount,
  missing_probe_agents: artifact.agents
    .filter((agent) => agent.status !== "connected" || !agent.trace_id || agent.demo === true)
    .map((agent) => agent.agent_id),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);

console.log(`Recorded live probe evidence for ${agentId}.`);
console.log(`Evidence artifact: ${path.relative(root, outputPath).replaceAll("\\", "/")}`);
console.log(`Connected agents: ${artifact.summary.connected_agent_count}/${artifact.summary.agent_count}`);
