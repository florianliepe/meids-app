const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultConfigPath = path.join(root, "frontend", "assets", "agent-runtime-config.json");
const defaultOutputPath = path.join(root, "frontend", "assets", "n8n-runtime-readiness-status.json");

const agents = [
  {
    agent_id: "actor_twin",
    agent_name: "Actor Twin",
    frontend_required: true,
    env_var: "N8N_ACTOR_TWIN_WEBHOOK_URL",
    top_level_url_key: "n8nActorTwinWebhookUrl",
    github_pages_secret: "GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL",
    required_capabilities: ["intent_interpretation", "retrieval_policy", "trace_response"],
  },
  {
    agent_id: "knowledge_fabric_agent",
    agent_name: "Knowledge Fabric Agent",
    frontend_required: false,
    env_var: "N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL",
    top_level_url_key: "n8nKnowledgeFabricWebhookUrl",
    github_pages_secret: "GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL",
    required_capabilities: ["okf_ingest", "evidence_storage", "graph_curator_trigger", "vector_boundary"],
  },
  {
    agent_id: "agentic_butler",
    agent_name: "Agentic Butler",
    frontend_required: false,
    env_var: "N8N_AGENTIC_BUTLER_WEBHOOK_URL",
    top_level_url_key: "n8nAgenticButlerWebhookUrl",
    github_pages_secret: "GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL",
    required_capabilities: ["autonomous_work_artifact_execution", "new_skill_activation_gate", "trace_response"],
  },
];

const forbiddenPatterns = [
  /github_pat_/i,
  /\bsk-[A-Za-z0-9_-]{12,}/,
  /\bBearer\s+[A-Za-z0-9._-]+/i,
  /AZURE_[A-Z0-9_]*KEY\s*=/i,
];

