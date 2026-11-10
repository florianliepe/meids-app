#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const applyLive = process.argv.includes("--apply");
const actorId = String(process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || "eKI3qM7nyCNn9r1q");
const backendBase = String(process.env.MEIDS_BACKEND_BASE_URL || "https://meids-prod-backend-1853a19b.azurewebsites.net").replace(/\/+$/, "");
const marker = "Me.IDs Queue Background Work";

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function cleanPayload(workflow) {
  return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections || {}, settings: workflow.settings || { executionOrder: "v1" }, staticData: workflow.staticData ?? null };
}
function materializeAdapter() {
  const workflow = readJson(path.join(root, "workflows/n8n/queue-background-work.workflow.json"));
  const request = workflow.nodes.find((node) => node.name === "Queue durable work");
  request.parameters.url = `${backendBase}/api/agents/work`;
  return workflow;
}
function attachTool(actor, workflowId, workflowName) {
  const agent = actor.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.agent");
  const trigger = actor.nodes.find((node) => node.name === "When chat message received");
  const classifier = actor.nodes.find((node) => node.name === "Classify interaction route");
  if (!agent || !trigger || !classifier) throw new Error("Actor workflow is missing its trigger, classifier, or agent.");
  let tool = actor.nodes.find((node) => node.name === marker);
  const schema = [
    ["message", "string", true], ["knowledge_access_token", "string", false], ["twin_id", "string", true],
    ["session_id", "string", false], ["idempotency_key", "string", false], ["critical_faculty", "boolean", false],
  ].map(([id, type, required]) => ({ id, displayName: id, required, defaultMatch: false, display: true, canBeUsedToMatch: true, type, removed: false }));
  const value = {
    message: "={{ $fromAI('message', 'The complete no-write multi-step request to execute in the background.', 'string') }}",
    knowledge_access_token: "={{ $('When chat message received').first().json.metadata?.authorization?.knowledgeAccessToken || '' }}",
    twin_id: "={{ $('When chat message received').first().json.metadata?.identity?.activeTwinId || '' }}",
    session_id: "={{ $('When chat message received').first().json.sessionId || '' }}",
    idempotency_key: "={{ ($('When chat message received').first().json.sessionId || 'chat') + ':' + $execution.id }}",
    critical_faculty: "={{ $('Classify interaction route').first().json.routing_contract?.gates?.critical_faculty === true }}",
  };
  const parameters = {
    description: "Use only when routing_contract.route is execute_work_async. Queue the complete no-write request, then immediately tell the user that work continues and include the returned job_id. Never use for external side effects, knowledge writes, direct answers, or retrieval-only requests.",
    workflowId: { __rl: true, value: workflowId, mode: "list", cachedResultUrl: `/workflow/${workflowId}`, cachedResultName: workflowName },
    workflowInputs: { mappingMode: "defineBelow", value, matchingColumns: [], schema, attemptToConvertTypes: false, convertFieldsToString: false },
  };
  if (!tool) {
    tool = { id: "meids-queue-background-work-tool", name: marker, type: "@n8n/n8n-nodes-langchain.toolWorkflow", typeVersion: 2.2, position: [208, 1904], parameters };
    actor.nodes.push(tool);
  } else tool.parameters = parameters;
  actor.connections[marker] = { ai_tool: [[{ node: agent.name, type: "ai_tool", index: 0 }]] };
  const instruction = "For execute_work_async, call Me.IDs Queue Background Work exactly once and return its queued job_id immediately. Do not call Agentic Butler inline for that route.";
  agent.parameters.options = agent.parameters.options || {};
  if (!String(agent.parameters.options.systemMessage || "").includes(instruction)) {
    agent.parameters.options.systemMessage = `${String(agent.parameters.options.systemMessage || "").trim()}\n\n${instruction}`.trim();
  }
  return actor;
}
async function n8nJson(method, endpoint, body) {
  const base = String(process.env.N8N_API_BASE_URL || "").replace(/\/+$/, "");
  const key = String(process.env.N8N_API_KEY || "");
  if (!base || !key) throw new Error("N8N_API_BASE_URL and N8N_API_KEY are required for --apply.");
  const response = await fetch(`${base}${endpoint}`, { method, headers: { Accept: "application/json", "Content-Type": "application/json", "X-N8N-API-KEY": key }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${endpoint} returned ${response.status}: ${text.slice(0, 700)}`);
  return text ? JSON.parse(text) : {};
}
async function main() {
  const adapter = materializeAdapter();
  const result = { status: applyLive ? "published" : "prepared", contract: "meids.agent-work.v1", backend: backendBase };
  if (!applyLive) {
    result.adapter = adapter.name;
    result.actor = actorId;
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const backup = path.join(root, "exports/n8n-live-backups", `${stamp}-background-work-tool`);
  const created = await n8nJson("POST", "/api/v1/workflows", cleanPayload(adapter));
  writeJson(path.join(backup, "background-work.created.json"), created);
  await n8nJson("POST", `/api/v1/workflows/${created.id}/activate`);
  const actorBefore = await n8nJson("GET", `/api/v1/workflows/${actorId}`);
  writeJson(path.join(backup, "actor-twin.before.json"), actorBefore);
  const actorUpdated = await n8nJson("PUT", `/api/v1/workflows/${actorId}`, cleanPayload(attachTool(actorBefore, created.id, created.name)));
  writeJson(path.join(backup, "actor-twin.after.json"), actorUpdated);
  writeJson(path.join(root, "workflows/n8n/actor-twin.workflow.json"), cleanPayload(actorUpdated));
  result.workflow = { id: created.id, name: created.name, active: true };
  result.actor = { id: actorUpdated.id, name: actorUpdated.name, active: Boolean(actorUpdated.active) };
  result.backup = path.relative(root, backup).replaceAll("\\", "/");
  console.log(JSON.stringify(result, null, 2));
}
main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
