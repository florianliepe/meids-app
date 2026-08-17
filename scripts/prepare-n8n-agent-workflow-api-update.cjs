#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const outRoot = path.join(root, "exports", "n8n-live-backups");

const agents = {
  knowledge_fabric_agent: {
    label: "Knowledge Fabric Agent",
    workflowEnv: "N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID",
    workflowPath: "workflows/n8n/import-ready/knowledge-fabric-agent.ai-agent.import.json",
    validateScript: "scripts/validate-n8n-ai-agent-workflows.cjs",
  },
  agentic_butler: {
    label: "Agentic Butler",
    workflowEnv: "N8N_AGENTIC_BUTLER_WORKFLOW_ID",
    workflowPath: "workflows/n8n/import-ready/agentic-butler.ai-agent.import.json",
    validateScript: "scripts/validate-n8n-ai-agent-workflows.cjs",
  },
};

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const skipValidation = args.includes("--skip-validation");
const agentArg = args.find((arg) => arg.startsWith("--agent="))?.split("=")[1] || "";

function fail(message) {
  console.error(`n8n agent update failed: ${message}`);
  process.exit(1);
}

function usage() {
  console.log([
    "Usage:",
    "  node scripts/prepare-n8n-agent-workflow-api-update.cjs --agent=knowledge_fabric_agent [--apply]",
    "  node scripts/prepare-n8n-agent-workflow-api-update.cjs --agent=agentic_butler [--apply]",
    "",
    "Required for --apply:",
    "  N8N_API_BASE_URL",
    "  N8N_API_KEY",
    "  N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID or N8N_AGENTIC_BUTLER_WORKFLOW_ID",
  ].join("\n"));
}

if (!agents[agentArg]) {
  usage();
  fail(`Unknown --agent value: ${agentArg || "(missing)"}`);
}

const spec = agents[agentArg];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
    // Keep raw response for diagnostics.
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
  return {
    ...candidate,
    name: live.name || candidate.name,
    nodes: candidate.nodes.map((node) => {
      const liveNode = liveByName.get(node.name);
      if (!liveNode) return node;
      const next = { ...node };
      if (liveNode.webhookId && node.type === "n8n-nodes-base.webhook") next.webhookId = liveNode.webhookId;
      if (liveNode.credentials && !node.credentials) next.credentials = liveNode.credentials;
      return next;
    }),
    settings: candidate.settings || live.settings || { executionOrder: "v1" },
    staticData: candidate.staticData ?? live.staticData ?? null,
  };
}

function buildPayload(workflow, live) {
  const payload = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections || {},
    settings: workflow.settings || { executionOrder: "v1" },
    staticData: workflow.staticData ?? null,
  };
  return mergeLiveRuntimeDetails(payload, live);
}

async function main() {
  if (!skipValidation) run(process.execPath, [spec.validateScript]);

  const workflowId = process.env[spec.workflowEnv];
  const workflow = readJson(path.join(root, spec.workflowPath));
  const outDir = path.join(outRoot, `${timestamp()}-${agentArg}-ai-agent`);
  let live = null;

  if (apply) {
    if (!workflowId) fail(`${spec.workflowEnv} is required for --apply`);
    live = await n8nJson("GET", `/api/v1/workflows/${workflowId}`);
    writeJson(path.join(outDir, `${agentArg}.live-before.json`), live);
  }

  const payload = buildPayload(workflow, live);
  const payloadPath = path.join(outDir, `${agentArg}.update-payload.json`);
  writeJson(payloadPath, payload);

  const summary = {
    status: apply ? "prepared_and_applied" : "prepared",
    agent_id: agentArg,
    label: spec.label,
    workflow_id: workflowId || null,
    source: spec.workflowPath,
    payload: path.relative(root, payloadPath).replace(/\\/g, "/"),
    node_count: payload.nodes.length,
    nodes: payload.nodes.map((node) => node.name),
    apply_requires: ["N8N_API_BASE_URL", "N8N_API_KEY", spec.workflowEnv],
  };

  if (apply) {
    const updated = await n8nJson("PUT", `/api/v1/workflows/${workflowId}`, payload);
    writeJson(path.join(outDir, `${agentArg}.live-after.json`), updated);
    summary.live_after = path.relative(root, path.join(outDir, `${agentArg}.live-after.json`)).replace(/\\/g, "/");
  }

  writeJson(path.join(outDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => fail(error.stack || error.message || String(error)));