function parseArgs(argv) {
  const args = { config: defaultConfigPath, output: defaultOutputPath, write: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      args.config = path.resolve(argv[index + 1] || "");
      index += 1;
    } else if (arg === "--output") {
      args.output = path.resolve(argv[index + 1] || "");
      index += 1;
    } else if (arg === "--check") {
      args.write = false;
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function safeRelative(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function fail(message) {
  throw new Error(message);
}

function assertNoSecrets(configPath, serialized) {
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(serialized)) fail(`${safeRelative(configPath)} contains forbidden secret-like value: ${pattern}`);
  }
}

function configuredUrl(config, agent) {
  const webhooks = config.n8nAgentWebhooks || config.n8n_agent_webhooks || {};
  return String(
    webhooks[agent.agent_id]
      || webhooks[agent.agent_id.replaceAll("_", "-")]
      || config[agent.top_level_url_key]
      || "",
  ).trim();
}

function validWebhookUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /\/webhook\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function agentProbeSlot(config, agentId) {
  return (config.n8nAgentProbeSlots || config.n8n_agent_probe_slots || {})[agentId] || {};
}

function readinessForAgent(config, agent) {
  const url = configuredUrl(config, agent);
  const slot = agentProbeSlot(config, agent.agent_id);
  const urlConfigured = Boolean(url);
  const urlValid = validWebhookUrl(url);
  const slotStatus = String(slot.status || "").trim();
  const internalTool = !agent.frontend_required && !urlConfigured && slotStatus === "internal_tool_via_actor_twin";
  const status = urlConfigured && urlValid
    ? "configured"
    : internalTool
      ? "internal_tool_via_actor_twin"
    : slotStatus === "awaiting_url"
      ? "awaiting_url"
      : "missing_url";
  const runtimeReady = (urlConfigured && urlValid) || internalTool;
  const gates = [
    {
      gate: "runtime_asset",
      ready: true,
      detail: "Public runtime asset is available.",
    },
    {
      gate: "webhook_url",
      ready: runtimeReady,
      detail: internalTool
        ? "Direct public frontend URL is optional; Actor Twin calls this agent inside n8n."
        : urlConfigured
        ? (urlValid ? "Webhook URL has public https webhook shape." : "URL exists but does not match expected https webhook shape.")
        : "No public UAT webhook URL configured.",
    },
    {
      gate: "probe_slot",
      ready: Boolean(slotStatus && slot.probe_boundary && slot.next_action),
      detail: slotStatus ? `Probe slot status: ${slotStatus}.` : "Probe slot metadata is missing.",
    },
    {
      gate: "public_safe",
      ready: true,
      detail: "No secret-like value detected by static validator.",
    },
  ];
  return {
    agent_id: agent.agent_id,
    agent_name: agent.agent_name,
    status,
    status_label: status === "configured" ? "URL configured" : status === "internal_tool_via_actor_twin" ? "internal n8n tool" : status === "awaiting_url" ? "awaiting URL" : "missing URL",
    url_configured: urlConfigured && urlValid,
    runtime_ready: runtimeReady,
    frontend_required: agent.frontend_required,
    invocation_mode: internalTool ? "actor_twin_workflow_tool" : "public_webhook",
    url_origin: urlConfigured && urlValid ? new URL(url).origin : "",
    url_shape: urlConfigured ? (urlValid ? "valid_public_webhook" : "invalid_webhook_shape") : "empty",
    env_var: agent.env_var,
    github_pages_secret: agent.github_pages_secret,
    top_level_url_key: agent.top_level_url_key,
    probe_slot_status: slotStatus || "missing",
    detail: runtimeReady
      ? (slot.probe_boundary || "Public UAT webhook configured; run live probe and capture trace evidence.")
      : (slot.probe_boundary || "Fixture replay remains available until a public UAT webhook is configured."),
    next_action: slot.next_action || (urlConfigured && urlValid
      ? "Run live probe and capture n8n execution trace."
      : "Create/publish the n8n workflow and add its public UAT webhook URL."),
    required_capabilities: agent.required_capabilities,
    gates,
  };
}

function buildArtifact(configPath) {
  const config = readJson(configPath);
  const serialized = JSON.stringify(config);
  assertNoSecrets(configPath, serialized);
  const readiness = agents.map((agent) => readinessForAgent(config, agent));
  const configured = readiness.filter((agent) => agent.url_configured);
  const runtimeReady = readiness.filter((agent) => agent.runtime_ready);
  const frontendReady = readiness.filter((agent) => agent.frontend_required ? agent.runtime_ready : true);
  const awaiting = readiness.filter((agent) => agent.status === "awaiting_url");
  return {
    schema_version: "0.1.0",
    generated_at: new Date().toISOString(),
    source: safeRelative(configPath),
    orchestration_mode: config.orchestration_mode || "actor_twin_embedded_chat",
    status: runtimeReady.length === agents.length ? "runtime_ready" : configured.length === agents.length ? "configured" : "partial",
    summary: {
      agent_count: agents.length,
      configured_count: configured.length,
      runtime_ready_count: runtimeReady.length,
      frontend_required_count: readiness.filter((agent) => agent.frontend_required).length,
      frontend_ready_count: frontendReady.length,
      awaiting_url_count: awaiting.length,
      missing_count: readiness.length - configured.length - awaiting.length,
    },
    boundary: "Public-safe runtime readiness artifact. It validates the embedded Actor Twin chat entrypoint plus optional direct public webhook slots. Knowledge Fabric Agent and Agentic Butler may be runtime-ready as internal Actor Twin workflow tools without public Pages URLs.",
    agents: readiness,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifact = buildArtifact(args.config);
  if (args.write) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  }
  console.log(`n8n runtime readiness: ${artifact.summary.runtime_ready_count}/${artifact.summary.agent_count} runtime paths ready (${artifact.summary.configured_count}/${artifact.summary.agent_count} direct URLs configured)`);
  if (args.write) console.log(`runtime readiness written: ${safeRelative(args.output)}`);
}

main();
