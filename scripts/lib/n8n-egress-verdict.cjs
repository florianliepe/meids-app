function evaluateN8nEgressReadiness(input) {
  const evidenceIssues = [];
  if (input.coverageStartDelayHours > 1) evidenceIssues.push("coverage_started_late");
  if (input.ingestionLagHours > 1) evidenceIssues.push("telemetry_stale");
  if (input.hourBuckets < input.requiredHourBuckets) evidenceIssues.push("hourly_coverage_gap");
  if (input.httpDependencies < 1 || input.searchCalls < 1 || input.positiveControls < 1) evidenceIssues.push("missing_http_positive_control");
  if (input.roleInstances < input.configuredWorkers) evidenceIssues.push("worker_instance_coverage_gap");
  if (input.sampledDependencies > 0) evidenceIssues.push("dependency_sampling_detected");
  if (input.unknownHttpDependencies > 0) evidenceIssues.push("unknown_http_target_detected");
  if (!input.workflowChecked) evidenceIssues.push("n8n_workflow_inventory_unavailable");
  if (!input.workflowInventoryComplete) evidenceIssues.push("n8n_workflow_inventory_incomplete");
  if (!input.runtimeBoundaryHealthy) evidenceIssues.push("azure_native_runtime_boundary_drift");
  if (!input.browserClean) evidenceIssues.push("browser_n8n_endpoint_exposed");

  const n8nObserved = input.n8nCalls > 0 || input.n8nWorkflowExecutions > 0;
  const status = n8nObserved
    ? "failed"
    : evidenceIssues.length
      ? "insufficient_telemetry"
      : input.coverageHours >= input.minimumHours ? "passed" : "observation_in_progress";
  return { status, evidence_issues: evidenceIssues, zero_n8n_observed: !n8nObserved };
}

module.exports = { evaluateN8nEgressReadiness };
