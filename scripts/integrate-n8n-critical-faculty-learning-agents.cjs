#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outRoot = path.join(root, "exports", "n8n-live-backups");

const defaults = {
  actorTwin: "eKI3qM7nyCNn9r1q",
  agenticButler: "KZOqZRUAnVfFEAYJ",
  knowledgeFabric: "mv6AbIxxvV0Sa5OO",
  taskAgentTemplate: "YXcl8Wb68Oup3Z8n",
};

const criticalFacultyName = "Me.IDs Critical Faculty Agent - staging";
const learningAgentName = "Me.IDs Learning Agent - staging";

const criticalFacultyDescription = [
  "Call this internal workflow tool when a route decision, answer, knowledge claim, skill proposal, task-agent result, graph implication, vector-readiness decision, or proposed action needs independent decision-quality critique.",
  "",
  "Use it for ambiguity, weak evidence, contradictions, stale or draft knowledge, hidden assumptions, approval-boundary uncertainty, high-impact recommendations, generated capability proposals, or premortem-style risk review.",
  "",
  "Do not call it for ordinary chat, simple drafting, low-risk formatting, or identity/status questions. Critical Faculty cannot approve, execute, persist, send, schedule, publish, delete, commit, or activate anything. It returns critique, recommendation, Knowledge Fabric action advice, and caller next step.",
].join("\n");

const learningAgentDescription = [
  "Call this internal workflow tool after completed traces, interviews, UAT results, source ingestion, skill runs, critical-faculty critiques, review decisions, or repeated failures when the interaction produced reusable lessons.",
  "",
  "The Learning Agent creates reviewable learning documents, concept deltas, decision-pattern summaries, failure-mode notes, and future-behavior-change candidates. Its outputs must be staged through Knowledge Fabric as review_needed or updated_review_needed, not treated as approved truth.",
  "",
  "Do not call it for real-time user answering, fresh tacit-knowledge interviews, direct OKF/vector/graph retrieval, skill execution, approvals, or external side effects.",
].join("\n");

const knowledgeFabricDescription = [
  "Call this tool to retrieve, stage, create, or update OKF knowledge, source notes, evidence records, learning documents, concept deltas, candidate graph edges, vector-refresh decisions, and review-needed knowledge states.",
  "",
  "All new or changed learning output from Learning Agent must be staged as review_needed or updated_review_needed. Do not promote concepts, graph edges, or trusted vector refreshes without review policy.",
].join("\n");

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function requireEnv(name) {
  const value = env(name);
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
}

function read(filePath) {
  return fs.readFileSync(path.join(root, filePath), "utf8").trim();
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
}

function apiBase() {
  return requireEnv("N8N_API_BASE_URL").replace(/\/+$/, "");
}

