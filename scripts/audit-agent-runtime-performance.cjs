#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultOutput = path.join(root, "docs", "uat", "agent-runtime-performance-audit.json");

const workflows = [
  { id: process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || "eKI3qM7nyCNn9r1q", agent: "actor_twin" },
  { id: process.env.N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID || "oPs77Qzrg9Repzgp", agent: "knowledge_fabric_agent" },
  { id: process.env.N8N_AGENTIC_BUTLER_WORKFLOW_ID || "KZOqZRUAnVfFEAYJ", agent: "agentic_butler" },
  { id: process.env.N8N_SKILL_ORCHESTRATOR_WORKFLOW_ID || "8ER9laJuKS6UrQJF", agent: "skill_orchestrator" },
  { id: process.env.N8N_TASK_AGENT_WORKFLOW_ID || "YXcl8Wb68Oup3Z8n", agent: "task_agent" },
  { id: process.env.N8N_CRITICAL_FACULTY_WORKFLOW_ID || "MH1nWMs8IFyNKN1E", agent: "critical_faculty" },
  { id: process.env.N8N_LEARNING_AGENT_WORKFLOW_ID || "zX0s3hOByJ4HWQye", agent: "learning_agent" },
];

function parseArgs(argv) {
  const args = { output: defaultOutput, limit: 10, write: true, since: "", agent: "" };
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
    } else if (arg === "--agent") {
      args.agent = String(argv[index + 1] || "").trim();
      index += 1;
    } else if (arg.startsWith("--agent=")) {
      args.agent = arg.slice("--agent=".length).trim();
    } else if (arg === "--no-write") {
      args.write = false;
    }
  }
  if (args.since && Number.isNaN(Date.parse(args.since))) {
    throw new Error("--since must be an ISO-compatible timestamp.");
  }
  return args;
}

function env(name) {
  return String(process.env[name] || "").trim();
}

function promptMetrics() {
  const promptRoot = path.join(root, "prompts");
  const rows = [];
  for (const dirent of fs.readdirSync(promptRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const file = path.join(promptRoot, dirent.name, "system.md");
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    rows.push({
      agent: dirent.name.replaceAll("-", "_"),
      path: path.relative(root, file).replaceAll("\\", "/"),
      chars: text.length,
      approx_tokens: Math.ceil(text.length / 4),
    });
  }
  return rows.sort((a, b) => b.approx_tokens - a.approx_tokens);
}

async function n8nJson(endpoint) {
  const baseUrl = env("N8N_API_BASE_URL").replace(/\/+$/, "");
  const apiKey = env("N8N_API_KEY");
  if (!baseUrl || !apiKey) return null;
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: { Accept: "application/json", "X-N8N-API-KEY": apiKey },
  });
  const text = await response.text();
  if (!response.ok) {
    return { error: `${response.status}: ${text.slice(0, 400)}` };
  }
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

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function executionMetrics(limit, { since = "", agent = "" } = {}) {
  const rows = [];
  const selectedWorkflows = agent
    ? workflows.filter((workflow) => workflow.agent === agent)
    : workflows;
  if (agent && selectedWorkflows.length === 0) {
    throw new Error(`Unknown --agent '${agent}'. Expected one of: ${workflows.map((workflow) => workflow.agent).join(", ")}`);
  }
  const sinceTime = since ? new Date(since).getTime() : null;
  for (const workflow of selectedWorkflows) {
    const data = await n8nJson(`/api/v1/executions?workflowId=${encodeURIComponent(workflow.id)}&limit=${limit}`);
    if (!data || data.error) {
      rows.push({ ...workflow, status: "unavailable", error: data?.error || "N8N_API_BASE_URL or N8N_API_KEY missing" });
      continue;
    }
    const allExecutions = data.data || [];
    const executions = sinceTime
      ? allExecutions.filter((execution) => execution.startedAt && new Date(execution.startedAt).getTime() >= sinceTime)
      : allExecutions;
    const durations = executions.map(durationMs).filter((value) => Number.isFinite(value));
    rows.push({
      ...workflow,
      status: "measured",
      filtered_since: since || null,
      fetched_sample_size: allExecutions.length,
      sample_size: executions.length,
      success_count: executions.filter((item) => item.status === "success" || item.finished === true).length,
      failure_count: executions.filter((item) => item.status === "error" || item.status === "crashed" || item.status === "failed").length,
      avg_ms: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
      p50_ms: percentile(durations, 50),
      p90_ms: percentile(durations, 90),
      max_ms: durations.length ? Math.max(...durations) : null,
    });
  }
  return rows;
}

function recommendations(promptRows, executionRows) {
  const items = [];
  const slow = executionRows.filter((row) => Number(row.p90_ms) > 90000);
  if (slow.length) {
    items.push("Nested n8n agent calls exceed 90s p90. Keep default tool chains to one subagent call unless the user asks for deeper decomposition.");
  }
  const largePrompt = promptRows.filter((row) => row.approx_tokens > 1800);
  if (largePrompt.length) {
    items.push("Prompts above 1800 approximate tokens should be split into core instruction plus optional reference, or compressed before production.");
  }
  items.push("Keep Actor Twin as the only frontend chat and avoid exposing subagent conversations in the UI.");
  items.push("Use backend proxy for production to avoid browser-to-n8n latency/security coupling and to persist traces durably.");
  return items;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prompts = promptMetrics();
  const executions = await executionMetrics(args.limit, { since: args.since, agent: args.agent });
  const artifact = {
    schema_version: "0.1.0",
    generated_at: new Date().toISOString(),
    scope: "Agent prompt size and n8n execution duration audit. No secrets are stored.",
    filters: {
      since: args.since || null,
      agent: args.agent || null,
      limit: args.limit,
    },
    prompt_metrics: prompts,
    execution_metrics: executions,
    recommendations: recommendations(prompts, executions),
  };
  if (args.write) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({
    status: "completed",
    output: path.relative(root, args.output).replaceAll("\\", "/"),
    prompt_count: prompts.length,
    measured_workflow_count: executions.filter((item) => item.status === "measured").length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
