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
  : path.join(root, "frontend", "assets", "n8n-live-readiness-preflight.json");

const requiredAgents = [
  {
    agent_id: "actor_twin",
    agent_name: "Actor Twin",
    secret: "GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL",
    expected_response_status: "completed",
  },
  {
    agent_id: "knowledge_fabric_agent",
    agent_name: "Knowledge Fabric Agent",
    secret: "GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL",
    expected_response_status: "completed",
  },
  {
    agent_id: "agentic_butler",
    agent_name: "Agentic Butler",
    secret: "GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL",
    expected_response_status: "completed",
  },
];

function rel(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function readJson(relativePath, fallback = null) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readAssetJson(fileName, fallback = null) {
  const file = path.join(assetsDir, fileName);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function stableArtifact(artifact) {
  return {
    ...artifact,
    generated_at: "<ignored>",
  };
}

function byAgent(list = [], id) {
  return Array.isArray(list) ? list.find((item) => item.agent_id === id) || null : null;
}

function probeConnected(probe = {}) {
  return String(probe.status || "").toLowerCase() === "connected" && Boolean(probe.trace_id) && probe.demo !== true;
}

function buildAgentRow(agent, runtime, replay, evidence) {
  const runtimeAgent = byAgent(runtime?.agents, agent.agent_id) || {};
  const replayAgent = byAgent(replay?.agents, agent.agent_id) || {};
  const probeAgent = byAgent(evidence?.agents, agent.agent_id) || {};
  const urlReady = runtimeAgent.url_configured === true && runtimeAgent.status === "configured";
  const runtimeReady = runtimeAgent.runtime_ready === true
    || runtimeAgent.status === "configured"
    || runtimeAgent.status === "internal_tool_via_actor_twin";
  const internalTool = runtimeAgent.status === "internal_tool_via_actor_twin"
    || runtimeAgent.invocation_mode === "actor_twin_workflow_tool";
  const fixtureReady = replayAgent.status === "passed" && Number(replayAgent.case_count || 0) >= 5;
  const liveProbeReady = probeConnected(probeAgent);
  const blockers = [];
  if (!fixtureReady) blockers.push("fixture_replay_not_passed");
  if (!runtimeReady) blockers.push("runtime_path_missing");
  if (!liveProbeReady) blockers.push("live_probe_evidence_missing");
  return {
    agent_id: agent.agent_id,
    agent_name: agent.agent_name,
    status: blockers.length ? "blocked" : "ready",
    fixture: {
      status: replayAgent.status || "missing",
      case_count: Number(replayAgent.case_count || 0),
      source: replayAgent.source || "",
    },
    runtime_url: {
      status: runtimeAgent.status || "missing_url",
      configured: urlReady,
      runtime_ready: runtimeReady,
      invocation_mode: runtimeAgent.invocation_mode || (internalTool ? "actor_twin_workflow_tool" : "public_webhook"),
      url_origin: runtimeAgent.url_origin || "",
      github_pages_secret: agent.secret,
      next_action: runtimeAgent.next_action || (internalTool
        ? "Verify the Actor Twin n8n workflow tool is connected and published."
        : `Configure ${agent.secret}.`),
    },
    live_probe: {
      status: probeAgent.status || "awaiting_probe",
      connected: liveProbeReady,
      trace_id: probeAgent.trace_id || "",
      checked_at: probeAgent.checked_at || "",
      next_action: probeAgent.next_action || `Run ${agent.agent_name} live probe and record returned trace id.`,
    },
    commands: {
      set_url: `node scripts/set-n8n-agent-url.cjs --agent ${agent.agent_id} --url https://YOUR-N8N-HOST/webhook/...`,
      record_probe_evidence: `node scripts/record-n8n-live-probe-evidence.cjs --agent ${agent.agent_id} --trace-id TRACE_ID --execution-url https://YOUR-N8N-HOST/workflow/.../executions/... --response-status ${agent.expected_response_status}`,
    },
    blockers,
  };
}

function main() {
  const runtime = readAssetJson("n8n-runtime-readiness-status.json", {});
  const replay = readAssetJson("n8n-contract-replay-status.json", {});
  const evidence = readAssetJson("n8n-live-probe-evidence.json", {});
  const zielmodus = readAssetJson("zielmodus-4-readiness-status.json", {});
  const agents = requiredAgents.map((agent) => buildAgentRow(agent, runtime, replay, evidence));
  const fixtureReady = agents.every((agent) => agent.fixture.status === "passed");
  const runtimeReady = agents.every((agent) => agent.runtime_url.runtime_ready);
  const probeReady = agents.every((agent) => agent.live_probe.connected);
  const status = fixtureReady && runtimeReady && probeReady
    ? "ready_for_production_review"
    : fixtureReady && runtimeReady
      ? "live_probe_evidence_pending"
    : fixtureReady
        ? "partial_runtime_path_blocked"
        : "fixture_replay_blocked";
  const artifact = {
    schema_version: "0.1.0",
    generated_at: new Date().toISOString(),
    status,
    boundary: "Public-safe preflight only. It validates local artifacts, URL slot status, and recorded probe evidence; it does not call n8n and does not contain secrets.",
    summary: {
      agent_count: agents.length,
      fixture_ready_count: agents.filter((agent) => agent.fixture.status === "passed").length,
      url_ready_count: agents.filter((agent) => agent.runtime_url.configured).length,
      runtime_ready_count: agents.filter((agent) => agent.runtime_url.runtime_ready).length,
      live_probe_ready_count: agents.filter((agent) => agent.live_probe.connected).length,
      zielmodus_status: zielmodus.status || "unknown",
    },
    agents,
    next_actions: agents
      .filter((agent) => agent.blockers.length)
      .map((agent) => ({
        agent_id: agent.agent_id,
        blockers: agent.blockers,
        set_url: agent.commands.set_url,
        record_probe_evidence: agent.commands.record_probe_evidence,
      })),
  };

  if (write) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  }

  if (check) {
    if (!fs.existsSync(outputPath)) {
      console.error(`n8n live preflight artifact missing: ${rel(outputPath)}`);
      process.exit(1);
    }
    const current = readJsonFile(outputPath);
    const expected = stableArtifact(artifact);
    const actual = stableArtifact(current);
    if (JSON.stringify(actual, null, 2) !== JSON.stringify(expected, null, 2)) {
      console.error(`n8n live preflight artifact is stale: ${rel(outputPath)}`);
      console.error("Run: node scripts/write-n8n-live-readiness-preflight.cjs --write");
      process.exit(1);
    }
  }

  console.log(`n8n live preflight: ${artifact.status}`);
  console.log(`Fixtures: ${artifact.summary.fixture_ready_count}/${artifact.summary.agent_count}`);
  console.log(`URLs: ${artifact.summary.url_ready_count}/${artifact.summary.agent_count}`);
  console.log(`Live probes: ${artifact.summary.live_probe_ready_count}/${artifact.summary.agent_count}`);
  if (write) console.log(`Preflight artifact written: ${rel(outputPath)}`);
  if (args.has("--require-ready") && artifact.status !== "ready_for_production_review") process.exit(1);
}

main();