async function n8nJson(method, endpoint, body) {
  const response = await fetch(`${apiBase()}${endpoint}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-N8N-API-KEY": requireEnv("N8N_API_KEY"),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  if (!response.ok) {
    const detail = typeof data === "string" ? data.slice(0, 800) : JSON.stringify(data).slice(0, 800);
    throw new Error(`${method} ${endpoint} returned ${response.status}: ${detail}`);
  }
  return data;
}

function workflowItems(result) {
  return Array.isArray(result) ? result : result.data || [];
}

function agentNode(name, systemMessage, position = [224, 0]) {
  return {
    parameters: {
      options: { systemMessage },
      promptType: "define",
      text: "=Workflow-tool input from caller:\n{{ $json.query || $json.chatInput || $json.input?.query || JSON.stringify($json) }}",
    },
    type: "@n8n/n8n-nodes-langchain.agent",
    typeVersion: 3.1,
    position,
    id: crypto.randomUUID(),
    name,
  };
}

function triggerNode(position = [0, 0]) {
  return {
    parameters: { inputSource: "passthrough" },
    type: "n8n-nodes-base.executeWorkflowTrigger",
    typeVersion: 1.2,
    position,
    id: crypto.randomUUID(),
    name: "When Executed by Another Workflow",
  };
}

function modelNode(templateModelNode, position = [224, 192]) {
  return {
    ...templateModelNode,
    id: crypto.randomUUID(),
    name: "OpenAI Chat Model",
    position,
  };
}

function buildAgentWorkflow({ name, agentName, systemMessage, templateModelNode, extraTool }) {
  const trigger = triggerNode();
  const agent = agentNode(agentName, systemMessage);
  const model = modelNode(templateModelNode);
  const nodes = [trigger, agent, model];
  const connections = {
    [trigger.name]: {
      main: [[{ node: agent.name, type: "main", index: 0 }]],
    },
    [model.name]: {
      ai_languageModel: [[{ node: agent.name, type: "ai_languageModel", index: 0 }]],
    },
  };
  if (extraTool) {
    nodes.push(extraTool);
    connections[extraTool.name] = {
      ai_tool: [[{ node: agent.name, type: "ai_tool", index: 0 }]],
    };
  }
  return {
    name,
    nodes,
    connections,
    settings: { executionOrder: "v1" },
    staticData: null,
  };
}

async function findWorkflowByName(name) {
  const workflows = workflowItems(await n8nJson("GET", "/api/v1/workflows?limit=100"));
  return workflows.find((workflow) => workflow.name === name);
}

async function upsertWorkflowByName(name, payload, outDir, label) {
  const existing = await findWorkflowByName(name);
  if (existing) {
    const live = await n8nJson("GET", `/api/v1/workflows/${existing.id}`);
    writeJson(path.join(outDir, `${label}.live-before.json`), live);
    const liveModelByName = new Map((live.nodes || []).map((node) => [node.name, node]));
    payload.nodes = payload.nodes.map((node) => {
      const prior = liveModelByName.get(node.name);
      if (!prior) return node;
      return {
        ...node,
        id: prior.id || node.id,
        webhookId: prior.webhookId || node.webhookId,
        credentials: prior.credentials || node.credentials,
      };
    });
    writeJson(path.join(outDir, `${label}.update-payload.json`), payload);
    const updated = await n8nJson("PUT", `/api/v1/workflows/${existing.id}`, payload);
    writeJson(path.join(outDir, `${label}.live-after.json`), updated);
    return updated;
  }
  writeJson(path.join(outDir, `${label}.create-payload.json`), payload);
  const created = await n8nJson("POST", "/api/v1/workflows", payload);
  writeJson(path.join(outDir, `${label}.live-created.json`), created);
  return created;
}

async function activateWorkflow(workflow, outDir, label) {
  if (workflow.active) return workflow;
  try {
    const activated = await n8nJson("POST", `/api/v1/workflows/${workflow.id}/activate`);
    writeJson(path.join(outDir, `${label}.live-activated.json`), activated);
    return activated;
  } catch (error) {
    writeJson(path.join(outDir, `${label}.activation-warning.json`), {
      warning: "Activation endpoint failed. Workflow may need manual activation in n8n.",
      error: error.message,
      workflow_id: workflow.id,
    });
    return workflow;
  }
}

function findAgentNode(workflow, preferredNames = []) {
  return (workflow.nodes || []).find((node) => preferredNames.includes(node.name))
    || (workflow.nodes || []).find((node) => node.type === "@n8n/n8n-nodes-langchain.agent");
}

function upsertToolWorkflow(workflow, { name, workflowId, workflowName, description, position }) {
  const existing = (workflow.nodes || []).find((node) => node.name === name);
  const node = existing || {
    id: crypto.randomUUID(),
    name,
    type: "@n8n/n8n-nodes-langchain.toolWorkflow",
    typeVersion: 2.2,
    position,
  };
  node.parameters = {
    description,
    workflowId: {
      __rl: true,
      value: workflowId,
      mode: "list",
      cachedResultUrl: `/workflow/${workflowId}`,
      cachedResultName: workflowName,
    },
    workflowInputs: {
      mappingMode: "defineBelow",
      value: {},
      matchingColumns: [],
      schema: [],
      attemptToConvertTypes: false,
      convertFieldsToString: false,
    },
  };
  if (!existing) workflow.nodes.push(node);
  return node;
}

function appendOnce(text, addition, marker) {
  if (String(text || "").includes(marker)) return String(text || "");
  return `${String(text || "").trim()}\n\n${addition}`.trim();
}

function patchSystemMessage(workflow, agentNames, patch, marker) {
  const agent = findAgentNode(workflow, agentNames);
  if (!agent) throw new Error(`No AI Agent found in ${workflow.name}`);
  agent.parameters = agent.parameters || {};
  agent.parameters.options = agent.parameters.options || {};
  agent.parameters.options.systemMessage = appendOnce(agent.parameters.options.systemMessage || "", patch, marker);
  return agent;
}

async function updateWorkflowWithTools({ workflowId, outDir, label, agentNames, tools, systemPatch, marker }) {
  const workflow = await n8nJson("GET", `/api/v1/workflows/${workflowId}`);
  writeJson(path.join(outDir, `${label}.live-before.json`), workflow);
  const agent = patchSystemMessage(workflow, agentNames, systemPatch, marker);
  for (const tool of tools) {
    upsertToolWorkflow(workflow, tool);
    workflow.connections = workflow.connections || {};
    workflow.connections[tool.name] = {
      ai_tool: [[{ node: agent.name, type: "ai_tool", index: 0 }]],
    };
  }
  const payload = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections || {},
    settings: workflow.settings || { executionOrder: "v1" },
    staticData: workflow.staticData ?? null,
  };
  writeJson(path.join(outDir, `${label}.update-payload.json`), payload);
  const updated = await n8nJson("PUT", `/api/v1/workflows/${workflowId}`, payload);
  writeJson(path.join(outDir, `${label}.live-after.json`), updated);
  return updated;
}

async function main() {
  const outDir = path.join(outRoot, `${timestamp()}-critical-faculty-learning-integration`);
  const actorTwinId = env("N8N_ACTOR_TWIN_WORKFLOW_ID", defaults.actorTwin);
  const agenticButlerId = env("N8N_AGENTIC_BUTLER_WORKFLOW_ID", defaults.agenticButler);
  const knowledgeFabricId = env("N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID", defaults.knowledgeFabric);
  const taskTemplateId = env("N8N_TASK_AGENT_WORKFLOW_ID", defaults.taskAgentTemplate);

  const taskTemplate = await n8nJson("GET", `/api/v1/workflows/${taskTemplateId}`);
  const templateModel = (taskTemplate.nodes || []).find((node) => node.type === "@n8n/n8n-nodes-langchain.lmChatOpenAi");
  if (!templateModel) throw new Error("Task Agent template model node not found");

  const criticalPrompt = read("prompts/critical-faculty/system.md");
  const learningPrompt = read("prompts/learning-agent/system.md");

  const criticalPayload = buildAgentWorkflow({
    name: criticalFacultyName,
    agentName: "Critical Faculty Agent",
    systemMessage: criticalPrompt,
    templateModelNode: templateModel,
  });
  const criticalWorkflow = await activateWorkflow(
    await upsertWorkflowByName(criticalFacultyName, criticalPayload, outDir, "critical-faculty"),
    outDir,
    "critical-faculty",
  );

  const knowledgeFabricToolForLearning = {
    id: crypto.randomUUID(),
    name: "Knowledge Fabric Agent",
    type: "@n8n/n8n-nodes-langchain.toolWorkflow",
    typeVersion: 2.2,
    position: [512, 192],
    parameters: {
      description: knowledgeFabricDescription,
      workflowId: {
        __rl: true,
        value: knowledgeFabricId,
        mode: "list",
        cachedResultUrl: `/workflow/${knowledgeFabricId}`,
        cachedResultName: "MeIDs Knowledge Fabric Agent - staging",
      },
      workflowInputs: {
        mappingMode: "defineBelow",
        value: {},
        matchingColumns: [],
        schema: [],
        attemptToConvertTypes: false,
        convertFieldsToString: false,
      },
    },
  };
  const learningPayload = buildAgentWorkflow({
    name: learningAgentName,
    agentName: "Learning Agent",
    systemMessage: learningPrompt,
    templateModelNode: templateModel,
    extraTool: knowledgeFabricToolForLearning,
  });
  const learningWorkflow = await activateWorkflow(
    await upsertWorkflowByName(learningAgentName, learningPayload, outDir, "learning-agent"),
    outDir,
    "learning-agent",
  );

  const criticalTool = {
    name: "Critical Faculty Agent",
    workflowId: criticalWorkflow.id,
    workflowName: criticalWorkflow.name,
    description: criticalFacultyDescription,
    position: [896, 240],
  };
  const learningTool = {
    name: "Learning Agent",
    workflowId: learningWorkflow.id,
    workflowName: learningWorkflow.name,
    description: learningAgentDescription,
    position: [1088, 240],
  };

  const actorPatch = [
    "Tool: Critical Faculty Agent",
    criticalFacultyDescription,
    "",
    "Tool: Learning Agent",
    learningAgentDescription,
    "",
    "Routing rule: keep Actor Twin as the only user-facing chat. Use Critical Faculty for internal decision-quality critique and Learning Agent for trace-to-learning synthesis. Summarize only the useful final result to the user; keep critique and learning detail in traces and Knowledge Fabric review queues.",
  ].join("\n");

  const butlerPatch = [
    "Tool: Critical Faculty Agent",
    criticalFacultyDescription,
    "",
    "Routing rule: call Critical Faculty before finalizing generated capability proposals, risky skill plans, conflicting task-agent outputs, or approval-boundary decisions. Do not expose Critical Faculty as a visible agent.",
  ].join("\n");

  const knowledgePatch = [
    "Tool: Critical Faculty Agent",
    criticalFacultyDescription,
    "",
    "Tool: Learning Agent",
    learningAgentDescription,
    "",
    "Routing rule: call Critical Faculty for evidence, duplicate, graph, vector, and review-state challenge. Route reusable lessons and learning deltas to Learning Agent, then stage its outputs as review_needed or updated_review_needed through Knowledge Fabric.",
  ].join("\n");

  const updatedActor = await updateWorkflowWithTools({
    workflowId: actorTwinId,
    outDir,
    label: "actor-twin",
    agentNames: ["Actor Twin AI Agent1", "Actor Twin AI Agent"],
    tools: [criticalTool, learningTool],
    systemPatch: actorPatch,
    marker: "Tool: Critical Faculty Agent",
  });

  const updatedButler = await updateWorkflowWithTools({
    workflowId: agenticButlerId,
    outDir,
    label: "agentic-butler",
    agentNames: ["Agentic Butler AI Agent"],
    tools: [criticalTool],
    systemPatch: butlerPatch,
    marker: "Tool: Critical Faculty Agent",
  });

  const updatedKnowledge = await updateWorkflowWithTools({
    workflowId: knowledgeFabricId,
    outDir,
    label: "knowledge-fabric",
    agentNames: ["Knowledge Fabric AI Agent"],
    tools: [criticalTool, learningTool],
    systemPatch: knowledgePatch,
    marker: "Tool: Critical Faculty Agent",
  });

  const localCriticalPath = path.join(root, "workflows", "n8n", "critical-faculty-agent.workflow.json");
  const localLearningPath = path.join(root, "workflows", "n8n", "learning-agent.workflow.json");
  writeJson(localCriticalPath, criticalPayload);
  writeJson(localLearningPath, learningPayload);

  const summary = {
    status: "applied",
    critical_faculty: {
      id: criticalWorkflow.id,
      name: criticalWorkflow.name,
      active: Boolean(criticalWorkflow.active),
      attached_to: ["actor_twin", "agentic_butler", "knowledge_fabric"],
    },
    learning_agent: {
      id: learningWorkflow.id,
      name: learningWorkflow.name,
      active: Boolean(learningWorkflow.active),
      attached_to: ["actor_twin", "knowledge_fabric"],
      has_knowledge_fabric_tool: Boolean(learningWorkflow.connections?.["Knowledge Fabric Agent"]?.ai_tool),
    },
    actor_twin: {
      id: updatedActor.id,
      has_critical_faculty_tool: updatedActor.nodes.some((node) => node.name === "Critical Faculty Agent"),
      has_learning_agent_tool: updatedActor.nodes.some((node) => node.name === "Learning Agent"),
    },
    agentic_butler: {
      id: updatedButler.id,
      has_critical_faculty_tool: updatedButler.nodes.some((node) => node.name === "Critical Faculty Agent"),
    },
    knowledge_fabric: {
      id: updatedKnowledge.id,
      has_critical_faculty_tool: updatedKnowledge.nodes.some((node) => node.name === "Critical Faculty Agent"),
      has_learning_agent_tool: updatedKnowledge.nodes.some((node) => node.name === "Learning Agent"),
    },
    backup: path.relative(root, outDir).replace(/\\/g, "/"),
  };
  writeJson(path.join(outDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
