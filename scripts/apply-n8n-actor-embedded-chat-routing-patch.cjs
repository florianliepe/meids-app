const fs = require("node:fs");
const path = require("node:path");

const baseUrl = process.env.N8N_API_BASE_URL;
const apiKey = process.env.N8N_API_KEY;
const workflowId = process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || "eKI3qM7nyCNn9r1q";

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!baseUrl) fail("N8N_API_BASE_URL is required");
if (!apiKey) fail("N8N_API_KEY is required");
if (!workflowId) fail("N8N_ACTOR_TWIN_WORKFLOW_ID is required");

const embeddedChatSystemMessage = `You are the Me.IDs Actor Twin in an embedded n8n chat workflow.

You are the user-facing routing authority. Keep direct answers lean, but delegate specialist work through the attached n8n workflow tools.
When a tool route applies, call the attached workflow tool immediately. Do not tell the user that you need to delegate, that you would delegate, or that another agent owns the task. Execute the tool call and then synthesize the returned result.

Tool: Knowledge Fabric Agent
Call this tool when the user asks to retrieve, inspect, remember, save, stage, ingest, update, or structure knowledge, OKF concepts, source notes, transcripts, evidence, review-needed concepts, vector-cache context, or graph context.
New or changed knowledge may be created automatically, but it must remain review_needed, updated, or candidate until review.
Do not call Knowledge Fabric Agent for tacit-knowledge interviews, implicit decision criteria, circular questioning, deep-dive elicitation, stakeholder-perspective elicitation, lessons learned, or best-practice interviews. Those must go to Agentic Butler so it can run Knowledge Retrieval Interviewer.

Tool: Agentic Butler
Call this tool when the user asks to draft, write, prepare, compose, summarize, plan, prioritize, run an approved skill, or produce a work artifact such as an email, meeting brief, agenda, planning note, status update, or backlog proposal.
Draft-only and no-write work does not need human approval. Do not produce the artifact yourself before calling this tool.

Hard routing rule: if the user asks to extract, elicit, uncover, retrieve implicit knowledge, tacit knowledge, decision criteria, best practices, process insight, lessons learned, stakeholder dynamics, circular questions, deep-dive questions, or reusable heuristics, call Agentic Butler. Agentic Butler owns the Knowledge Retrieval Interviewer task-agent call.
Do not answer these requests directly and do not stop after stating that Agentic Butler owns the task. Call Agentic Butler in the same turn.

Also call Agentic Butler when the user asks to create, design, build, define, or generate a new skill, agent, subagent, task agent, or reusable capability. The Butler must propose the concept, mode of action, value/USP, differentiation from existing capabilities, scope, boundaries, and task-agent outline. Human approval is required only before that generated capability becomes active, not before the Butler drafts the proposal.

Answer directly only for identity, purpose, self-description, simple conversation, or ordinary Q&A that does not need stored knowledge and does not produce a work artifact.

Final response contract:
- If Knowledge Fabric Agent was used, start with: "Delegated via Knowledge Fabric Agent."
- If Agentic Butler was used for normal work, start with: "Delegated via Agentic Butler."
- If Agentic Butler was used for new skill or agent creation, start with: "Delegated via Agentic Butler. Approval required before activation."
- Include the useful result for the user. Do not expose raw JSON unless the user asks.

`;

function backupDir() {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
  return path.join("exports", "n8n-live-backups", `${stamp}Z-actor-embedded-chat-routing-patch`);
}

async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      "X-N8N-API-KEY": apiKey,
      accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${url} failed ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

(async () => {
  const workflow = await request("GET", `${baseUrl}/api/v1/workflows/${workflowId}`);
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "actor-twin.live-before.json"), JSON.stringify(workflow, null, 2), "utf8");

  const trigger = workflow.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.chatTrigger");
  if (!trigger) fail("Refusing to patch: Actor Twin workflow is not an embedded chat-trigger workflow");

  const agent = workflow.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.agent");
  if (!agent) fail("Actor Twin AI Agent node not found");

  agent.parameters = agent.parameters || {};
  agent.parameters.options = agent.parameters.options || {};
  agent.parameters.options.systemMessage = embeddedChatSystemMessage;

  const renamedNodes = new Map();
  for (const node of workflow.nodes) {
    if (node.type !== "@n8n/n8n-nodes-langchain.toolWorkflow") continue;
    if (/Agentic Butler/i.test(node.name)) {
      renamedNodes.set(node.name, "Agentic Butler");
      node.name = "Agentic Butler";
      node.parameters = node.parameters || {};
      node.parameters.description = "Call this tool for draft/write/prepare/compose/summarize/plan/prioritize work, approved skill execution, new skill or agent proposals, and all implicit/tacit knowledge elicitation. For tacit knowledge, circular questions, decision criteria, best practices, lessons learned, process insight, or stakeholder dynamics, Agentic Butler must run its Knowledge Retrieval Interviewer tool. No approval is required for normal no-write work; approval is required only before generated capabilities become active or before external side effects.";
    }
    if (/Knowledge Fabric/i.test(node.name)) {
      renamedNodes.set(node.name, "Knowledge Fabric Agent");
      node.name = "Knowledge Fabric Agent";
      node.parameters = node.parameters || {};
      node.parameters.description = "Call this tool for direct OKF/vector/graph retrieval, evidence lookup, source-note handling, and automatic create/update of knowledge concepts in review_needed or updated_review_needed state. Do not use it for tacit-knowledge interviews, circular questions, deep-dive elicitation, implicit decision criteria, or best-practice extraction; route those to Agentic Butler.";
    }
  }

  for (const [oldName, newName] of renamedNodes) {
    if (workflow.connections[oldName]) {
      workflow.connections[newName] = workflow.connections[oldName];
      delete workflow.connections[oldName];
    }
    for (const source of Object.values(workflow.connections)) {
      for (const outputs of Object.values(source)) {
        for (const output of outputs) {
          for (const target of output) {
            if (target.node === oldName) target.node = newName;
          }
        }
      }
    }
  }

  workflow.connections["Agentic Butler"] = {
    ai_tool: [[{ node: agent.name, type: "ai_tool", index: 0 }]],
  };
  workflow.connections["Knowledge Fabric Agent"] = {
    ai_tool: [[{ node: agent.name, type: "ai_tool", index: 0 }]],
  };

  const payload = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings || {},
  };
  if (workflow.staticData) payload.staticData = workflow.staticData;

  fs.writeFileSync(path.join(dir, "actor-twin.routing-patch.update-payload.json"), JSON.stringify(payload, null, 2), "utf8");
  const updated = await request("PUT", `${baseUrl}/api/v1/workflows/${workflowId}`, payload);
  fs.writeFileSync(path.join(dir, "actor-twin.live-after.json"), JSON.stringify(updated, null, 2), "utf8");

  console.log(JSON.stringify({
    status: "applied",
    workflow_id: updated.id,
    active: updated.active,
    chat_trigger: trigger.webhookId,
    backup: dir.replaceAll("\\", "/"),
    nodes: updated.nodes.map((node) => node.name),
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
