#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const workflowPath = path.join(root, "workflows", "n8n", "import-ready", "actor-twin-direct-orchestrator.uat-live-urls.import.json");
const outRoot = path.join(root, "exports", "n8n-live-backups");
const defaultWorkflowId = "fDn8yXo3W41hh3yR";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const skipValidation = args.has("--skip-validation");

function fail(message) {
  console.error(`n8n actor update failed: ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) fail(`${command} ${commandArgs.join(" ")} returned ${result.status}`);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
}

function envUrl(name) {
  return String(process.env[name] || "").replace(/\/+$/, "");
}

async function n8nJson(method, endpoint, body) {
  const baseUrl = envUrl("N8N_API_BASE_URL");
  const apiKey = process.env.N8N_API_KEY;
  if (!baseUrl) fail("N8N_API_BASE_URL is required for --apply");
  if (!apiKey) fail("N8N_API_KEY is required for --apply");

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-N8N-API-KEY": apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // Keep raw text for diagnostics.
  }
  if (!response.ok) {
    const detail = typeof data === "string" ? data.slice(0, 500) : JSON.stringify(data).slice(0, 500);
    fail(`${method} ${endpoint} returned ${response.status}: ${detail}`);
  }
  return data;
}

function mergeLiveRuntimeDetails(candidate, live) {
  if (!live) return candidate;
  const liveByName = new Map((live.nodes || []).map((node) => [node.name, node]));
  const mergedNodes = candidate.nodes.map((node) => {
    const liveNode = liveByName.get(node.name);
    if (!liveNode) return node;
    const next = { ...node };
    if (liveNode.webhookId && node.type === "n8n-nodes-base.webhook") {
      next.webhookId = liveNode.webhookId;
    }
    if (liveNode.credentials && !node.credentials) {
      next.credentials = liveNode.credentials;
    }
    return next;
  });
  return {
    ...candidate,
    nodes: mergedNodes,
    settings: candidate.settings || live.settings || { executionOrder: "v1" },
    staticData: candidate.staticData ?? live.staticData ?? null,
  };
}

function buildPayload(workflow, live) {
  const payload = {
    name: live?.name || workflow.name || "MeIDs Actor Twin - staging",
    nodes: workflow.nodes,
    connections: workflow.connections || {},
    settings: workflow.settings || { executionOrder: "v1" },
    staticData: workflow.staticData ?? null,
  };
  return mergeLiveRuntimeDetails(payload, live);
}

async function main() {
  if (!skipValidation) {
    run(process.execPath, ["scripts/validate-actor-twin-direct-orchestrator-import.cjs"]);
    run(process.execPath, ["scripts/simulate-actor-twin-direct-orchestrator-import.cjs"]);
  }

  const workflow = readJson(workflowPath);
  const workflowId = process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || defaultWorkflowId;
  const outDir = path.join(outRoot, timestamp() + "-actor-direct-orchestrator");
  let live = null;

  if (apply) {
    live = await n8nJson("GET", `/api/v1/workflows/${workflowId}`);
    writeJson(path.join(outDir, "actor-twin.live-before.json"), live);
  }

  const payload = buildPayload(workflow, live);
  const payloadPath = path.join(outDir, "actor-twin.direct-orchestrator.update-payload.json");
  writeJson(payloadPath, payload);

  const summary = {
    status: apply ? "prepared_and_applied" : "prepared",
    workflow_id: workflowId,
    source: path.relative(root, workflowPath).replace(/\\/g, "/"),
    payload: path.relative(root, payloadPath).replace(/\\/g, "/"),
    node_count: payload.nodes.length,
    nodes: payload.nodes.map((node) => node.name),
    apply_requires: ["N8N_API_BASE_URL", "N8N_API_KEY"],
  };

  if (apply) {
    const updated = await n8nJson("PUT", `/api/v1/workflows/${workflowId}`, payload);
    writeJson(path.join(outDir, "actor-twin.live-after.json"), updated);
    summary.live_after = path.relative(root, path.join(outDir, "actor-twin.live-after.json")).replace(/\\/g, "/");
  }

  writeJson(path.join(outDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => fail(error.stack || error.message || String(error)));
