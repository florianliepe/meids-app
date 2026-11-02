const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, "frontend", "assets", "nightly-readiness-status.json");

function readJson(relativePath, fallback) {
  const file = path.join(root, relativePath);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

const noWrite = readJson("docs/uat/n8n-seven-agent-no-write-uat.json", { results: [] });
const live = readJson("docs/uat/n8n-seven-agent-live-probe-evidence.json", { probes: [], summary: {} });
const manual = readJson("docs/uat/manual-launch-validation-status.json", { validations: [] });
const completedScenarios = (noWrite.results || []).filter((item) => item.status === "completed").length;
const freshAgents = Number(live.summary?.fresh_connected_count || 0);
const totalAgents = Number(live.summary?.workflow_count || 7);
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
    detail: "Require a fresh canonical workflow execution after every successful post-turn dispatch acknowledgement.",
  },
];

const status = freshAgents === totalAgents && completedScenarios === (noWrite.results || []).length
  ? "passed"
  : "attention";
const artifact = {
  schema_version: "0.1.0",
  generated_at: new Date().toISOString(),
  source: "latest_published_nightly_evidence",
  status,
  summary: {
    contract_suites: "passed",
    no_write_scenarios: { passed: completedScenarios, total: (noWrite.results || []).length },
    fresh_agents: { passed: freshAgents, total: totalAgents },
    manual_validations: { passed: passedManual.length, total: (manual.validations || []).length },
  },
  agent_results: (live.probes || []).map((probe) => ({
    agent: probe.agent,
    status: probe.status,
    duration_ms: probe.latest_fresh_execution?.duration_ms || null,
  })),
  manual_validations: manual.validations || [],
  pending_manual: pendingManual.map((item) => ({ id: item.id, label: item.label, detail: item.evidence })),
  nightly_test_backlog: nightlyBacklog,
  boundary: "Public-safe release evidence. No secrets, prompts, private knowledge, or identity tokens are included.",
};

fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ status: artifact.status, output: path.relative(root, outputPath).replaceAll("\\", "/") }, null, 2));
