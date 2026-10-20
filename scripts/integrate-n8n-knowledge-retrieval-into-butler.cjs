#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflowPath = path.join(root, "workflows", "n8n", "import-ready", "knowledge-retrieval-interviewer.ai-agent.import.json");
const outRoot = path.join(root, "exports", "n8n-live-backups");

const knowledgeRetrievalName = "Me.IDs Knowledge Retrieval Interviewer - staging";
const butlerToolNodeName = "Knowledge Retrieval Interviewer";
const butlerAgentNodeName = "Agentic Butler AI Agent";

const toolDescription = [
  "Call this tool when Actor Twin or Agentic Butler needs to elicit implicit human knowledge, tacit decision criteria, process insight, best practices, lessons learned, stakeholder dynamics, or reusable heuristics before creating an OKF knowledge node, work artifact, or skill proposal.",
  "",
  "The tool asks one focused question at a time. It uses what/how/why/who/and-then questioning plus circular stakeholder-perspective questions to fill a knowledge-node quality gate: topic and purpose, use and wider context, application, additional context, implications and results, evidence, confidence, use cases, and non-use boundaries.",
  "",
  "Do not call this tool for simple fact lookup, direct OKF/vector/graph retrieval, identity questions, or ordinary drafting where enough context already exists. Do not expose its raw output to the user; Actor Twin remains the visible voice.",
].join("\n");

const butlerSystemPatch = [
  "",
  "Tool: Knowledge Retrieval Interviewer",
  toolDescription,
  "",
  "Routing rule: use Knowledge Retrieval Interviewer only when the work depends on missing tacit knowledge, implicit decision criteria, best practices, stakeholder context, or process insight. Keep normal drafting and planning work inside Agentic Butler. Keep simple factual retrieval with Knowledge Fabric Agent.",
  "",
  "Hard routing rule for Knowledge Retrieval Interviewer: when the original request asks to extract, elicit, uncover, retrieve implicit knowledge, tacit knowledge, decision criteria, best practices, process insight, lessons learned, stakeholder dynamics, circular questions, deep-dive questions, or reusable heuristics, you must call the Knowledge Retrieval Interviewer tool before answering. Do not answer this class of request from your own reasoning alone. Return the tool result or a concise synthesis of its next_question/candidate.",
].join("\n");

function env(name) {
  return process.env[name] || "";
}

