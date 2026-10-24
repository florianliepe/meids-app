#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const apply = process.argv.includes("--apply");
const actorId = String(process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || "eKI3qM7nyCNn9r1q").trim();
const learningId = String(process.env.N8N_LEARNING_AGENT_WORKFLOW_ID || "zX0s3hOByJ4HWQye").trim();
const targetName = "MeIDs Knowledge Fabric Agent - staging v4";

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
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
  if (!response.ok) throw new Error(`${method} ${endpoint} returned ${response.status}: ${text.slice(0, 1000)}`);
  return text ? JSON.parse(text) : {};
}

function workflowPayload(workflow) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings || { executionOrder: "v1" },
    staticData: workflow.staticData ?? null,
  };
}

async function publish(id, workflow) {
  if (!apply) return;
  const current = await n8nJson("GET", `/api/v1/workflows/${id}`);
  if (current.active) await n8nJson("POST", `/api/v1/workflows/${id}/deactivate`, {});
  await n8nJson("PUT", `/api/v1/workflows/${id}`, workflowPayload(workflow));
  await n8nJson("POST", `/api/v1/workflows/${id}/publish`, {});
  await n8nJson("POST", `/api/v1/workflows/${id}/deactivate`, {});
  await n8nJson("POST", `/api/v1/workflows/${id}/activate`, {});
}

function bindTool(workflow, toolName, workflowId) {
  const node = workflow.nodes.find((item) => item.name === toolName);
  if (!node || node.type !== "@n8n/n8n-nodes-langchain.toolWorkflow") {
    throw new Error(`${workflow.name}: ${toolName} tool node not found`);
  }
  node.parameters.workflowId = {
    __rl: true,
    value: workflowId,
    mode: "list",
    cachedResultUrl: `/workflow/${workflowId}`,
    cachedResultName: targetName,
  };
}

function write(relativePath, value) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function existingV4() {
  const response = await n8nJson("GET", "/api/v1/workflows?limit=250");
  return (response.data || []).find((item) => item.name === targetName) || null;
}

async function main() {
  const [actor, learning] = await Promise.all([
    n8nJson("GET", `/api/v1/workflows/${actorId}`),
    n8nJson("GET", `/api/v1/workflows/${learningId}`),
  ]);
  const oldKnowledgeId = String(actor.nodes.find((node) => node.name === "Knowledge Fabric Agent")?.parameters?.workflowId?.value || "");
  if (!oldKnowledgeId) throw new Error("Actor Twin Knowledge Fabric binding is missing");
  const knowledge = await n8nJson("GET", `/api/v1/workflows/${oldKnowledgeId}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  const backupDir = `exports/n8n-live-backups/${stamp}-knowledge-fabric-v4-roll-forward`;
  write(`${backupDir}/actor-twin.workflow.json`, actor);
  write(`${backupDir}/learning-agent.workflow.json`, learning);
  write(`${backupDir}/knowledge-fabric-v3.workflow.json`, knowledge);

  let v4 = await existingV4();
  if (!v4) {
    const clone = JSON.parse(JSON.stringify(knowledge));
    clone.name = targetName;
    const webhook = clone.nodes.find((node) => node.name === "Receive request");
    if (webhook) {
      webhook.id = crypto.randomUUID();
      webhook.webhookId = crypto.randomUUID();
      webhook.parameters.path = "meids/knowledge-fabric-v4/run";
    }
    if (!apply) {
      console.log(JSON.stringify({ status: "prepared", old_knowledge_id: oldKnowledgeId, proposed_name: targetName, backup_dir: backupDir }, null, 2));
      return;
    }
    v4 = await n8nJson("POST", "/api/v1/workflows", workflowPayload(clone));
  }
  const v4Id = String(v4.id);
  const v4Workflow = await n8nJson("GET", `/api/v1/workflows/${v4Id}`);
  await publish(v4Id, v4Workflow);

  bindTool(actor, "Knowledge Fabric Agent", v4Id);
  bindTool(learning, "Knowledge Fabric Agent", v4Id);
  await publish(learningId, learning);
  await publish(actorId, actor);

  const currentV4 = await n8nJson("GET", `/api/v1/workflows/${v4Id}`);
  write("workflows/n8n/knowledge-fabric-agent.workflow.json", currentV4);
  write("workflows/n8n/import-ready/knowledge-fabric-agent.ai-agent.import.json", currentV4);
  write("workflows/n8n/learning-agent.workflow.json", learning);
  write("workflows/n8n/import-ready/learning-agent.ai-agent.import.json", learning);
  write("workflows/n8n/actor-twin.workflow.json", actor);
  write("workflows/n8n/import-ready/actor-twin.ai-agent.import.json", actor);
  write("docs/uat/2026-10-24-knowledge-fabric-roll-forward.json", {
    status: "applied",
    reason: "n8n integrated subworkflow executions remained pinned to the previous Knowledge Fabric snapshot after publish and lifecycle refresh",
    old_knowledge_workflow_id: oldKnowledgeId,
    new_knowledge_workflow_id: v4Id,
    actor_twin_workflow_id: actorId,
    learning_agent_workflow_id: learningId,
    rollback: "Rebind Actor Twin and Learning Agent to old_knowledge_workflow_id; the v3 workflow remains active.",
  });
  console.log(JSON.stringify({ status: "applied", old_knowledge_id: oldKnowledgeId, new_knowledge_id: v4Id, actor_id: actorId, learning_id: learningId, backup_dir: backupDir }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
