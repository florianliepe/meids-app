#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultOutput = path.join(root, "docs", "uat", "n8n-seven-agent-live-probe-evidence.json");

const workflows = [
  { id: process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || "eKI3qM7nyCNn9r1q", agent: "actor_twin", label: "Actor Twin" },
  { id: process.env.N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID || "7Ci86PxXipwvYpKv", agent: "knowledge_fabric_agent", label: "Knowledge Fabric Agent" },
  { id: process.env.N8N_AGENTIC_BUTLER_WORKFLOW_ID || "KZOqZRUAnVfFEAYJ", agent: "agentic_butler", label: "Agentic Butler" },
  { id: process.env.N8N_SKILL_ORCHESTRATOR_WORKFLOW_ID || "8ER9laJuKS6UrQJF", agent: "skill_orchestrator", label: "Skill Orchestrator" },
  { id: process.env.N8N_TASK_AGENT_WORKFLOW_ID || "YXcl8Wb68Oup3Z8n", agent: "task_agent", label: "Task Agent" },
  { id: process.env.N8N_CRITICAL_FACULTY_WORKFLOW_ID || "MH1nWMs8IFyNKN1E", agent: "critical_faculty", label: "Critical Faculty Agent" },
  { id: process.env.N8N_LEARNING_AGENT_WORKFLOW_ID || "zX0s3hOByJ4HWQye", agent: "learning_agent", label: "Learning Agent" },
];

function parseArgs(argv) {
  const args = { output: defaultOutput, limit: 20, since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") {
      args.output = path.resolve(root, argv[index + 1] || "");
      index += 1;
    } else if (arg.startsWith("--output=")) {
      args.output = path.resolve(root, arg.slice("--output=".length));
    } else if (arg === "--limit") {
      args.limit = Number(argv[index + 1] || args.limit);
      index += 1;
    } else if (arg.startsWith("--limit=")) {
      args.limit = Number(arg.slice("--limit=".length));
    } else if (arg === "--since") {
      args.since = String(argv[index + 1] || "").trim();
      index += 1;
    } else if (arg.startsWith("--since=")) {
      args.since = arg.slice("--since=".length).trim();
    }
  }
  if (!args.since || Number.isNaN(Date.parse(args.since))) {
    throw new Error("--since must be an ISO-compatible timestamp.");
  }
  if (!Number.isFinite(args.limit) || args.limit < 1) args.limit = 20;
  return args;
}

function env(name) {
  return String(process.env[name] || "").trim();
}

async function n8nJson(endpoint) {
  const baseUrl = env("N8N_API_BASE_URL").replace(/\/+$/, "");
  const apiKey = env("N8N_API_KEY");
  if (!baseUrl || !apiKey) {
    return { error: "N8N_API_BASE_URL or N8N_API_KEY missing" };
  }
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: { Accept: "application/json", "X-N8N-API-KEY": apiKey },
  });
  const text = await response.text();
  if (!response.ok) return { error: `${response.status}: ${text.slice(0, 400)}` };
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text.slice(0, 400) };
  }
}

function durationMs(execution) {
  if (!execution.startedAt || !execution.stoppedAt) return null;
  return new Date(execution.stoppedAt).getTime() - new Date(execution.startedAt).getTime();
}

function executionSucceeded(execution) {
  return execution.status === "success" || execution.finished === true;
}

function summarizeExecution(execution) {
  if (!execution) return null;
  return {
    id: execution.id,
    status: execution.status || (execution.finished ? "success" : "unknown"),
    finished: Boolean(execution.finished),
    started_at: execution.startedAt || "",
    stopped_at: execution.stoppedAt || "",
    duration_ms: durationMs(execution),
  };
}

async function workflowProbe(workflow, args) {
  const data = await n8nJson(`/api/v1/executions?workflowId=${encodeURIComponent(workflow.id)}&limit=${args.limit}`);
  if (!data || data.error) {
    return {
      ...workflow,
      status: "unavailable",
      fresh_success: false,
      error: data?.error || "Unknown n8n API error",
    };
  }
  const sinceMs = new Date(args.since).getTime();
  const executions = Array.isArray(data.data) ? data.data : [];
  const freshExecutions = executions.filter((execution) => execution.startedAt && new Date(execution.startedAt).getTime() >= sinceMs);
  const latestFresh = freshExecutions[0] || null;
  const latestAny = executions[0] || null;
  return {
    ...workflow,
    status: latestFresh ? (executionSucceeded(latestFresh) ? "fresh_connected" : "fresh_failed") : "stale_or_missing",
    fresh_success: latestFresh ? executionSucceeded(latestFresh) : false,
    fetched_sample_size: executions.length,
    fresh_sample_size: freshExecutions.length,
    latest_fresh_execution: summarizeExecution(latestFresh),
    latest_available_execution: summarizeExecution(latestAny),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const probes = [];
  for (const workflow of workflows) probes.push(await workflowProbe(workflow, args));
  const freshConnected = probes.filter((probe) => probe.status === "fresh_connected").length;
  const artifact = {
    schema_version: "0.1.0",
    generated_at: new Date().toISOString(),
    scope: "Public-safe n8n live execution evidence for Actor Twin and six workflow-tool subagents. No secrets are stored.",
    freshness_since: new Date(args.since).toISOString(),
    status: freshConnected === workflows.length ? "complete" : "partial",
    summary: {
      workflow_count: workflows.length,
      fresh_connected_count: freshConnected,
      stale_or_failed_agents: probes
        .filter((probe) => probe.status !== "fresh_connected")
        .map((probe) => probe.agent),
    },
    probes,
  };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    status: artifact.status,
    output: path.relative(root, args.output).replaceAll("\\", "/"),
    fresh_connected: `${freshConnected}/${workflows.length}`,
    stale_or_failed_agents: artifact.summary.stale_or_failed_agents,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