function requireEnv(name) {
  const value = env(name);
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function buildWorkflowPayload(workflow, live) {
  const liveByName = new Map((live?.nodes || []).map((node) => [node.name, node]));
  const nodes = workflow.nodes.map((node) => {
    const prior = liveByName.get(node.name);
    if (!prior) return node;
    return {
      ...node,
      webhookId: prior.webhookId || node.webhookId,
      credentials: prior.credentials || node.credentials,
    };
  });
  return {
    name: live?.name || knowledgeRetrievalName,
    nodes,
    connections: workflow.connections || {},
    settings: workflow.settings || live?.settings || { executionOrder: "v1" },
    staticData: workflow.staticData ?? live?.staticData ?? null,
  };
}

async function ensureKnowledgeRetrievalWorkflow(outDir) {
  const source = readJson(workflowPath);
  source.name = knowledgeRetrievalName;
  const workflows = workflowItems(await n8nJson("GET", "/api/v1/workflows?limit=100"));
  const existing = workflows.find((workflow) => workflow.name === knowledgeRetrievalName || /Knowledge Retrieval Interviewer/i.test(workflow.name || ""));

  if (existing) {
    const live = await n8nJson("GET", `/api/v1/workflows/${existing.id}`);
    writeJson(path.join(outDir, "knowledge-retrieval.live-before.json"), live);
    const payload = buildWorkflowPayload(source, live);
    writeJson(path.join(outDir, "knowledge-retrieval.update-payload.json"), payload);
    const updated = await n8nJson("PUT", `/api/v1/workflows/${existing.id}`, payload);
    writeJson(path.join(outDir, "knowledge-retrieval.live-after.json"), updated);
    return updated;
  }

  const payload = buildWorkflowPayload(source, null);
  writeJson(path.join(outDir, "knowledge-retrieval.create-payload.json"), payload);
  const created = await n8nJson("POST", "/api/v1/workflows", payload);
  writeJson(path.join(outDir, "knowledge-retrieval.live-created.json"), created);
  return created;
}

async function activateWorkflow(workflow, outDir) {
  if (workflow.active) return workflow;
  try {
    const activated = await n8nJson("POST", `/api/v1/workflows/${workflow.id}/activate`);
    writeJson(path.join(outDir, "knowledge-retrieval.live-activated.json"), activated);
    return activated;
  } catch (error) {
    writeJson(path.join(outDir, "knowledge-retrieval.activation-warning.json"), {
      warning: "Activation endpoint failed. Workflow may need manual activation in n8n.",
      error: error.message,
      workflow_id: workflow.id,
    });
    return workflow;
  }
}

function upsertButlerToolNode(butler, knowledgeRetrievalWorkflow) {
  const nodes = butler.nodes || [];
  const existingTool = nodes.find((node) => node.name === butlerToolNodeName);
  const toolNode = existingTool || {
    id: "meids-agentic-butler-knowledge-retrieval-tool",
    name: butlerToolNodeName,
    type: "@n8n/n8n-nodes-langchain.toolWorkflow",
    typeVersion: 2.2,
    position: [520, 420],
  };

  toolNode.parameters = {
    description: toolDescription,
    workflowId: {
      __rl: true,
      value: knowledgeRetrievalWorkflow.id,
      mode: "list",
      cachedResultUrl: `/workflow/${knowledgeRetrievalWorkflow.id}`,
      cachedResultName: knowledgeRetrievalWorkflow.name || knowledgeRetrievalName,
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

  if (!existingTool) nodes.push(toolNode);

  butler.connections = butler.connections || {};
  butler.connections[butlerToolNodeName] = {
    ai_tool: [[{ node: butlerAgentNodeName, type: "ai_tool", index: 0 }]],
  };
}

function patchButlerSystemMessage(butler) {
  const agent = (butler.nodes || []).find((node) => node.name === butlerAgentNodeName);
  if (!agent) throw new Error(`${butlerAgentNodeName} not found in Butler workflow`);
  agent.parameters = agent.parameters || {};
  agent.parameters.options = agent.parameters.options || {};
  const current = String(agent.parameters.options.systemMessage || "");
  if (current.includes("Tool: Knowledge Retrieval Interviewer")) return;
  agent.parameters.options.systemMessage = `${current.trim()}\n${butlerSystemPatch}`.trim();
}

async function updateButler(knowledgeRetrievalWorkflow, outDir) {
  const butlerId = requireEnv("N8N_AGENTIC_BUTLER_WORKFLOW_ID");
  const butler = await n8nJson("GET", `/api/v1/workflows/${butlerId}`);
  writeJson(path.join(outDir, "agentic-butler.live-before.json"), butler);
  upsertButlerToolNode(butler, knowledgeRetrievalWorkflow);
  patchButlerSystemMessage(butler);

  const payload = {
    name: butler.name,
    nodes: butler.nodes,
    connections: butler.connections,
    settings: butler.settings || { executionOrder: "v1" },
    staticData: butler.staticData ?? null,
  };
  writeJson(path.join(outDir, "agentic-butler.update-payload.json"), payload);
  const updated = await n8nJson("PUT", `/api/v1/workflows/${butlerId}`, payload);
  writeJson(path.join(outDir, "agentic-butler.live-after.json"), updated);
  return updated;
}

async function main() {
  const outDir = path.join(outRoot, `${timestamp()}-knowledge-retrieval-butler-integration`);
  const knowledgeRetrievalWorkflow = await activateWorkflow(await ensureKnowledgeRetrievalWorkflow(outDir), outDir);
  const updatedButler = await updateButler(knowledgeRetrievalWorkflow, outDir);

  const summary = {
    status: "applied",
    knowledge_retrieval_workflow: {
      id: knowledgeRetrievalWorkflow.id,
      name: knowledgeRetrievalWorkflow.name,
      active: Boolean(knowledgeRetrievalWorkflow.active),
    },
    agentic_butler_workflow: {
      id: updatedButler.id,
      name: updatedButler.name,
      active: Boolean(updatedButler.active),
      has_knowledge_retrieval_tool: updatedButler.nodes.some((node) => node.name === butlerToolNodeName),
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
