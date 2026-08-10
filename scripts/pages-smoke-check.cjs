const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const requiredPaths = [
  "index.html",
  "styles.css",
  "app.js",
  "api.js",
  "runtime-config.js",
  "assets/intellectual-twin-hero-mark.svg",
  "assets/intellectual-twin-mark.svg",
  "assets/agent-runtime-config.json",
  "assets/n8n-runtime-readiness-status.json",
  "assets/n8n-live-probe-evidence.json",
  "assets/n8n-live-readiness-preflight.json",
  "assets/n8n-live-handoff-commands.json",
  "assets/okf-validation-status.json",
  "assets/zielmodus-4-readiness-status.json",
  "assets/zielmodus-4-live-completion-checklist.json",
];

const requiredN8nAgents = ["actor_twin", "knowledge_fabric_agent", "agentic_butler"];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON artifact ${filePath}: ${error.message}`);
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
}

function hasAgent(collection, agentId) {
  if (Array.isArray(collection)) return collection.some((agent) => agent.agent_id === agentId);
  if (collection && typeof collection === "object") return Object.prototype.hasOwnProperty.call(collection, agentId);
  return false;
}

function checkContractArtifacts(root) {
  const assetsRoot = path.join(root, "assets");
  const runtime = readJson(path.join(assetsRoot, "agent-runtime-config.json"));
  const runtimeReadiness = readJson(path.join(assetsRoot, "n8n-runtime-readiness-status.json"));
  const probeEvidence = readJson(path.join(assetsRoot, "n8n-live-probe-evidence.json"));
  const preflight = readJson(path.join(assetsRoot, "n8n-live-readiness-preflight.json"));
  const handoffCommands = readJson(path.join(assetsRoot, "n8n-live-handoff-commands.json"));
  const okfStatus = readJson(path.join(assetsRoot, "okf-validation-status.json"));
  const zielmodus = readJson(path.join(assetsRoot, "zielmodus-4-readiness-status.json"));
  const completionChecklist = readJson(path.join(assetsRoot, "zielmodus-4-live-completion-checklist.json"));

  requireObject(runtime.n8nAgentWebhooks, "agent-runtime-config.json n8nAgentWebhooks");
  requireArray(runtimeReadiness.agents, "n8n-runtime-readiness-status.json agents");
  requireArray(probeEvidence.agents, "n8n-live-probe-evidence.json agents");
  requireObject(preflight.summary, "n8n-live-readiness-preflight.json summary");
  requireObject(handoffCommands.summary, "n8n-live-handoff-commands.json summary");
  requireObject(okfStatus.summary, "okf-validation-status.json summary");
  requireObject(zielmodus.summary, "zielmodus-4-readiness-status.json summary");
  requireObject(completionChecklist.summary, "zielmodus-4-live-completion-checklist.json summary");
  requireArray(completionChecklist.agents, "zielmodus-4-live-completion-checklist.json agents");

  for (const agentId of requiredN8nAgents) {
    if (!hasAgent(runtime.n8nAgentWebhooks, agentId)) throw new Error(`agent-runtime-config.json missing ${agentId}`);
    if (!hasAgent(runtimeReadiness.agents, agentId)) throw new Error(`n8n-runtime-readiness-status.json missing ${agentId}`);
    if (!hasAgent(probeEvidence.agents, agentId)) throw new Error(`n8n-live-probe-evidence.json missing ${agentId}`);
    if (!hasAgent(handoffCommands.agents, agentId)) throw new Error(`n8n-live-handoff-commands.json missing ${agentId}`);
    if (!hasAgent(completionChecklist.agents, agentId)) throw new Error(`zielmodus-4-live-completion-checklist.json missing ${agentId}`);
  }

  if (!Array.isArray(preflight.agents) || preflight.agents.length !== requiredN8nAgents.length) {
    throw new Error("n8n-live-readiness-preflight.json must contain the three top-level agents");
  }
  for (const agentId of requiredN8nAgents) {
    if (!hasAgent(preflight.agents, agentId)) {
      throw new Error(`n8n-live-readiness-preflight.json missing ${agentId}`);
    }
  }

  const fixtureCount = Number(preflight.summary.fixture_ready_count || 0);
  if (fixtureCount !== requiredN8nAgents.length) {
    throw new Error(`Expected ${requiredN8nAgents.length} n8n fixtures ready, found ${fixtureCount}`);
  }

  const urlReadyCount = Number(preflight.summary.url_ready_count || 0);
  const liveProbeReadyCount = Number(preflight.summary.live_probe_ready_count || 0);
  if (preflight.status === "ready_for_production_review" && (urlReadyCount < 3 || liveProbeReadyCount < 3)) {
    throw new Error("n8n preflight cannot be production-ready until all URLs and live probes are ready");
  }

  if (zielmodus.status === "ready_for_production_review" && !zielmodus.summary.live_ready) {
    throw new Error("Zielmodus 4 status cannot be production-ready while live_ready is false");
  }

  if (completionChecklist.status === "ready_for_strict_gate" && zielmodus.status !== "complete") {
    throw new Error("Zielmodus live completion checklist cannot be ready while Zielmodus status is not complete");
  }

  if (okfStatus.status && !["passed", "ready", "partial", "warning"].includes(okfStatus.status)) {
    throw new Error(`Unexpected OKF validation status: ${okfStatus.status}`);
  }
}

function checkDirectory(root) {
  const missing = requiredPaths.filter((file) => !fs.existsSync(path.join(root, file)));
  if (missing.length) {
    throw new Error(`Missing Pages artifact files: ${missing.join(", ")}`);
  }
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  for (const literal of ["styles.css", "runtime-config.js", "api.js", "app.js"]) {
    if (!html.includes(literal)) throw new Error(`index.html does not reference ${literal}`);
  }
  checkContractArtifacts(root);
}

function request(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      })
      .on("error", reject);
  });
}

async function checkUrl(baseUrl) {
  const cleanBase = String(baseUrl).replace(/\/+$/, "");
  const checks = await Promise.all(requiredPaths.map(async (file) => [file, await request(`${cleanBase}/${file}`)]));
  const failures = checks.filter(([, status]) => status !== 200);
  if (failures.length) {
    throw new Error(`Live Pages checks failed: ${failures.map(([file, status]) => `${file}=${status}`).join(", ")}`);
  }
}

(async () => {
  const target = process.argv[2] || "dist-pages";
  if (/^https:\/\//i.test(target)) {
    await checkUrl(target);
  } else {
    checkDirectory(target);
  }
  console.log(`Pages smoke check passed: ${target}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
