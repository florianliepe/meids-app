const test = require("node:test");
const assert = require("node:assert/strict");
const { REQUIRED_AGENTS, evaluateAzureNativeNightly } = require("./lib/azure-native-nightly-verdict.cjs");

function passingArtifact() {
  const runId = "azure_native_nightly_20261112T190000";
  return {
    run_id: runId,
    runtime: "azure_native",
    results: [
      { id: "actor_direct", status: "completed", runtime: "azure_native", provider: "azure_openai", model: "model", trace_id: "trace-a", request_id: `${runId}_actor_direct`, role_executions: [{ agent: "actor_twin" }] },
      { id: "knowledge_retrieval", status: "completed", runtime: "azure_native", provider: "azure_openai", model: "model", trace_id: "trace-k", request_id: `${runId}_knowledge_retrieval`, role_executions: [{ agent: "knowledge_fabric_agent" }] },
      { id: "conditional_critical_faculty", status: "completed", runtime: "azure_native", provider: "azure_openai", model: "model", trace_id: "trace-c", request_id: `${runId}_conditional_critical_faculty`, role_executions: [{ agent: "agentic_butler" }, { agent: "critical_faculty" }] },
      { id: "butler_skill_task_chain", status: "completed", runtime: "azure_native", provider: "azure_openai", model: "model", trace_id: "trace-b", request_id: `${runId}_butler_skill_task_chain`, role_executions: [{ agent: "skill_orchestrator" }, { agent: "task_agent" }] },
      { id: "learning_agent", status: "completed", runtime: "azure_native", http_status: 202, job_id: "job-1", job_status: "completed", trace_id: `${runId}_learning`, persistence: "not_persisted", result_status: "proposed_no_write", role_executions: [{ agent: "learning_agent" }] },
    ],
  };
}

test("complete fresh Azure-native evidence passes", () => {
  const verdict = evaluateAzureNativeNightly(passingArtifact());
  assert.equal(verdict.passed, true);
  assert.deepEqual(new Set(verdict.observed_agents), new Set(REQUIRED_AGENTS));
});

for (const [name, mutate, expected] of [
  ["202 without completion", (a) => { a.results.at(-1).job_status = "queued"; }, "learning_not_terminal"],
  ["failed Learning", (a) => { a.results.at(-1).status = "failed"; }, "scenario_not_completed:learning_agent"],
  ["stale request", (a) => { a.results[0].request_id = "older_run_actor"; }, "stale_request:actor_direct"],
  ["missing role span", (a) => { a.results[3].role_executions = []; }, "missing_agent:skill_orchestrator"],
  ["wrong provider", (a) => { a.results[1].provider = "n8n"; }, "unexpected_provider:knowledge_retrieval"],
  ["foreign trace correlation", (a) => { a.results.at(-1).trace_id = "another_run_learning"; }, "learning_trace_mismatch"],
  ["persisted dry run", (a) => { a.results.at(-1).persistence = "review_needed"; }, "learning_persistence_not_proven"],
]) {
  test(`${name} fails closed`, () => {
    const artifact = passingArtifact();
    mutate(artifact);
    const verdict = evaluateAzureNativeNightly(artifact);
    assert.equal(verdict.passed, false);
    assert.ok(verdict.issues.includes(expected));
  });
}
