#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflowFiles = [
  "workflows/n8n/agentic-butler.workflow.json",
  "workflows/n8n/implementations/agentic-butler.ai-agent.workflow.json",
  "workflows/n8n/import-ready/agentic-butler.ai-agent.import.json",
];
const beforeExpression = "const isCreateSkill = explicitCreation && (input.intent === 'create_skill' || routeDecision.decision === 'create_skill');";
const afterExpression = "const isCreateSkill = explicitCreation || (input.intent === 'create_skill' && routeDecision.decision === 'create_skill');";
const beforeQueryExpression = "const query = String(input.input?.query || input.input?.message || input.message || input.chatInput || '').toLowerCase();";
const afterQueryExpression = "const query = String(input.input?.query || input.input?.message || input.query || input.message || input.chatInput || '').toLowerCase();";
const beforeCreationVerbs = "(create|shape|design|generate|build|define)";
const afterCreationVerbs = "(create|shape|design|generate|build|define|propose|draft)";

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function patchNormalizer(workflow, label) {
  const node = workflow.nodes.find((item) => item.name === "Contract response normalizer");
  if (!node) throw new Error(`${label}: Contract response normalizer node not found`);
  const code = String(node.parameters?.jsCode || "");
  let patched = code;
  if (!patched.includes(afterExpression)) {
    if (!patched.includes(beforeExpression)) throw new Error(`${label}: expected approval expression not found`);
    patched = patched.replace(beforeExpression, afterExpression);
  }
  if (!patched.includes(afterQueryExpression)) {
    if (!patched.includes(beforeQueryExpression)) throw new Error(`${label}: expected query extraction expression not found`);
    patched = patched.replace(beforeQueryExpression, afterQueryExpression);
  }
  if (patched.includes(beforeCreationVerbs)) patched = patched.replaceAll(beforeCreationVerbs, afterCreationVerbs);
  if (patched === code) return false;
  node.parameters.jsCode = patched;
  return true;
}

function patchLocalFiles() {
  const results = [];
  for (const relativePath of workflowFiles) {
    const absolutePath = path.join(root, relativePath);
    const workflow = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    const changed = patchNormalizer(workflow, relativePath);
    if (changed) fs.writeFileSync(absolutePath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
    results.push({ path: relativePath, changed });
  }
  return results;
}

async function n8nJson(method, endpoint, body) {
  const baseUrl = requiredEnv("N8N_API_BASE_URL").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-N8N-API-KEY": requiredEnv("N8N_API_KEY"),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${endpoint} returned ${response.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}

async function patchLiveWorkflow() {
  const workflowId = requiredEnv("N8N_AGENTIC_BUTLER_WORKFLOW_ID");
  const live = await n8nJson("GET", `/api/v1/workflows/${workflowId}`);
  const backupDir = path.join(root, "exports", "n8n-live-backups", `${new Date().toISOString().replace(/[:.]/g, "")}-butler-approval-gate`);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, "agentic-butler.workflow.json"), `${JSON.stringify(live, null, 2)}\n`, "utf8");
  const changed = patchNormalizer(live, `live workflow ${workflowId}`);
  if (!changed) return { workflow_id: workflowId, changed: false, published: Boolean(live.active), backup_dir: path.relative(root, backupDir) };

  const payload = {
    name: live.name,
    nodes: live.nodes,
    connections: live.connections,
    settings: live.settings || { executionOrder: "v1" },
    staticData: live.staticData ?? null,
  };
  if (live.active) await n8nJson("POST", `/api/v1/workflows/${workflowId}/deactivate`, {});
  await n8nJson("PUT", `/api/v1/workflows/${workflowId}`, payload);
  const published = await n8nJson("POST", `/api/v1/workflows/${workflowId}/publish`, {});
  return { workflow_id: workflowId, changed: true, published: Boolean(published.active), backup_dir: path.relative(root, backupDir) };
}

async function main() {
  const local = patchLocalFiles();
  const live = await patchLiveWorkflow();
  console.log(JSON.stringify({ status: "completed", local, live }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
