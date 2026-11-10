#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const actorPath = path.join(root, "workflows/n8n/actor-twin.workflow.json");
const applyLive = process.argv.includes("--apply");
const writeLocal = process.argv.includes("--write");
const actorId = String(process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || "eKI3qM7nyCNn9r1q");
const backendBase = String(process.env.MEIDS_BACKEND_BASE_URL || "https://meids-prod-backend-1853a19b.azurewebsites.net").replace(/\/+$/, "");
const obsoleteTool = "Me.IDs Queue Background Work";

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function payload(workflow) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections || {},
    settings: workflow.settings || { executionOrder: "v1" },
    staticData: workflow.staticData ?? null,
  };
}
function node(name, type, position, parameters, extra = {}) {
  return { id: `meids-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name, type, typeVersion: extra.typeVersion || 1, position, parameters, ...extra };
}
function upsertNode(workflow, replacement) {
  const index = workflow.nodes.findIndex((item) => item.name === replacement.name);
  if (index >= 0) workflow.nodes[index] = { ...workflow.nodes[index], ...replacement };
  else workflow.nodes.push(replacement);
}
function patchWorkflow(workflow) {
  const trigger = workflow.nodes.find((item) => item.name === "When chat message received");
  const classifier = workflow.nodes.find((item) => item.name === "Classify interaction route");
  const actor = workflow.nodes.find((item) => item.name === "Actor Twin AI Agent1");
  if (!trigger || !classifier || !actor) throw new Error("Actor workflow is missing trigger, classifier, or AI Agent.");

  upsertNode(workflow, node("Switch async route", "n8n-nodes-base.switch", [-300, 1472], {
    rules: { values: [{ conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
      conditions: [{
        leftValue: "={{ $json.routing_contract?.route || '' }}",
        rightValue: "execute_work_async",
        operator: { type: "string", operation: "equals" },
      }],
      combinator: "and",
    } }] },
    options: { fallbackOutput: "extra" },
  }, { typeVersion: 3.2 }));

  upsertNode(workflow, node("Queue durable background work", "n8n-nodes-base.httpRequest", [-80, 1312], {
    method: "POST",
    url: `${backendBase}/api/agents/work`,
    sendHeaders: true,
    headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ (() => { const trigger = $('When chat message received').first().json; const route = $('Classify interaction route').first().json.routing_contract || {}; return JSON.stringify({ knowledge_access_token: trigger.metadata?.authorization?.knowledgeAccessToken || '', twin_id: trigger.metadata?.identity?.activeTwinId || '', message: String(trigger.chatInput || ''), session_id: String(trigger.sessionId || ''), idempotency_key: String(trigger.sessionId || 'chat') + ':' + $execution.id, critical_faculty: route.gates?.critical_faculty === true, allow_external_side_effects: false }); })() }}",
    options: { timeout: 5000 },
  }, { typeVersion: 4.2, onError: "continueRegularOutput" }));

  upsertNode(workflow, node("Format background acknowledgement", "n8n-nodes-base.code", [160, 1312], {
    jsCode: "const job = $json || {}; const id = String(job.job_id || ''); if (!id) { const detail = String(job.error?.message || job.error || job.message || ''); const auth = /401|authori[sz]ation|auth context|token/i.test(detail); return [{ json: { output: auth ? 'Your session authorization has expired. Reconnect the Actor Twin, then submit the request again; it was not replayed and no background job was started.' : 'The background request could not be queued. No work was started; retry when the service is available.', contract: 'meids.agent-work.v1', status: auth ? 'auth_required' : 'queue_failed', job_id: '', background_work: false, retryable: true } }]; } const status = String(job.status || 'queued'); return [{ json: { output: `Your request is queued and continues in the background. Job ID: ${id}. Status: ${status}. You can keep using the Actor Twin while it runs.`, contract: 'meids.agent-work.v1', status, job_id: id, background_work: true } }];",
  }, { typeVersion: 2 }));

  workflow.nodes = workflow.nodes.filter((item) => item.name !== obsoleteTool);
  delete workflow.connections[obsoleteTool];
  workflow.connections["Classify interaction route"] = { main: [[{ node: "Switch async route", type: "main", index: 0 }]] };
  workflow.connections["Switch async route"] = { main: [
    [{ node: "Queue durable background work", type: "main", index: 0 }],
    [{ node: actor.name, type: "main", index: 0 }],
  ] };
  workflow.connections["Queue durable background work"] = { main: [[{ node: "Format background acknowledgement", type: "main", index: 0 }]] };
  workflow.connections["Format background acknowledgement"] = { main: [[]] };

  const oldInstruction = "For execute_work_async, call Me.IDs Queue Background Work exactly once and return its queued job_id immediately. Do not call Agentic Butler inline for that route.";
  const deterministicInstruction = "execute_work_async is intercepted by a deterministic branch before this agent. If such a route reaches this agent because of a transport fault, do not call Agentic Butler; return a bounded routing error.";
  actor.parameters.options = actor.parameters.options || {};
  const current = String(actor.parameters.options.systemMessage || "").replace(oldInstruction, "").trim();
  if (!current.includes(deterministicInstruction)) actor.parameters.options.systemMessage = `${current}\n\n${deterministicInstruction}`;
  return workflow;
}

async function n8nJson(method, endpoint, body) {
  const base = String(process.env.N8N_API_BASE_URL || "").replace(/\/+$/, "");
  const key = String(process.env.N8N_API_KEY || "");
  if (!base || !key) throw new Error("N8N_API_BASE_URL and N8N_API_KEY are required for --apply.");
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-N8N-API-KEY": key },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${endpoint} returned ${response.status}: ${text.slice(0, 700)}`);
  return text ? JSON.parse(text) : {};
}

async function main() {
  const local = patchWorkflow(readJson(actorPath));
  if (writeLocal) writeJson(actorPath, local);
  const result = {
    status: writeLocal ? "written" : "prepared",
    contract: "meids.agent-work.v1",
    actor: actorId,
    deterministic_branch: ["Classify interaction route", "Switch async route", "Queue durable background work", "Format background acknowledgement"],
  };
  if (!applyLive) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const backup = path.join(root, "exports/n8n-live-backups", `${stamp}-deterministic-background-branch`);
  const before = await n8nJson("GET", `/api/v1/workflows/${actorId}`);
  writeJson(path.join(backup, "actor-twin.before.json"), before);
  const patched = patchWorkflow(structuredClone(before));
  if (before.active) await n8nJson("POST", `/api/v1/workflows/${actorId}/deactivate`, {});
  const updated = await n8nJson("PUT", `/api/v1/workflows/${actorId}`, payload(patched));
  await n8nJson("POST", `/api/v1/workflows/${actorId}/publish`, {});
  const activated = await n8nJson("POST", `/api/v1/workflows/${actorId}/activate`, {});
  writeJson(path.join(backup, "actor-twin.after.json"), activated);
  console.log(JSON.stringify({ ...result, status: "published", active: Boolean(activated.active), backup: path.relative(root, backup).replaceAll("\\", "/") }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
