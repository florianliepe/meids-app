const REQUIRED_AGENTS = [
  "actor_twin",
  "knowledge_fabric_agent",
  "agentic_butler",
  "skill_orchestrator",
  "task_agent",
  "critical_faculty",
  "learning_agent",
];

const REQUIRED_SCENARIOS = [
  "actor_direct",
  "knowledge_retrieval",
  "conditional_critical_faculty",
  "butler_skill_task_chain",
  "learning_agent",
];

function evaluateAzureNativeNightly(artifact = {}) {
  const issues = [];
  const runId = String(artifact.run_id || "");
  const results = Array.isArray(artifact.results) ? artifact.results : [];
  const byId = new Map(results.map((result) => [String(result.id || ""), result]));
  if (!runId.startsWith("azure_native_nightly_")) issues.push("invalid_run_id");
  if (artifact.runtime !== "azure_native") issues.push("invalid_runtime");
  for (const scenario of REQUIRED_SCENARIOS) {
    const result = byId.get(scenario);
    if (!result) {
      issues.push(`missing_scenario:${scenario}`);
      continue;
    }
    if (result.status !== "completed") issues.push(`scenario_not_completed:${scenario}`);
  }

  const observedAgents = new Set(results.flatMap((result) => result.role_executions || []).map((item) => item.agent));
  for (const agent of REQUIRED_AGENTS) {
    if (!observedAgents.has(agent)) issues.push(`missing_agent:${agent}`);
  }

  for (const result of results.filter((item) => item.id !== "learning_agent")) {
    if (result.runtime !== "azure_native") issues.push(`non_native_scenario:${result.id}`);
    if (result.provider !== "azure_openai") issues.push(`unexpected_provider:${result.id}`);
    if (!result.model) issues.push(`missing_model:${result.id}`);
    if (!result.trace_id) issues.push(`missing_trace:${result.id}`);
    if (!String(result.request_id || "").startsWith(`${runId}_`)) issues.push(`stale_request:${result.id}`);
  }

  const learning = byId.get("learning_agent");
  if (learning) {
    if (learning.http_status !== 202) issues.push("learning_ack_missing");
    if (!learning.job_id) issues.push("learning_job_missing");
    if (learning.job_status !== "completed") issues.push("learning_not_terminal");
    if (learning.runtime !== "azure_native") issues.push("learning_non_native");
    if (learning.trace_id !== `${runId}_learning`) issues.push("learning_trace_mismatch");
    if (learning.persistence !== "not_persisted") issues.push("learning_persistence_not_proven");
    if (learning.result_status !== "proposed_no_write") issues.push("learning_result_not_no_write");
  }
  return { passed: issues.length === 0, issues, observed_agents: [...observedAgents] };
}

module.exports = { REQUIRED_AGENTS, REQUIRED_SCENARIOS, evaluateAzureNativeNightly };
