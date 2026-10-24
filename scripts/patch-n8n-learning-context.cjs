#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const applyLive = process.argv.includes("--apply");
const workflowIds = {
  actor: String(process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || "eKI3qM7nyCNn9r1q"),
  learning: String(process.env.N8N_LEARNING_AGENT_WORKFLOW_ID || "zX0s3hOByJ4HWQye"),
};

const learningInputs = [
  { name: "query", type: "string" },
  { name: "knowledge_access_token", type: "string" },
  { name: "tenant_id", type: "string" },
  { name: "user_id", type: "string" },
  { name: "twin_id", type: "string" },
  { name: "organization_id", type: "string" },
];

const normalizeLearningContext = String.raw`const root = $json.body && typeof $json.body === 'object' ? $json.body : $json;
const trace = root.trace && typeof root.trace === 'object' ? root.trace : {};
const context = root.context && typeof root.context === 'object' ? root.context : {};
const identity = root.metadata?.identity && typeof root.metadata.identity === 'object' ? root.metadata.identity : {};
const authorization = root.metadata?.authorization && typeof root.metadata.authorization === 'object'
  ? root.metadata.authorization
  : (root.authorization && typeof root.authorization === 'object' ? root.authorization : {});
const nestedInput = root.input && typeof root.input === 'object' ? root.input : {};
const query = String(
  root.query
  || root.chatInput
  || nestedInput.query
  || root.source_interaction_summary
  || trace.output_summary
  || trace.input_summary
  || ''
).trim();
return [{ json: {
  ...root,
  query,
  knowledge_access_token: root.knowledge_access_token || authorization.knowledgeAccessToken || '',
  tenant_id: root.tenant_id || context.tenant_id || identity.tenantId || '',
  user_id: root.user_id || context.user_id || identity.userId || '',
  twin_id: root.twin_id || context.twin_id || trace.twin_id || identity.activeTwinId || '',
  organization_id: root.organization_id || context.organization_id || root.tenant_id || identity.tenantId || '',
  dispatch_type: root.dispatch_type || (trace.trace_id ? 'post_turn_learning' : 'inline_learning'),
  trace,
} }];`;

