#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const applyLive = process.argv.includes("--apply");
const actorWorkflowId = String(process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || "eKI3qM7nyCNn9r1q");
const backendUrl = String(process.env.MEIDS_BACKEND_URL || "https://meids-prod-backend-1853a19b.azurewebsites.net").replace(/\/+$/, "");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function patchWorkflow(workflow) {
  const node = workflow.nodes.find((candidate) => candidate.name === "Score duplicate and merge evidence");
  if (!node) throw new Error(`${workflow.name} is missing Score duplicate and merge evidence.`);
  node.type = "n8n-nodes-base.httpRequest";
  node.typeVersion = 4.2;
  node.onError = "continueRegularOutput";
  delete node.continueOnFail;
  node.parameters = {
    method: "POST",
    url: `${backendUrl}/api/knowledge/duplicate-check`,
    sendHeaders: true,
    headerParameters: {
      parameters: [{ name: "Content-Type", value: "application/json" }],
    },
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify({ candidate: $json.candidate, twin_id: $json.twin_id, organization_id: $json.organization_id, source_policy: $json.source_policy, top: $json.top, knowledge_access_token: $json.knowledge_access_token }) }}",
    options: { timeout: 12000 },
  };
  node.notes = "Authenticated duplicate/merge scoring through the hosted backend. Uses the caller's scoped knowledge token; failures continue only into the guarded no-merge fallback in Attach duplicate score evidence.";
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

async function main() {
  const workflowPath = path.join(root, "workflows", "n8n", "knowledge-fabric-agent.workflow.json");
  if (!applyLive) {
    writeJson(workflowPath, apiPayload(patchWorkflow(readJson(workflowPath))));
    console.log(JSON.stringify({ status: "canonical_authenticated_scoring_patched", live_applied: false }, null, 2));
    return;
  }

  const actor = await n8n("GET", `/api/v1/workflows/${actorWorkflowId}`);
  const actorKnowledgeTool = actor.nodes.find((node) => node.name === "Knowledge Fabric Agent");
  const workflowId = String(actorKnowledgeTool?.parameters?.workflowId?.value || "");
  if (!workflowId) throw new Error("The live Actor Twin does not expose a Knowledge Fabric workflow target.");
  const configuredId = String(process.env.N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID || "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const backup = path.join(root, "exports", "n8n-live-backups", `${stamp}-authenticated-knowledge-scoring`);
  const before = await n8n("GET", `/api/v1/workflows/${workflowId}`);
  writeJson(path.join(backup, "knowledge.before.json"), before);
  await n8n("PUT", `/api/v1/workflows/${workflowId}`, apiPayload(patchWorkflow(before)));
  const published = await n8n("POST", `/api/v1/workflows/${workflowId}/publish`, {});
  writeJson(path.join(backup, "knowledge.after.json"), published);
  const canonical = apiPayload(published);
  writeJson(workflowPath, canonical);
  writeJson(path.join(root, "workflows", "n8n", "import-ready", "knowledge-fabric-agent.ai-agent.import.json"), canonical);
  console.log(JSON.stringify({
    status: "live_authenticated_scoring_published",
    workflow_id: workflowId,
    actor_bound_workflow_id: workflowId,
    stale_configured_workflow_id_ignored: configuredId && configuredId !== workflowId ? configuredId : "",
    endpoint: `${backendUrl}/api/knowledge/duplicate-check`,
    backup: path.relative(root, backup).replaceAll("\\", "/"),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
