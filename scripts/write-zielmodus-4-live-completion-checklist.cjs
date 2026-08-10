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
  : path.join(root, "frontend", "assets", "zielmodus-4-live-completion-checklist.json");

const requiredAgents = [
  {
    agent_id: "actor_twin",
    agent_name: "Actor Twin",
    secret: "GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL",
    probe: "answer-only query with trace response",
    response_status: "completed",
    estimate_minutes_after_url: "10-15",
  },
  {
    agent_id: "knowledge_fabric_agent",
    agent_name: "Knowledge Fabric Agent",
    secret: "GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL",
    probe: "no-write upload/transcript ingest fixture",
    response_status: "completed",
    estimate_minutes_after_url: "10-20",
  },
  {
    agent_id: "agentic_butler",
    agent_name: "Agentic Butler",
    secret: "GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL",
    probe: "approval-required skill activation fixture",
    response_status: "approval_required",
    estimate_minutes_after_url: "15-25",
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

function probeConnected(probe = {}) {
  return String(probe.status || "").toLowerCase() === "connected" && Boolean(probe.trace_id) && probe.demo !== true;
}

function buildAgentChecklist(agent, runtime, evidence, preflight) {
  const runtimeAgent = byAgent(runtime.agents, agent.agent_id);
  const evidenceAgent = byAgent(evidence.agents, agent.agent_id);
  const preflightAgent = byAgent(preflight.agents, agent.agent_id);
  const urlConfigured = runtimeAgent.status === "configured" && runtimeAgent.url_configured === true;
  const probeReady = probeConnected(evidenceAgent);
  const openItems = [];
  if (!urlConfigured) {
    openItems.push({
      type: "live_url",
      label: `Configure ${agent.agent_name} live URL`,
      required_key: agent.secret,
      command: `node scripts/set-n8n-agent-url.cjs --agent ${agent.agent_id} --url https://YOUR-N8N-HOST/webhook/...`,
    });
  }
  if (!probeReady) {
    openItems.push({
      type: "live_probe",
      label: `Record ${agent.agent_name} non-demo probe evidence`,
      probe: agent.probe,
      command: `node scripts/record-n8n-live-probe-evidence.cjs --agent ${agent.agent_id} --trace-id TRACE_ID --execution-url https://YOUR-N8N-HOST/workflow/.../executions/... --response-status ${agent.response_status}`,
    });
  }
  return {
    agent_id: agent.agent_id,
    agent_name: agent.agent_name,
    status: openItems.length ? "open" : "ready_for_final_gate",
    runtime_url_status: runtimeAgent.status || "missing",
    url_configured: urlConfigured,
    live_probe_status: evidenceAgent.status || "awaiting_probe",
    live_probe_connected: probeReady,
    blockers: preflightAgent.blockers || openItems.map((item) => item.type),
    estimate_minutes_after_url: agent.estimate_minutes_after_url,
    open_items: openItems,
  };
}

function buildArtifact() {
  const runtime = readAssetJson("n8n-runtime-readiness-status.json");
  const evidence = readAssetJson("n8n-live-probe-evidence.json");
  const preflight = readAssetJson("n8n-live-readiness-preflight.json");
  const zielmodus = readAssetJson("zielmodus-4-readiness-status.json");
  const agents = requiredAgents.map((agent) => buildAgentChecklist(agent, runtime, evidence, preflight));
  const missingUrlCount = agents.filter((agent) => !agent.url_configured).length;
  const missingProbeCount = agents.filter((agent) => !agent.live_probe_connected).length;
  const status = missingUrlCount
    ? "partial_live_url_blocked"
    : missingProbeCount
      ? "live_probe_evidence_pending"
      : "ready_for_strict_gate";
  return {
    schema_version: "0.1.0",
    generated_at: new Date().toISOString(),
    status,
    boundary: "Public-safe checklist. It contains no secrets and does not call n8n; it derives the remaining completion work from committed readiness artifacts.",
    summary: {
      agent_count: agents.length,
      missing_live_url_count: missingUrlCount,
      missing_probe_trace_count: missingProbeCount,
      estimated_remaining_after_urls_exist: "45-90 minutes",
      zielmodus_status: zielmodus.status || "unknown",
      preflight_status: preflight.status || "unknown",
    },
    artifacts: {
      completion_plan: "docs/production/zielmodus-4-live-completion-plan.md",
      readiness_audit: "docs/production/zielmodus-4-readiness-audit.md",
      runtime_readiness: "frontend/assets/n8n-runtime-readiness-status.json",
      probe_evidence: "frontend/assets/n8n-live-probe-evidence.json",
      preflight: "frontend/assets/n8n-live-readiness-preflight.json",
      zielmodus_status: "frontend/assets/zielmodus-4-readiness-status.json",
    },
    agents,
    final_gate_commands: [
      "node scripts/write-n8n-live-readiness-preflight.cjs --check",
      "node scripts/validate-zielmodus-4-readiness.cjs --require-live",
      "node scripts/validate-zielmodus-4-readiness.cjs --require-live-probes",
      "node scripts/pages-smoke-check.cjs frontend",
    ],
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
      console.error(`Zielmodus live completion checklist missing: ${rel(outputPath)}`);
      process.exit(1);
    }
    const current = readJson(rel(outputPath));
    const actual = stableArtifact(current);
    const expected = stableArtifact(artifact);
    if (JSON.stringify(actual, null, 2) !== JSON.stringify(expected, null, 2)) {
      console.error(`Zielmodus live completion checklist is stale: ${rel(outputPath)}`);
      console.error("Run: node scripts/write-zielmodus-4-live-completion-checklist.cjs --write");
      process.exit(1);
    }
  }

  console.log(`Zielmodus live completion checklist: ${artifact.status}`);
  console.log(`Missing URLs: ${artifact.summary.missing_live_url_count}/${artifact.summary.agent_count}`);
  console.log(`Missing probe traces: ${artifact.summary.missing_probe_trace_count}/${artifact.summary.agent_count}`);
  if (write) console.log(`Checklist artifact written: ${rel(outputPath)}`);
}

main();
