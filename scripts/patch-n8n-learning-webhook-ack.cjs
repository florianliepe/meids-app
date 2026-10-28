#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const applyLive = process.argv.includes("--apply");
const workflowId = String(process.env.N8N_LEARNING_AGENT_WORKFLOW_ID || "zX0s3hOByJ4HWQye");
const canonicalPaths = [
  path.join(root, "workflows", "n8n", "learning-agent.workflow.json"),
  path.join(root, "workflows", "n8n", "import-ready", "learning-agent.ai-agent.import.json"),
];

function patch(workflow) {
  const webhook = (workflow.nodes || []).find((node) => node.name === "Receive post-turn learning dispatch");
  if (!webhook || webhook.type !== "n8n-nodes-base.webhook") {
    throw new Error("Learning Agent post-turn webhook is missing.");
  }
  webhook.parameters.responseMode = "onReceived";
  webhook.parameters.options = { ...(webhook.parameters.options || {}), responseCode: 202 };
  delete webhook.parameters.options.responseData;
  return workflow;
}

function apiPayload(workflow) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings || { executionOrder: "v1" },
    staticData: workflow.staticData ?? null,
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function n8n(method, endpoint, body) {
  const base = String(process.env.N8N_API_BASE_URL || "").replace(/\/+$/, "");
  const key = String(process.env.N8N_API_KEY || "");
  if (!base || !key) throw new Error("N8N_API_BASE_URL and N8N_API_KEY are required for --apply.");
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers: { "Content-Type": "application/json", "X-N8N-API-KEY": key },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${method} ${endpoint} returned ${response.status}: ${text.slice(0, 500)}`);
  return data;
}

(async () => {
  if (!applyLive) {
    for (const file of canonicalPaths) writeJson(file, patch(JSON.parse(fs.readFileSync(file, "utf8"))));
    console.log(JSON.stringify({ status: "canonical_learning_webhook_ack_patched", live_applied: false }, null, 2));
    return;
  }
  const before = await n8n("GET", `/api/v1/workflows/${workflowId}`);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const backupDir = path.join(root, "exports", "n8n-live-backups", `${stamp}-learning-webhook-ack`);
  writeJson(path.join(backupDir, "learning.before.json"), before);
  await n8n("PUT", `/api/v1/workflows/${workflowId}`, apiPayload(patch(before)));
  const published = await n8n("POST", `/api/v1/workflows/${workflowId}/publish`, {});
  writeJson(path.join(backupDir, "learning.after.json"), published);
  for (const file of canonicalPaths) writeJson(file, apiPayload(published));
  console.log(JSON.stringify({
    status: "live_learning_webhook_ack_published",
    workflow_id: workflowId,
    backup: path.relative(root, backupDir).replaceAll("\\", "/"),
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
