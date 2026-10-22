#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const applyLive = process.argv.includes("--apply");
const cloneStaleRuntime = process.argv.includes("--clone-stale-runtime");
const knowledgeId = String(
  process.env.N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID
  || process.env.N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID_USER
  || "oPs77Qzrg9Repzgp",
);
const actorId = String(process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || "eKI3qM7nyCNn9r1q");
const backendUrl = String(process.env.MEIDS_BACKEND_URL || "https://meids-prod-backend-1853a19b.azurewebsites.net").replace(/\/+$/, "");

const operationDefinition = { name: "operation", type: "string" };

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function upsertNode(workflow, node) {
  const index = workflow.nodes.findIndex((candidate) => candidate.name === node.name);
  if (index >= 0) workflow.nodes[index] = { ...workflow.nodes[index], ...node };
  else workflow.nodes.push(node);
}

function patchKnowledge(workflow) {
  const trigger = workflow.nodes.find((node) => node.type === "n8n-nodes-base.executeWorkflowTrigger");
  if (!trigger) throw new Error(`${workflow.name} has no Execute Workflow Trigger.`);
  const values = trigger.parameters?.workflowInputs?.values || [];
  if (!values.some((item) => item.name === "operation")) values.unshift(operationDefinition);
  trigger.parameters = {
    ...(trigger.parameters || {}),
    inputSource: "workflowInputs",
    workflowInputs: { values },
  };

  upsertNode(workflow, {
    id: "meids/knowledge/determine-operation",
    name: "Determine knowledge operation",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [-520, 140],
    parameters: {
      jsCode: `const input = $json.body ?? $json;
const query = String(input.query || input.input?.query || input.input?.text || input.chatInput || '').trim();
const requested = String(input.operation || input.intent || input.context?.route_decision?.decision || '').trim().toLowerCase();
const readOnly = /\\b(read[- ]?only|retrieve|search|find|lookup|show|inspect|what do we know|existing knowledge|evidence lookup)\\b/i.test(query);
const writeIntent = /\\b(remember|save|store|stage|ingest|capture|create|update|add|attach)\\b/i.test(query);
const operation = requested.includes('retrieve') || requested === 'read' || readOnly
  ? 'retrieve'
  : requested.includes('stage') || requested.includes('ingest') || requested.includes('create') || requested.includes('update') || writeIntent
    ? 'stage'
    : 'retrieve';
return [{ json: { ...input, query, operation, knowledge_operation: operation } }];`,
    },
    notes: "Fail-closed routing: ambiguous requests are retrieval-only. Only explicit stage/write intent may reach persistence.",
  });

  upsertNode(workflow, {
    id: "meids/knowledge/switch-operation",
    name: "Switch knowledge operation",
    type: "n8n-nodes-base.switch",
    typeVersion: 3.2,
    position: [-280, 140],
    parameters: {
      rules: {
        values: [{
          conditions: {
            options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
            conditions: [{
              leftValue: "={{ $json.knowledge_operation }}",
              rightValue: "retrieve",
              operator: { type: "string", operation: "equals" },
            }],
            combinator: "and",
          },
        }],
      },
      options: { fallbackOutput: "extra" },
    },
  });

  upsertNode(workflow, {
    id: "meids/knowledge/retrieve-scoped",
    name: "Retrieve scoped knowledge",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [0, -80],
    parameters: {
      method: "POST",
      url: `${backendUrl}/api/vector-index/search`,
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ query: $json.query, top: 5, source_policy: 'approved_only', knowledge_access_token: $json.knowledge_access_token, twin_id: $json.twin_id, organization_id: $json.organization_id }) }}",
      options: { timeout: 15000 },
    },
    notes: "Read-only, token-scoped Azure AI Search retrieval. This path never reaches knowledge staging.",
  });

  upsertNode(workflow, {
    id: "meids/knowledge/normalize-retrieval",
    name: "Normalize retrieval response",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [260, -80],
    parameters: {
      jsCode: `const input = $('Determine knowledge operation').first().json;
const buckets = Array.isArray($json.results) ? $json.results : [];
const matches = buckets.flatMap((bucket) => (Array.isArray(bucket.value) ? bucket.value.map((item) => ({ ...item, index: bucket.index })) : []));
const executionId = typeof $execution !== 'undefined' && $execution.id ? $execution.id : Date.now();
return [{ json: {
  envelope_version: input.envelope_version || '0.1.0',
  request_id: input.request_id || 'req_' + executionId,
  agent_id: 'knowledge_fabric_agent',
  status: 'completed',
  operation: 'retrieve',
  output: {
    summary: matches.length ? 'Retrieved ' + matches.length + ' scoped knowledge matches.' : 'No matching approved knowledge found.',
    read_only: true,
    retrieval_mode: $json.retrieval_mode || 'unknown',
    source_policy: $json.source_policy || 'approved_only',
    matches,
    created_candidates: [],
    review_state: 'unchanged'
  },
  trace: {
    stored: false,
    trace_id: 'n8n_exec_' + executionId,
    used_agents: ['knowledge_fabric_agent_retrieval'],
    target_agent: 'knowledge_fabric_agent',
    route_decision: 'retrieve_knowledge',
    handoff_status: 'handoff_completed'
  }
} }];`,
    },
  });

  workflow.connections["Receive request"] = { main: [[{ node: "Determine knowledge operation", type: "main", index: 0 }]] };
  workflow.connections["Receive workflow call"] = { main: [[{ node: "Determine knowledge operation", type: "main", index: 0 }]] };
  workflow.connections["Determine knowledge operation"] = { main: [[{ node: "Switch knowledge operation", type: "main", index: 0 }]] };
  const stagingTarget = workflow.nodes.some((node) => node.name === "Prepare duplicate request")
    ? "Prepare duplicate request"
    : "Knowledge Fabric AI Agent";
  workflow.connections["Switch knowledge operation"] = { main: [
    [{ node: "Retrieve scoped knowledge", type: "main", index: 0 }],
    [{ node: stagingTarget, type: "main", index: 0 }],
  ] };
  workflow.connections["Retrieve scoped knowledge"] = { main: [[{ node: "Normalize retrieval response", type: "main", index: 0 }]] };
  workflow.connections["Normalize retrieval response"] = { main: [[{ node: "Return JSON", type: "main", index: 0 }]] };
  return workflow;
}

