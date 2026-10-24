#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const applyLive = process.argv.includes("--apply");
const actorId = String(process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || "eKI3qM7nyCNn9r1q");

const guards = {
  actor: `Grounded Skill Chain Guardrail
When a requested work artifact or skill run must use approved, reviewed, stored, current-twin, or organizational evidence, call Knowledge Fabric Agent with operation=retrieve before calling Agentic Butler. Pass only the returned evidence package, including source IDs or titles and grounding status, into the Butler delegation. If retrieval is not_found, insufficient, contradictory, or only loosely related, do not delegate a factual draft: return not_found/partial and ask one targeted question. Never invent illustrative entities, metrics, dates, risks, or sources unless the user explicitly asks for a hypothetical example; label hypothetical content clearly.`,
  butler: `Grounded Skill Chain Guardrail
For any task whose objective says approved, reviewed, stored, source-grounded, current-twin, or organizational evidence, require an evidence package from Actor Twin containing source IDs or titles and grounding status. If it is absent, loosely related, not_found, or insufficient, return status=needs_clarification with missing_inputs=[evidence_package] and do not call Skill Orchestrator. Never replace missing evidence with plausible or synthetic facts.`,
  skill: `Grounded Skill Chain Guardrail
Before planning an evidence-dependent run, validate that Agentic Butler supplied an evidence package with source IDs or titles and grounding status. If the objective requires approved/reviewed/current-twin evidence and the package is missing or insufficient, return status=blocked with missing_inputs=[evidence_package] and do not call Task Agent. Pass the evidence package unchanged into every bounded task that depends on it. Never manufacture illustrative facts to complete a requested artifact.`,
  task: `Grounded Skill Chain Guardrail
Use only facts present in the supplied evidence package. Preserve source IDs or titles in the result. If the task requires approved/reviewed/current-twin evidence and none is supplied, return status=blocked with missing_inputs=[evidence_package]; do not draft substitute facts. Do not invent entities, metrics, dates, incidents, dependencies, or citations unless the objective explicitly requests a hypothetical example, in which case label every such element hypothetical.`,
};

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function agentNode(workflow) {
  return workflow.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.agent");
}

function appendGuard(workflow, text) {
  const node = agentNode(workflow);
  if (!node) throw new Error(`${workflow.name} has no AI Agent node.`);
  const prompt = String(node.parameters?.options?.systemMessage || "");
  const marker = text.split("\n")[0];
  const withoutOld = prompt.includes(marker) ? prompt.slice(0, prompt.indexOf(marker)).trimEnd() : prompt.trimEnd();
  node.parameters.options ||= {};
  node.parameters.options.systemMessage = `${withoutOld}\n\n${text}`;
  return workflow;
}

function removeDisconnectedTaskDuplicate(workflow) {
  const duplicateName = "Call 'MeIDs Task Agent'";
  const outgoing = workflow.connections?.[duplicateName];
  const incoming = Object.values(workflow.connections || {}).some((modes) =>
    Object.values(modes || {}).flat(2).some((connection) => connection?.node === duplicateName),
  );
  const hasOutgoing = Object.values(outgoing || {}).flat(2).some(Boolean);
  if (!incoming && !hasOutgoing) {
    workflow.nodes = workflow.nodes.filter((node) => node.name !== duplicateName);
    delete workflow.connections[duplicateName];
  }
  return workflow;
}

function workflowTarget(workflow, toolName) {
  return String(workflow.nodes.find((node) => node.name === toolName)?.parameters?.workflowId?.value || "");
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
  if (!base || !key) throw new Error("N8N_API_BASE_URL and N8N_API_KEY are required.");
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

function saveCanonical(label, workflow) {
  const canonical = apiPayload(workflow);
  writeJson(path.join(root, "workflows", "n8n", `${label}.workflow.json`), canonical);
  writeJson(path.join(root, "workflows", "n8n", "import-ready", `${label}.ai-agent.import.json`), canonical);
}

async function main() {
  if (!applyLive) {
    throw new Error("Use --apply so workflow targets are discovered from the live tool hierarchy.");
  }
  const actorBefore = await n8n("GET", `/api/v1/workflows/${actorId}`);
  const butlerId = workflowTarget(actorBefore, "Agentic Butler");
  if (!butlerId) throw new Error("Actor Twin has no Agentic Butler target.");
  const butlerBefore = await n8n("GET", `/api/v1/workflows/${butlerId}`);
  const skillId = workflowTarget(butlerBefore, "Skill Orchestrator");
  if (!skillId) throw new Error("Agentic Butler has no Skill Orchestrator target.");
  const skillBefore = await n8n("GET", `/api/v1/workflows/${skillId}`);
  const taskId = workflowTarget(skillBefore, "Task Agent") || workflowTarget(skillBefore, "Call 'MeIDs Task Agent'");
  if (!taskId) throw new Error("Skill Orchestrator has no Task Agent target.");
  const taskBefore = await n8n("GET", `/api/v1/workflows/${taskId}`);

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const backup = path.join(root, "exports", "n8n-live-backups", `${stamp}-grounded-skill-chain`);
  for (const [label, workflow] of Object.entries({ actor: actorBefore, butler: butlerBefore, skill: skillBefore, task: taskBefore })) {
    writeJson(path.join(backup, `${label}.before.json`), workflow);
  }

  const actorAfter = await publish(actorId, appendGuard(actorBefore, guards.actor));
  const butlerAfter = await publish(butlerId, appendGuard(butlerBefore, guards.butler));
  const skillAfter = await publish(skillId, removeDisconnectedTaskDuplicate(appendGuard(skillBefore, guards.skill)));
  const taskAfter = await publish(taskId, appendGuard(taskBefore, guards.task));
  const outputs = { actor: actorAfter, butler: butlerAfter, skill: skillAfter, task: taskAfter };
  for (const [label, workflow] of Object.entries(outputs)) {
    writeJson(path.join(backup, `${label}.after.json`), workflow);
  }

  saveCanonical("actor-twin", actorAfter);
  saveCanonical("agentic-butler", butlerAfter);
  saveCanonical("skill-orchestrator", skillAfter);
  saveCanonical("task-agent", taskAfter);
  console.log(JSON.stringify({
    status: "grounded_skill_chain_published",
    workflows: { actor: actorId, butler: butlerId, skill_orchestrator: skillId, task_agent: taskId },
    backup: path.relative(root, backup).replaceAll("\\", "/"),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