function schema(definitions) {
  return definitions.map(({ name, type }) => ({
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function nodeByName(workflow, name) {
  return workflow.nodes.find((node) => node.name === name);
}

function chatMetadataExpression(pathExpression) {
  return `={{ $('When chat message received').first().json.metadata?.${pathExpression} || '' }}`;
}

function patchActor(workflow) {
  const tool = nodeByName(workflow, "Learning Agent");
  if (!tool || tool.type !== "@n8n/n8n-nodes-langchain.toolWorkflow") {
    throw new Error(`${workflow.name} is missing the Learning Agent workflow tool.`);
  }
  tool.parameters.workflowInputs = {
    mappingMode: "defineBelow",
    value: {
      query: "={{ $fromAI('query', 'Completed trace, decision review, interview, UAT result, or reusable lesson to synthesize now.', 'string') }}",
      knowledge_access_token: chatMetadataExpression("authorization?.knowledgeAccessToken"),
      tenant_id: chatMetadataExpression("identity?.tenantId"),
      user_id: chatMetadataExpression("identity?.userId"),
      twin_id: chatMetadataExpression("identity?.activeTwinId"),
      organization_id: chatMetadataExpression("identity?.tenantId"),
    },
    matchingColumns: [],
    schema: schema(learningInputs),
    attemptToConvertTypes: false,
    convertFieldsToString: false,
  };
  return workflow;
}

function patchLearning(workflow) {
  const executeTrigger = workflow.nodes.find((node) => node.type === "n8n-nodes-base.executeWorkflowTrigger");
  const webhook = nodeByName(workflow, "Receive post-turn learning dispatch");
  const agent = nodeByName(workflow, "Learning Agent");
  const knowledgeTool = nodeByName(workflow, "Knowledge Fabric Agent");
  if (!executeTrigger || !webhook || !agent || !knowledgeTool) {
    throw new Error(`${workflow.name} is missing a required Learning Agent context node.`);
  }

  executeTrigger.typeVersion = Math.max(Number(executeTrigger.typeVersion || 1), 1.1);
  executeTrigger.parameters = {
    ...(executeTrigger.parameters || {}),
    inputSource: "workflowInputs",
    workflowInputs: { values: learningInputs },
  };

  let normalizer = nodeByName(workflow, "Normalize learning context");
  if (!normalizer) {
    normalizer = {
      id: "normalize-learning-context",
      name: "Normalize learning context",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [560, 300],
      parameters: {},
      notes: "Unwraps webhook bodies and preserves the authenticated tenant/user/twin context for inline and post-turn Learning Agent calls.",
    };
    workflow.nodes.push(normalizer);
  }
  normalizer.parameters.jsCode = normalizeLearningContext;

  agent.parameters.promptType = "define";
  agent.parameters.text = "=Normalized learning request:\n{{ $json.query || JSON.stringify($json) }}";

  const normalized = "$('Normalize learning context').first().json";
  knowledgeTool.parameters.workflowInputs.value.knowledge_access_token = `={{ ${normalized}.knowledge_access_token || '' }}`;
  knowledgeTool.parameters.workflowInputs.value.tenant_id = `={{ ${normalized}.tenant_id || '' }}`;
  knowledgeTool.parameters.workflowInputs.value.user_id = `={{ ${normalized}.user_id || '' }}`;
  knowledgeTool.parameters.workflowInputs.value.twin_id = `={{ ${normalized}.twin_id || '' }}`;
  knowledgeTool.parameters.workflowInputs.value.organization_id = `={{ ${normalized}.organization_id || ${normalized}.tenant_id || '' }}`;

  workflow.connections[executeTrigger.name] = {
    main: [[{ node: normalizer.name, type: "main", index: 0 }]],
  };
  workflow.connections[webhook.name] = {
    main: [[{ node: normalizer.name, type: "main", index: 0 }]],
  };
  workflow.connections[normalizer.name] = {
    main: [[{ node: agent.name, type: "main", index: 0 }]],
  };
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

function canonicalWorkflow(workflow) {
  return apiPayload(workflow);
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

async function publish(id, workflow) {
  await n8n("PUT", `/api/v1/workflows/${id}`, apiPayload(workflow));
  return n8n("POST", `/api/v1/workflows/${id}/publish`, {});
}

async function main() {
  const actorPath = path.join(root, "workflows", "n8n", "actor-twin.workflow.json");
  const learningPath = path.join(root, "workflows", "n8n", "learning-agent.workflow.json");
  if (!applyLive) {
    writeJson(actorPath, patchActor(readJson(actorPath)));
    writeJson(learningPath, patchLearning(readJson(learningPath)));
    console.log(JSON.stringify({ status: "canonical_learning_context_patched", live_applied: false }, null, 2));
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const backup = path.join(root, "exports", "n8n-live-backups", `${stamp}-learning-context`);
  const actorBefore = await n8n("GET", `/api/v1/workflows/${workflowIds.actor}`);
  const learningBefore = await n8n("GET", `/api/v1/workflows/${workflowIds.learning}`);
  writeJson(path.join(backup, "actor.before.json"), actorBefore);
  writeJson(path.join(backup, "learning.before.json"), learningBefore);

  const actorPublished = await publish(workflowIds.actor, patchActor(actorBefore));
  const learningPublished = await publish(workflowIds.learning, patchLearning(learningBefore));
  writeJson(path.join(backup, "actor.after.json"), actorPublished);
  writeJson(path.join(backup, "learning.after.json"), learningPublished);
  writeJson(actorPath, canonicalWorkflow(actorPublished));
  writeJson(learningPath, canonicalWorkflow(learningPublished));
  writeJson(path.join(root, "workflows", "n8n", "import-ready", "actor-twin.ai-agent.import.json"), canonicalWorkflow(actorPublished));
  writeJson(path.join(root, "workflows", "n8n", "import-ready", "learning-agent.ai-agent.import.json"), canonicalWorkflow(learningPublished));

  console.log(JSON.stringify({
    status: "live_learning_context_published",
    workflows: workflowIds,
    backup: path.relative(root, backup).replaceAll("\\", "/"),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