function patchActor(workflow) {
  const tool = workflow.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.toolWorkflow" && /Knowledge Fabric/i.test(node.name));
  if (!tool) throw new Error(`${workflow.name} has no Knowledge Fabric workflow tool.`);
  tool.parameters.description = "Call this tool for direct, read-only OKF/vector/graph/evidence retrieval or for explicit knowledge staging. Always set operation to retrieve for lookup, search, inspect, show, or read-only requests; retrieval must never create or update knowledge. Set operation to stage only when the user explicitly asks to remember, save, ingest, create, update, attach, or stage knowledge. New or changed knowledge remains review_needed or updated_review_needed. Route tacit-knowledge interviews and circular/deep-dive elicitation to Agentic Butler.";
  const inputs = tool.parameters.workflowInputs;
  inputs.value = {
    operation: "={{ $fromAI('operation', 'Required: retrieve for read-only lookup/search/inspection; stage only for explicit remember/save/ingest/create/update requests.', 'string') }}",
    ...inputs.value,
  };
  if (!inputs.schema.some((item) => item.id === "operation")) {
    inputs.schema.unshift({
      id: "operation",
      displayName: "operation",
      required: true,
      defaultMatch: false,
      display: true,
      canBeUsedToMatch: true,
      type: "string",
      removed: false,
    });
  }
  const agent = workflow.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.agent");
  if (agent && !String(agent.parameters?.options?.systemMessage || "").includes("Knowledge operation contract")) {
    agent.parameters.options.systemMessage += "\n\nKnowledge operation contract: when calling Knowledge Fabric Agent, set operation=retrieve for lookup, search, inspect, show, evidence, vector, graph, or read-only requests. Set operation=stage only for explicit remember, save, ingest, create, update, attach, or stage requests. Never use stage for retrieval.";
  }
  return workflow;
}

function retargetKnowledgeTool(workflow, workflowId, workflowName) {
  const tools = workflow.nodes.filter((node) =>
    node.type === "@n8n/n8n-nodes-langchain.toolWorkflow" && /Knowledge Fabric/i.test(node.name),
  );
  for (const tool of tools) {
    tool.parameters.workflowId = {
      __rl: true,
      value: workflowId,
      mode: "list",
      cachedResultUrl: `/workflow/${workflowId}`,
      cachedResultName: workflowName,
    };
  }
  return tools.length;
}

function patchLearningKnowledgeOperation(workflow) {
  const tool = workflow.nodes.find((node) =>
    node.type === "@n8n/n8n-nodes-langchain.toolWorkflow" && /Knowledge Fabric/i.test(node.name),
  );
  if (!tool?.parameters?.workflowInputs) return false;
  const inputs = tool.parameters.workflowInputs;
  inputs.value = { operation: "stage", ...inputs.value };
  if (!inputs.schema.some((item) => item.id === "operation")) {
    inputs.schema.unshift({
      id: "operation",
      displayName: "operation",
      required: true,
      defaultMatch: false,
      display: true,
      canBeUsedToMatch: true,
      type: "string",
      removed: false,
    });
  }
  tool.parameters.description = "Stage Learning Agent outputs through Knowledge Fabric as review_needed or updated_review_needed. Use operation=stage. Do not use this tool for read-only retrieval, concept approval, graph promotion, or trusted vector promotion.";
  return true;
}

function versionedKnowledgeClone(workflow) {
  const clone = patchKnowledge(JSON.parse(JSON.stringify(workflow)));
  clone.name = "MeIDs Knowledge Fabric Agent - staging v3";
  const webhook = clone.nodes.find((node) => node.type === "n8n-nodes-base.webhook");
  if (webhook) webhook.parameters.path = "meids/knowledge-fabric/ingest-v3";
  delete clone.id;
  delete clone.active;
  delete clone.versionId;
  delete clone.activeVersionId;
  return clone;
}

