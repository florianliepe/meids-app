#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const apply = process.argv.includes("--apply");
const workflowId = String(process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || "eKI3qM7nyCNn9r1q").trim();
const marker = "const learningSignal = /\\b(learn|lesson|retrospective|after[- ]action|uat|test|incident|failure|failed|error|remember|retain|knowledge increment|tacit|interview|decision review)\\b/i.test(input);";

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function n8nJson(method, endpoint, body) {
  const baseUrl = requiredEnv("N8N_API_BASE_URL").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-N8N-API-KEY": requiredEnv("N8N_API_KEY") },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${endpoint} returned ${response.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}

function patchWorkflow(workflow) {
  const node = workflow.nodes.find((item) => item.name === "Persist post-answer trace");
  if (!node) throw new Error("Persist post-answer trace node not found");
  const expression = String(node.parameters?.jsonBody || "");
  node.parameters.jsonBody = expression.replace(
    /const learningSignal = \/\\b\(learn\|lesson\|retrospective\|after\[- \]action\|uat\|test\|incident\|failure\|failed\|error\|remember\|retain\|knowledge increment\|tacit\|interview\|decision review\)\\b\/i\.test\(input \+ ' ' \+ output\);/,
    marker,
  );
  if (!node.parameters.jsonBody.includes(marker)) throw new Error("Post-answer learning expression was not patched");
  return workflow;
}

function payload(workflow) {
  return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || { executionOrder: "v1" }, staticData: workflow.staticData ?? null };
}

function write(relativePath, workflow) {
  fs.writeFileSync(path.join(root, relativePath), `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
}

async function main() {
  const workflow = patchWorkflow(await n8nJson("GET", `/api/v1/workflows/${workflowId}`));
  if (apply) {
    if (workflow.active) await n8nJson("POST", `/api/v1/workflows/${workflowId}/deactivate`, {});
    await n8nJson("PUT", `/api/v1/workflows/${workflowId}`, payload(workflow));
    await n8nJson("POST", `/api/v1/workflows/${workflowId}/activate`, {});
  }
  write("workflows/n8n/actor-twin.workflow.json", workflow);
  write("workflows/n8n/import-ready/actor-twin.ai-agent.import.json", workflow);
  console.log(JSON.stringify({ status: apply ? "applied" : "prepared", workflow_id: workflowId, input_only_learning_signal: true }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
