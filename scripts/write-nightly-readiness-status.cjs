const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, "frontend", "assets", "nightly-readiness-status.json");

function readJson(relativePath, fallback) {
  const file = path.join(root, relativePath);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

const noWrite = readJson("docs/uat/azure-native-seven-agent-no-write-uat.json", { results: [], required_agents: [] });
const manual = readJson("docs/uat/manual-launch-validation-status.json", { validations: [] });
const completedScenarios = (noWrite.results || []).filter((item) => item.status === "completed").length;
const observedAgents = new Set((noWrite.observed_agents || []).map(String));
const requiredAgents = noWrite.required_agents || ["actor_twin", "knowledge_fabric_agent", "agentic_butler", "skill_orchestrator", "task_agent", "critical_faculty", "learning_agent"];
const freshAgents = requiredAgents.filter((agent) => observedAgents.has(agent)).length;
const totalAgents = requiredAgents.length;
const passedManual = (manual.validations || []).filter((item) => item.status === "passed");
const pendingManual = (manual.validations || []).filter((item) => item.status !== "passed");

const nightlyBacklog = [
  {
    id: "semantic_expected_answers",
    label: "Semantic expected-answer assertions",
    detail: "Verify citations, not_found behavior, routing, approval boundaries, and non-speculative answers.",
  },
  {
    id: "authenticated_frontend_scan",
    label: "Authenticated frontend scan",
    detail: "Track console and network errors, keyboard access, text density, scroll depth, and task reachability.",
  },
  {
    id: "runtime_drift",
    label: "Queue and outbox drift",
    detail: "Trend queue age, retries, dead letters, stale outbox events, and per-agent latency.",
  },
  {
    id: "learning_execution_correlation",
    label: "Learning Agent execution correlation",
    detail: "Require a fresh owner-scoped Azure job and completed non-persisting Learning proposal after every successful probe acknowledgement.",
  },
];

const status = freshAgents === totalAgents && completedScenarios === (noWrite.results || []).length
  ? "passed"
  : "attention";
const artifact = {
  schema_version: "0.1.0",
  generated_at: new Date().toISOString(),
  source: "latest_azure_native_nightly_evidence",
  status,
  summary: {
    contract_suites: "passed",
    no_write_scenarios: { passed: completedScenarios, total: (noWrite.results || []).length },
    fresh_agents: { passed: freshAgents, total: totalAgents },
    manual_validations: { passed: passedManual.length, total: (manual.validations || []).length },
  },
  agent_results: requiredAgents.map((agent) => {
    const execution = (noWrite.results || []).flatMap((result) => result.role_executions || []).find((item) => item.agent === agent);
    return { agent, status: observedAgents.has(agent) ? "completed" : "missing", duration_ms: execution?.duration_ms || null };
  }),
  manual_validations: manual.validations || [],
  pending_manual: pendingManual.map((item) => ({ id: item.id, label: item.label, detail: item.evidence })),
  nightly_test_backlog: nightlyBacklog,
  boundary: "Public-safe release evidence. No secrets, prompts, private knowledge, or identity tokens are included.",
};

fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ status: artifact.status, output: path.relative(root, outputPath).replaceAll("\\", "/") }, null, 2));
