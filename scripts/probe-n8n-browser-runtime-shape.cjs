const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultConfig = path.join(root, "frontend", "assets", "agent-runtime-config.json");
const defaultOutput = path.join(root, "frontend", "assets", "n8n-browser-runtime-shape.json");
const githubPagesOrigin = "https://florianliepe.github.io";

const agents = [
  { agent_id: "actor_twin", fixture: "actor-twin.json", expected_status: "completed" },
  { agent_id: "knowledge_fabric_agent", fixture: "knowledge-fabric-agent.json", expected_status: "completed" },
  { agent_id: "agentic_butler", fixture: "agentic-butler.json", expected_status: "completed" },
];

function argValue(name, fallback = "") {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
}

function rel(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function parseMaybeJson(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { output: { answer: raw } };
  }
}

function normalizeShape(agentId, data = {}) {
  const response = data.response || data.data || data || {};
  const output = normalizeOutput(response.output || data.output || data);
  const status = response.status || data.status || "completed";
  return {
    envelope_version: response.envelope_version || data.envelope_version || "",
    request_id: response.request_id || data.request_id || "",
    agent_id: response.agent_id || data.agent_id || agentId,
    status,
    has_output: Boolean(output && typeof output === "object" && Object.keys(output).length),
    has_route_decision: Boolean(output?.route_decision),
    has_approval: Boolean(response.approval || data.approval || output.approval),
    has_trace_id: Boolean(response.trace?.trace_id || data.trace?.trace_id || output.trace?.trace_id || response.trace_id || data.trace_id),
  };
}

function normalizeOutput(output = {}) {
  if (!output || typeof output !== "object") return output;
  const embedded = parseEmbeddedJsonObject(output.answer || output.text || output.message || "");
  if (!embedded || typeof embedded !== "object") return output;
  const embeddedOutput = embedded.output && typeof embedded.output === "object" ? embedded.output : embedded;
  return {
    ...output,
    ...embeddedOutput,
    approval: embedded.approval || output.approval,
    trace: embedded.trace || output.trace,
  };
}

function parseEmbeddedJsonObject(value = "") {
  const text = String(value || "").trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function fixtureProbe(agent) {
  const fixturePath = path.join(root, "contracts", "n8n", "fixtures", agent.fixture);
  const fixture = readJson(fixturePath);
  const probe = fixture.live_probe || fixture.request;
  return {
    ...probe,
    request_id: `${probe.request_id || `req_${agent.agent_id}_browser_probe`}_${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
  };
}

function getUrl(config, agentId) {
  const webhooks = config.n8nAgentWebhooks || config.n8n_agent_webhooks || {};
  return webhooks[agentId]
    || config[`n8n${agentId.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join("")}WebhookUrl`]
    || "";
}

async function probeAgent(config, agent) {
  const url = getUrl(config, agent.agent_id);
  const startedAt = new Date().toISOString();
  if (!url) {
    return {
      agent_id: agent.agent_id,
      status: "blocked",
      expected_response_status: agent.expected_status,
      checked_at: startedAt,
      browser_origin: githubPagesOrigin,
      cors: { header_present: false, allow_origin: "" },
      response_shape: {},
      error: "No public UAT webhook URL configured.",
    };
  }
  const request = fixtureProbe(agent);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": githubPagesOrigin,
      },
      body: JSON.stringify(request),
    });
    const raw = await response.text();
    const data = parseMaybeJson(raw);
    const allowOrigin = response.headers.get("access-control-allow-origin") || "";
    const allowMethods = response.headers.get("access-control-allow-methods") || "";
    const shape = normalizeShape(agent.agent_id, data);
    const contractStatusOk = !shape.status || shape.status === agent.expected_status || ["completed", "approval_required", "failed"].includes(shape.status);
    return {
      agent_id: agent.agent_id,
      status: response.ok && contractStatusOk ? "called" : "blocked",
      expected_response_status: agent.expected_status,
      checked_at: startedAt,
      browser_origin: githubPagesOrigin,
      http_status: response.status,
      cors: {
        header_present: Boolean(allowOrigin),
        allow_origin: allowOrigin,
        allow_methods: allowMethods,
        browser_call_risk: allowOrigin ? "low" : "cors_header_missing_use_backend_proxy_for_production",
      },
      response_shape: shape,
      body_preview: raw.slice(0, 240),
    };
  } catch (error) {
    return {
      agent_id: agent.agent_id,
      status: "blocked",
      expected_response_status: agent.expected_status,
      checked_at: startedAt,
      browser_origin: githubPagesOrigin,
      cors: { header_present: false, allow_origin: "" },
      response_shape: {},
      error: error.message,
    };
  }
}

function validateArtifact(artifact) {
  if (artifact.schema_version !== "0.1.0") throw new Error("schema_version must be 0.1.0");
  if (!Array.isArray(artifact.agents)) throw new Error("agents must be an array");
  const seen = new Set();
  for (const agent of artifact.agents) {
    if (!agents.some((item) => item.agent_id === agent.agent_id)) throw new Error(`Unexpected agent_id: ${agent.agent_id}`);
    if (!agent.expected_response_status) throw new Error(`${agent.agent_id} missing expected_response_status`);
    if (!agent.checked_at) throw new Error(`${agent.agent_id} missing checked_at`);
    if (!agent.cors || typeof agent.cors !== "object") throw new Error(`${agent.agent_id} missing cors object`);
    if (!agent.response_shape || typeof agent.response_shape !== "object") throw new Error(`${agent.agent_id} missing response_shape`);
    seen.add(agent.agent_id);
  }
  for (const agent of agents) {
    if (!seen.has(agent.agent_id)) throw new Error(`Missing browser runtime shape entry for ${agent.agent_id}`);
  }
}

async function main() {
  const output = path.resolve(root, argValue("--output", rel(defaultOutput)));
  const check = process.argv.includes("--check");
  if (check) {
    const artifact = readJson(output);
    validateArtifact(artifact);
    console.log(`n8n browser runtime shape artifact valid: ${rel(output)}`);
    return;
  }
  const config = readJson(path.resolve(root, argValue("--config", rel(defaultConfig))));
  const results = [];
  for (const agent of agents) {
    results.push(await probeAgent(config, agent));
  }
  const called = results.filter((item) => item.status === "called").length;
  const corsReady = results.filter((item) => item.cors?.header_present).length;
  const actorRouteGap = results.filter((item) => item.agent_id === "actor_twin" && !item.response_shape?.has_route_decision).length;
  const artifact = {
    schema_version: "0.1.0",
    generated_at: new Date().toISOString(),
    purpose: "Public-safe browser/runtime response-shape probe for MeIDs top-level n8n agents.",
    boundary: "The probe uses no private knowledge and does not require credentials. Missing CORS headers are treated as a backend proxy requirement.",
    summary: {
      agent_count: agents.length,
      called_count: called,
      cors_ready_count: corsReady,
      actor_route_decision_gap_count: actorRouteGap,
      backend_proxy_recommended: corsReady < agents.length || actorRouteGap > 0,
    },
    agents: results,
  };
  writeJson(output, artifact);
  validateArtifact(artifact);
  console.log(`n8n browser runtime shape written: ${rel(output)} (${called}/${agents.length} called, ${corsReady}/${agents.length} CORS-ready)`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
