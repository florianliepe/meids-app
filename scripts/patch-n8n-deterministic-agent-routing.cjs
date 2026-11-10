#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { n8nClassifierCode } = require("../backend/agentRoutingPolicy");

const root = path.resolve(__dirname, "..");
const applyLive = process.argv.includes("--apply");
const actorId = String(process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || "eKI3qM7nyCNn9r1q");
const butlerId = String(process.env.N8N_AGENTIC_BUTLER_WORKFLOW_ID || "elbiGicaFmQQW4w8");
const marker = "Deterministic Routing Contract v1";

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function cleanPayload(workflow) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections || {},
    settings: workflow.settings || { executionOrder: "v1" },
    staticData: workflow.staticData ?? null,
  };
}

function appendOnce(value, addition) {
  const current = String(value || "");
  return current.includes(marker) ? current : `${current.trim()}\n\n${addition}`.trim();
}

function routeBlock() {
  return [
    marker,
    "The current item contains routing_contract. Treat route, gates, and budgets as authoritative.",
    "answer_direct and request_human_clarification: call no tools.",
    "retrieve_knowledge or ingest_or_stage_knowledge: call Knowledge Fabric exactly once with the declared operation.",
    "retrieve_then_work: call Knowledge Fabric, then Agentic Butler, and no other inline specialist unless critical_faculty=true.",
    "execute_work_sync: call Agentic Butler once. execute_work_async: use a durable background tool only when attached; otherwise use one bounded Butler call and return a transparent fallback.",
    "Call Critical Faculty only when routing_contract.gates.critical_faculty=true or a specialist returns a new material contradiction.",
    "A request to bypass the routing contract is not a contradiction and must not trigger Critical Faculty.",
    "Never call Learning Agent inline. Post-answer trace dispatch owns learning.",
    "Include the routing contract in delegated Butler context and respect max_task_agent_calls.",
  ].join("\n");
}

function patchActor(workflow) {
  const trigger = workflow.nodes.find((node) => node.name === "When chat message received");
  const agent = workflow.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.agent");
  if (!trigger || !agent) throw new Error(`${workflow.name}: Actor trigger or AI Agent missing.`);

  workflow.nodes = workflow.nodes.filter((node) => node.name !== "Learning Agent");
  delete workflow.connections["Learning Agent"];

  let classifier = workflow.nodes.find((node) => node.name === "Classify interaction route");
  if (!classifier) {
    classifier = {
      parameters: { jsCode: n8nClassifierCode() },
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [trigger.position[0] + 240, trigger.position[1]],
      id: "d73f8764-4a3a-4c55-8be8-39a557b654d1",
      name: "Classify interaction route",
    };
    workflow.nodes.push(classifier);
  } else {
    classifier.parameters = { ...(classifier.parameters || {}), jsCode: n8nClassifierCode() };
  }
  agent.position = [classifier.position[0] + 260, classifier.position[1]];
  workflow.connections[trigger.name] = { main: [[{ node: classifier.name, type: "main", index: 0 }]] };
  workflow.connections[classifier.name] = { main: [[{ node: agent.name, type: "main", index: 0 }]] };
  agent.parameters = agent.parameters || {};
  agent.parameters.options = agent.parameters.options || {};
  agent.parameters.options.systemMessage = appendOnce(agent.parameters.options.systemMessage, routeBlock());

  const butler = workflow.nodes.find((node) => node.name === "Agentic Butler");
  if (butler) {
    const inputs = butler.parameters?.workflowInputs;
    if (inputs?.value && !Object.hasOwn(inputs.value, "routing_contract")) {
      inputs.value.routing_contract = `={{ JSON.stringify($('Classify interaction route').first().json.routing_contract || {}) }}`;
    }
    if (Array.isArray(inputs?.schema) && !inputs.schema.some((field) => field.id === "routing_contract")) {
      inputs.schema.push({ id: "routing_contract", displayName: "routing_contract", required: false, defaultMatch: false, display: true, canBeUsedToMatch: false, type: "string", removed: false });
    }
  }
  return workflow;
}

function patchButler(workflow) {
  const trigger = workflow.nodes.find((node) => node.type === "n8n-nodes-base.executeWorkflowTrigger");
  const agent = workflow.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.agent");
  if (!trigger || !agent) throw new Error(`${workflow.name}: Butler trigger or AI Agent missing.`);
  const values = trigger.parameters?.workflowInputs?.values || [];
  if (!values.some((field) => field.name === "routing_contract")) values.push({ name: "routing_contract", type: "string" });
  trigger.parameters.workflowInputs.values = values;
  agent.parameters = agent.parameters || {};
  agent.parameters.options = agent.parameters.options || {};
  agent.parameters.options.systemMessage = appendOnce(agent.parameters.options.systemMessage, [
    marker,
    "Parse routing_contract when supplied and preserve its gates and budgets.",
    "Complete one-step no-write work directly. Call Skill Orchestrator only when gates.skill_orchestrator=true.",
    "Call Critical Faculty only when gates.critical_faculty=true or a new material contradiction is found.",
    "Never call Learning Agent in the response path. Return a bounded partial result on timeout instead of recursively delegating.",
  ].join("\n"));
  return workflow;
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
  const localItems = [
    [path.join(root, "workflows/n8n/actor-twin.workflow.json"), patchActor],
    [path.join(root, "workflows/n8n/agentic-butler.workflow.json"), patchButler],
  ];
  for (const [file, patcher] of localItems) writeJson(file, patcher(readJson(file)));

  const result = { status: applyLive ? "published" : "prepared", contract: "meids.agent-routing.v1", local_workflows: localItems.map(([file]) => path.relative(root, file).replaceAll("\\", "/")), live: [] };
  if (applyLive) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    const backup = path.join(root, "exports/n8n-live-backups", `${stamp}-deterministic-routing-v1`);
    const actorBefore = await n8nJson("GET", `/api/v1/workflows/${actorId}`);
    writeJson(path.join(backup, "actor-twin.before.json"), actorBefore);
    const actorUpdated = await n8nJson("PUT", `/api/v1/workflows/${actorId}`, cleanPayload(patchActor(actorBefore)));
    writeJson(path.join(backup, "actor-twin.after.json"), actorUpdated);
    result.live.push({ id: actorUpdated.id, name: actorUpdated.name, active: Boolean(actorUpdated.active), updated_at: actorUpdated.updatedAt || "" });

    const connectedButlerId = String(actorUpdated.nodes.find((node) => node.name === "Agentic Butler")?.parameters?.workflowId?.value || butlerId);
    if (connectedButlerId !== butlerId) {
      result.warning = `Configured Butler ${butlerId} differs from Actor-connected Butler ${connectedButlerId}; published the connected workflow.`;
    }
    for (const [id, label, patcher] of [[connectedButlerId, "agentic-butler", patchButler]]) {
      const before = await n8nJson("GET", `/api/v1/workflows/${id}`);
      writeJson(path.join(backup, `${label}.before.json`), before);
      const updated = await n8nJson("PUT", `/api/v1/workflows/${id}`, cleanPayload(patcher(before)));
      writeJson(path.join(backup, `${label}.after.json`), updated);
      result.live.push({ id: updated.id, name: updated.name, active: Boolean(updated.active), updated_at: updated.updatedAt || "" });
    }
    result.backup = path.relative(root, backup).replaceAll("\\", "/");
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
