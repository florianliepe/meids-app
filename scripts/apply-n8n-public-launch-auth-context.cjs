#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const applyLive = process.argv.includes("--apply");
const workflowIds = {
  actor: String(process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || "eKI3qM7nyCNn9r1q"),
  knowledge: String(process.env.N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID || "oPs77Qzrg9Repzgp"),
  butler: String(process.env.N8N_AGENTIC_BUTLER_WORKFLOW_ID || "KZOqZRUAnVfFEAYJ"),
};

const inputDefinitions = [
  { name: "operation", type: "string" },
  { name: "query", type: "string" },
  { name: "knowledge_access_token", type: "string" },
  { name: "tenant_id", type: "string" },
  { name: "user_id", type: "string" },
  { name: "twin_id", type: "string" },
  { name: "organization_id", type: "string" },
];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function inputSchema() {
  return inputDefinitions.map(({ name, type }) => ({
    id: name,
    displayName: name,
    required: name === "query",
    defaultMatch: false,
    display: true,
    canBeUsedToMatch: true,
    type,
    removed: false,
  }));
}

function patchTargetTrigger(workflow) {
  const trigger = workflow.nodes.find((node) => node.type === "n8n-nodes-base.executeWorkflowTrigger");
  if (!trigger) throw new Error(`${workflow.name} has no Execute Workflow Trigger.`);
  trigger.typeVersion = Math.max(Number(trigger.typeVersion || 1), 1.1);
  trigger.parameters = {
    ...(trigger.parameters || {}),
    inputSource: "workflowInputs",
    workflowInputs: { values: inputDefinitions },
  };
  return workflow;
}

function chatMetadataExpression(pathExpression) {
  return `={{ $('When chat message received').first().json.metadata?.${pathExpression} || '' }}`;
}

function patchActorTool(workflow, namePattern) {
  const node = workflow.nodes.find((candidate) =>
    candidate.type === "@n8n/n8n-nodes-langchain.toolWorkflow" && namePattern.test(candidate.name),
  );
  if (!node) throw new Error(`${workflow.name} is missing tool workflow matching ${namePattern}.`);
  node.parameters.workflowInputs = {
    mappingMode: "defineBelow",
    value: {
      operation: "={{ $fromAI('operation', 'Use retrieve for read-only lookup/search; use stage only for explicit knowledge writes.', 'string') }}",
      query: "={{ $fromAI('query', 'Concise delegated request including the user intent and relevant context.', 'string') }}",
      knowledge_access_token: chatMetadataExpression("authorization?.knowledgeAccessToken"),
      tenant_id: chatMetadataExpression("identity?.tenantId"),
      user_id: chatMetadataExpression("identity?.userId"),
      twin_id: chatMetadataExpression("identity?.activeTwinId"),
      organization_id: chatMetadataExpression("identity?.tenantId"),
    },
    matchingColumns: [],
    schema: inputSchema(),
    attemptToConvertTypes: false,
    convertFieldsToString: false,
  };
  return node.name;
}

function patchActor(workflow) {
  const chat = workflow.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.chatTrigger");
  if (!chat || chat.name !== "When chat message received") {
    throw new Error(`${workflow.name} must contain the expected 'When chat message received' Chat Trigger.`);
  }
  const patchedTools = [
    patchActorTool(workflow, /Knowledge Fabric/i),
    patchActorTool(workflow, /Agentic Butler/i),
  ];
  return { workflow, patchedTools };
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

function canonicalWorkflow(workflow) {
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

async function updateLive(id, workflow) {
  const wasActive = Boolean(workflow.active);
  const updated = await n8n("PUT", `/api/v1/workflows/${id}`, apiPayload(workflow));
  if (wasActive) await n8n("POST", `/api/v1/workflows/${id}/deactivate`, {});
  const published = await n8n("POST", `/api/v1/workflows/${id}/publish`, {});
  return { updated, published };
}

async function main() {
  if (!applyLive) {
    const knowledgePath = path.join(root, "workflows", "n8n", "knowledge-fabric-agent.workflow.json");
    const butlerPath = path.join(root, "workflows", "n8n", "agentic-butler.workflow.json");
    writeJson(knowledgePath, patchTargetTrigger(readJson(knowledgePath)));
    writeJson(butlerPath, patchTargetTrigger(readJson(butlerPath)));
    console.log(JSON.stringify({ status: "canonical_target_triggers_updated", live_applied: false }, null, 2));
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const backup = path.join(root, "exports", "n8n-live-backups", `${stamp}-public-launch-auth-context`);
  const actorBefore = await n8n("GET", `/api/v1/workflows/${workflowIds.actor}`);
  const knowledgeBefore = await n8n("GET", `/api/v1/workflows/${workflowIds.knowledge}`);
  const butlerBefore = await n8n("GET", `/api/v1/workflows/${workflowIds.butler}`);
  writeJson(path.join(backup, "actor.before.json"), actorBefore);
  writeJson(path.join(backup, "knowledge.before.json"), knowledgeBefore);
  writeJson(path.join(backup, "butler.before.json"), butlerBefore);

  const actorPatch = patchActor(actorBefore);
  const knowledgeAfter = patchTargetTrigger(knowledgeBefore);
  const butlerAfter = patchTargetTrigger(butlerBefore);
  const actorResult = await updateLive(workflowIds.actor, actorPatch.workflow);
  const knowledgeResult = await updateLive(workflowIds.knowledge, knowledgeAfter);
  const butlerResult = await updateLive(workflowIds.butler, butlerAfter);

  writeJson(path.join(backup, "actor.after.json"), actorResult.published);
  writeJson(path.join(backup, "knowledge.after.json"), knowledgeResult.published);
  writeJson(path.join(backup, "butler.after.json"), butlerResult.published);
  const actorCanonical = canonicalWorkflow(actorResult.published);
  const knowledgeCanonical = canonicalWorkflow(knowledgeResult.published);
  const butlerCanonical = canonicalWorkflow(butlerResult.published);
  writeJson(path.join(root, "workflows", "n8n", "actor-twin.workflow.json"), actorCanonical);
  writeJson(path.join(root, "workflows", "n8n", "knowledge-fabric-agent.workflow.json"), knowledgeCanonical);
  writeJson(path.join(root, "workflows", "n8n", "agentic-butler.workflow.json"), butlerCanonical);

  const importReady = path.join(root, "workflows", "n8n", "import-ready");
  writeJson(path.join(importReady, "actor-twin.ai-agent.import.json"), actorCanonical);
  writeJson(path.join(importReady, "knowledge-fabric-agent.ai-agent.import.json"), knowledgeCanonical);
  writeJson(path.join(importReady, "agentic-butler.ai-agent.import.json"), butlerCanonical);

  console.log(JSON.stringify({
    status: "live_auth_context_applied",
    live_applied: true,
    patched_actor_tools: actorPatch.patchedTools,
    workflows: workflowIds,
    backup: path.relative(root, backup).replaceAll("\\", "/"),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
