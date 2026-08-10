const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const check = args.has("--check");

function argValue(name) {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const outputArg = argValue("--output");
const assetsDirArg = argValue("--assets-dir");
const assetsDir = assetsDirArg
  ? path.resolve(root, assetsDirArg)
  : path.join(root, "frontend", "assets");
const outputPath = outputArg
  ? path.resolve(root, outputArg)
  : path.join(root, "frontend", "assets", "n8n-live-handoff-commands.json");

const requiredAgents = [
  {
    agent_id: "actor_twin",
    agent_name: "Actor Twin",
    secret: "GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL",
    expected_response_status: "completed",
    probe: "answer-only query with trace response",
  },
  {
    agent_id: "knowledge_fabric_agent",
    agent_name: "Knowledge Fabric Agent",
    secret: "GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL",
    expected_response_status: "completed",
    probe: "no-write upload/transcript ingest fixture",
  },
  {
    agent_id: "agentic_butler",
    agent_name: "Agentic Butler",
    secret: "GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL",
    expected_response_status: "approval_required",
    probe: "approval-required skill activation fixture",
  },
];

function rel(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function readJson(relativePath, fallback = {}) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readAssetJson(fileName, fallback = {}) {
  const file = path.join(assetsDir, fileName);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function byAgent(list, agentId) {
  return Array.isArray(list) ? list.find((item) => item.agent_id === agentId) || {} : {};
}

function stableArtifact(artifact) {
  return {
    ...artifact,
    generated_at: "<ignored>",
  };
}

function buildAgentHandoff(agent, runtime, evidence) {
  const runtimeAgent = byAgent(runtime.agents, agent.agent_id);
  const evidenceAgent = byAgent(evidence.agents, agent.agent_id);
  const urlConfigured = runtimeAgent.status === "configured" && runtimeAgent.url_configured === true;
  const probeConnected = String(evidenceAgent.status || "").toLowerCase() === "connected" && Boolean(evidenceAgent.trace_id) && evidenceAgent.demo !== true;
  const open_steps = [];
  if (!urlConfigured) {
    open_steps.push("configure_live_url");
  }
  if (!probeConnected) {
    open_steps.push("record_live_probe_evidence");
  }
  return {
    agent_id: agent.agent_id,
    agent_name: agent.agent_name,
    status: open_steps.length ? "action_required" : "ready_for_strict_gate",
    github_pages_secret: agent.secret,
    live_url_configured: urlConfigured,
    live_probe_connected: probeConnected,
    probe: agent.probe,
    expected_response_status: agent.expected_response_status,
    open_steps,
    commands: {
      local_public_uat_url: `node scripts/set-n8n-agent-url.cjs --agent ${agent.agent_id} --url https://YOUR-N8N-HOST/webhook/YOUR-${agent.agent_id.toUpperCase().replaceAll("_", "-")}-UAT-PATH`,
      record_probe: `node scripts/record-n8n-live-probe-evidence.cjs --agent ${agent.agent_id} --trace-id TRACE_ID_FROM_N8N --execution-url https://YOUR-N8N-HOST/workflow/.../executions/... --response-status ${agent.expected_response_status} --url-source github-pages-secret`,
    },
  };
}

function buildArtifact() {
  const runtime = readAssetJson("n8n-runtime-readiness-status.json");
  const evidence = readAssetJson("n8n-live-probe-evidence.json");
  const agents = requiredAgents.map((agent) => buildAgentHandoff(agent, runtime, evidence));
  const missingUrlCount = agents.filter((agent) => !agent.live_url_configured).length;
  const missingProbeCount = agents.filter((agent) => !agent.live_probe_connected).length;
  return {
    schema_version: "0.1.0",
    generated_at: new Date().toISOString(),
    status: missingUrlCount
      ? "partial_live_url_blocked"
      : missingProbeCount
        ? "live_probe_evidence_pending"
        : "ready_for_strict_gate",
    boundary: "Public-safe operational handoff. Contains placeholder commands and GitHub secret names only; no live URLs, credentials, traces, or private knowledge.",
    summary: {
      agent_count: agents.length,
      missing_live_url_count: missingUrlCount,
      missing_probe_trace_count: missingProbeCount,
      strict_gate_commands: [
        "node scripts/write-n8n-runtime-readiness-status.cjs --check",
        "node scripts/write-n8n-live-readiness-preflight.cjs --check",
        "node scripts/write-zielmodus-4-live-completion-checklist.cjs --check",
        "node scripts/validate-zielmodus-4-readiness.cjs --require-live-probes",
        "node scripts/check-zielmodus-4-public-safe.cjs",
      ],
    },
    github_pages_secrets: requiredAgents.map((agent) => agent.secret),
    agents,
  };
}

function main() {
  const artifact = buildArtifact();
  if (write) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  }
  if (check) {
    if (!fs.existsSync(outputPath)) {
      console.error(`n8n live handoff commands artifact missing: ${rel(outputPath)}`);
      process.exit(1);
    }
    const current = readJson(rel(outputPath));
    if (JSON.stringify(stableArtifact(current), null, 2) !== JSON.stringify(stableArtifact(artifact), null, 2)) {
      console.error(`n8n live handoff commands artifact is stale: ${rel(outputPath)}`);
      console.error("Run: node scripts/write-n8n-live-handoff-commands.cjs --write");
      process.exit(1);
    }
  }
  console.log(`n8n live handoff commands: ${artifact.status}`);
  console.log(`Missing URLs: ${artifact.summary.missing_live_url_count}/${artifact.summary.agent_count}`);
  console.log(`Missing probe traces: ${artifact.summary.missing_probe_trace_count}/${artifact.summary.agent_count}`);
  if (write) console.log(`Handoff artifact written: ${rel(outputPath)}`);
}

main();
