#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outRoot = path.join(root, "exports", "n8n-live-backups");

const workflows = [
  {
    id: process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || "eKI3qM7nyCNn9r1q",
    label: "actor-twin",
    agentNames: ["Actor Twin AI Agent1", "Actor Twin AI Agent"],
    patch: [
      "Runtime Budget Guardrail",
      "Prefer direct answers for routine low-risk turns. Do not call Critical Faculty or Learning Agent for ordinary chat, simple drafting, identity/status questions, or low-risk formatting. When a tool is needed, call the minimum number of tools and summarize the result concisely for the user.",
    ].join("\n"),
  },
  {
    id: process.env.N8N_AGENTIC_BUTLER_WORKFLOW_ID || "KZOqZRUAnVfFEAYJ",
    label: "agentic-butler",
    agentNames: ["Agentic Butler AI Agent"],
    patch: [
      "Runtime Budget Guardrail",
      "Prefer compact output over exhaustive output. Keep one-step drafts inside Agentic Butler. For multi-step work, call Skill Orchestrator once with a compact objective and explicit task-agent budget. Do not call both Skill Orchestrator and Critical Faculty unless the work is both multi-step and decision-risky.",
    ].join("\n"),
  },
  {
    id: process.env.N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID || "7Ci86PxXipwvYpKv",
    label: "knowledge-fabric",
    agentNames: ["Knowledge Fabric AI Agent"],
    patch: [
      "Runtime Budget Guardrail",
      "Prefer direct retrieval/staging over additional critique loops. Call Critical Faculty only for evidence contradictions, duplicate/merge uncertainty, graph/vector risk, or review-state ambiguity. Call Learning Agent only for reusable lessons, not every trace detail.",
    ].join("\n"),
  },
];

function env(name) {
  return String(process.env[name] || "").trim();
}

function requireEnv(name) {
  const value = env(name);
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
}

async function n8nJson(method, endpoint, body) {
  const baseUrl = requireEnv("N8N_API_BASE_URL").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-N8N-API-KEY": requireEnv("N8N_API_KEY"),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${endpoint} returned ${response.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}

function findAgentNode(workflow, names) {
  return (workflow.nodes || []).find((node) => names.includes(node.name))
    || (workflow.nodes || []).find((node) => node.type === "@n8n/n8n-nodes-langchain.agent");
}

async function main() {
  const outDir = path.join(outRoot, `${timestamp()}-agent-runtime-budget-guardrails`);
  const results = [];
  for (const item of workflows) {
    const workflow = await n8nJson("GET", `/api/v1/workflows/${item.id}`);
    writeJson(path.join(outDir, `${item.label}.live-before.json`), workflow);
    const agent = findAgentNode(workflow, item.agentNames);
    if (!agent) throw new Error(`No AI Agent found in ${workflow.name}`);
    agent.parameters = agent.parameters || {};
    agent.parameters.options = agent.parameters.options || {};
    const current = String(agent.parameters.options.systemMessage || "");
    const applied = !current.includes("Runtime Budget Guardrail");
    if (applied) agent.parameters.options.systemMessage = `${current.trim()}\n\n${item.patch}`.trim();
    const payload = {
      name: workflow.name,
      nodes: workflow.nodes,
      connections: workflow.connections || {},
      settings: workflow.settings || { executionOrder: "v1" },
      staticData: workflow.staticData ?? null,
    };
    writeJson(path.join(outDir, `${item.label}.update-payload.json`), payload);
    const updated = await n8nJson("PUT", `/api/v1/workflows/${item.id}`, payload);
    writeJson(path.join(outDir, `${item.label}.live-after.json`), updated);
    results.push({ id: updated.id, name: updated.name, active: Boolean(updated.active), applied });
  }
  const summary = {
    status: "applied",
    workflows: results,
    backup: path.relative(root, outDir).replaceAll("\\", "/"),
  };
  writeJson(path.join(outDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