async function publish(id, workflow) {
  const wasActive = Boolean(workflow.active);
  await n8n("PUT", `/api/v1/workflows/${id}`, apiPayload(workflow));
  if (wasActive) await n8n("POST", `/api/v1/workflows/${id}/deactivate`, {});
  return n8n("POST", `/api/v1/workflows/${id}/publish`, {});
}

async function main() {
  const knowledgePaths = [
    path.join(root, "workflows", "n8n", "knowledge-fabric-agent.workflow.json"),
    path.join(root, "workflows", "n8n", "import-ready", "knowledge-fabric-agent.ai-agent.import.json"),
    path.join(root, "workflows", "n8n", "implementations", "knowledge-fabric-agent.ai-agent.workflow.json"),
  ];
  const actorPaths = [
    path.join(root, "workflows", "n8n", "actor-twin.workflow.json"),
    path.join(root, "workflows", "n8n", "import-ready", "actor-twin.ai-agent.import.json"),
  ];
  const learningPath = path.join(root, "workflows", "n8n", "learning-agent.workflow.json");
  for (const file of knowledgePaths) writeJson(file, apiPayload(patchKnowledge(readJson(file))));
  for (const file of actorPaths) writeJson(file, apiPayload(patchActor(readJson(file))));
  if (fs.existsSync(learningPath)) {
    const learning = readJson(learningPath);
    patchLearningKnowledgeOperation(learning);
    writeJson(learningPath, apiPayload(learning));
  }

  if (!applyLive) {
    console.log(JSON.stringify({ status: "canonical_patched", live_applied: false }, null, 2));
    return;
  }
  const knowledge = patchKnowledge(await n8n("GET", `/api/v1/workflows/${knowledgeId}`));
  const actor = patchActor(await n8n("GET", `/api/v1/workflows/${actorId}`));
  if (cloneStaleRuntime) {
    const created = await n8n("POST", "/api/v1/workflows", apiPayload(versionedKnowledgeClone(knowledge)));
    const publishedKnowledge = await n8n("POST", `/api/v1/workflows/${created.id}/publish`, {});
    retargetKnowledgeTool(actor, created.id, created.name);
    const publishedActor = await publish(actorId, actor);

    const learningId = String(process.env.N8N_LEARNING_AGENT_WORKFLOW_ID || "zX0s3hOByJ4HWQye");
    const learning = await n8n("GET", `/api/v1/workflows/${learningId}`);
    const learningTargets = retargetKnowledgeTool(learning, created.id, created.name);
    patchLearningKnowledgeOperation(learning);
    const publishedLearning = learningTargets ? await publish(learningId, learning) : learning;

    for (const file of knowledgePaths) writeJson(file, apiPayload(versionedKnowledgeClone(knowledge)));
    for (const file of actorPaths) {
      const canonicalActor = patchActor(readJson(file));
      retargetKnowledgeTool(canonicalActor, created.id, created.name);
      writeJson(file, apiPayload(canonicalActor));
    }
    if (fs.existsSync(learningPath)) {
      const canonicalLearning = readJson(learningPath);
      retargetKnowledgeTool(canonicalLearning, created.id, created.name);
      patchLearningKnowledgeOperation(canonicalLearning);
      writeJson(learningPath, apiPayload(canonicalLearning));
    }
    console.log(JSON.stringify({
      status: "stale_runtime_replaced",
      knowledge: { id: publishedKnowledge.id, active: publishedKnowledge.active, versionId: publishedKnowledge.versionId, activeVersionId: publishedKnowledge.activeVersionId },
      actor: { id: publishedActor.id, active: publishedActor.active },
      learning: { id: publishedLearning.id, active: publishedLearning.active, retargeted_tools: learningTargets },
    }, null, 2));
    return;
  }
  const publishedKnowledge = await publish(knowledgeId, knowledge);
  const publishedActor = await publish(actorId, actor);
  const learningId = String(process.env.N8N_LEARNING_AGENT_WORKFLOW_ID || "zX0s3hOByJ4HWQye");
  const learning = await n8n("GET", `/api/v1/workflows/${learningId}`);
  retargetKnowledgeTool(learning, knowledgeId, knowledge.name);
  const learningPatched = patchLearningKnowledgeOperation(learning);
  const publishedLearning = learningPatched ? await publish(learningId, learning) : learning;
  console.log(JSON.stringify({
    status: "live_published",
    knowledge: { id: publishedKnowledge.id, active: publishedKnowledge.active, versionId: publishedKnowledge.versionId, activeVersionId: publishedKnowledge.activeVersionId },
    actor: { id: publishedActor.id, active: publishedActor.active, versionId: publishedActor.versionId, activeVersionId: publishedActor.activeVersionId },
    learning: { id: publishedLearning.id, active: publishedLearning.active, operation: learningPatched ? "stage" : "unchanged" },
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
