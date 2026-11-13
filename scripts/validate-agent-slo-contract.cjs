const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { classifyAgentInteraction } = require("../backend/agentRoutingPolicy");
const { SLO_VERSION, ROUTE_AVAILABILITY_POLICY, ROUTE_AVAILABILITY_POLICY_SHA256, ROUTE_AVAILABILITY_MIN_SUCCESS_RATE, WORKFLOW_SLOS, ROUTE_SLOS, QUEUE_SLOS, evaluateWorkflowSlo } = require("../backend/agentSloPolicy");

assert.equal(SLO_VERSION, "meids.agent-slo.v1");
assert.equal(ROUTE_AVAILABILITY_MIN_SUCCESS_RATE, 0.99);
assert.deepEqual(ROUTE_AVAILABILITY_POLICY, {
  contract: "meids.agent-route-availability.v1",
  minimum_success_rate: 0.99,
  effective_at: "2026-11-14T00:00:00.000Z",
  time_basis: "window.start_at",
  eligibility_boundary: "start_at_gte_effective_at",
  minimum_windows_per_route: 3,
  target_samples_per_route: 100,
  functional_success: "status_completed",
  denominator: "all_eligible_results_per_route",
  rounding: "none",
  required_routes: ["answer_direct", "retrieve_knowledge", "execute_work_sync", "execute_work_async_ack", "detached_learning"],
});
assert.match(ROUTE_AVAILABILITY_POLICY_SHA256, /^[a-f0-9]{64}$/);
assert.equal(ROUTE_AVAILABILITY_POLICY_SHA256, crypto.createHash("sha256").update(JSON.stringify(ROUTE_AVAILABILITY_POLICY)).digest("hex"));
assert.equal(classifyAgentInteraction({ message: "Hello" }).budgets.response_ms, 8_000);
assert.equal(classifyAgentInteraction({ message: "Show reviewed evidence about my profile" }).budgets.response_ms, 12_000);
assert.equal(classifyAgentInteraction({ message: "Draft a concise note" }).budgets.response_ms, 20_000);
assert.equal(classifyAgentInteraction({ message: "Research and compare options, then prepare a recommendation" }).budgets.response_ms, 3_000);
assert.equal(QUEUE_SLOS.queued_age_warning_ms, 30_000);
assert.equal(QUEUE_SLOS.queued_age_critical_ms, 90_000);
assert.equal(WORKFLOW_SLOS.agentic_butler.p90_warning_ms, 90_000);
assert.equal(WORKFLOW_SLOS.agentic_butler.p90_critical_ms, 120_000);
assert.equal(ROUTE_SLOS.answer_direct.p90_critical_ms, 20_000);
assert.equal(evaluateWorkflowSlo("actor_twin", { sample_size: 10, p50_ms: 10_000, p90_ms: 20_000 }).status, "met");
assert.equal(evaluateWorkflowSlo("actor_twin", { sample_size: 10, p50_ms: 25_000, p90_ms: 100_000 }).status, "warning");
assert.equal(evaluateWorkflowSlo("actor_twin", { sample_size: 10, p50_ms: 25_000, p90_ms: 130_000 }).status, "critical");
assert.equal(evaluateWorkflowSlo("actor_twin", { sample_size: 3, p50_ms: 1, p90_ms: 1 }).status, "insufficient_samples");
assert.equal(evaluateWorkflowSlo("actor_twin", { sample_size: 10, p50_ms: null, p90_ms: null }).status, "incomplete_metrics");
assert.equal(evaluateWorkflowSlo("actor_twin", { sample_size: 10, p50_ms: -1, p90_ms: 100 }).status, "incomplete_metrics");
assert.equal(evaluateWorkflowSlo("actor_twin", { sample_size: 10, p50_ms: "", p90_ms: "" }).status, "incomplete_metrics");
assert.equal(evaluateWorkflowSlo("actor_twin", { sample_size: 10, p50_ms: 100, p90_ms: 99 }).status, "incomplete_metrics");
assert.equal(evaluateWorkflowSlo("actor_twin", { sample_size: "10", p50_ms: 10, p90_ms: 20 }).status, "incomplete_metrics");

console.log(JSON.stringify({ status: "passed", contract: SLO_VERSION, route_availability_minimum_success_rate: ROUTE_AVAILABILITY_MIN_SUCCESS_RATE, route_slos: ROUTE_SLOS, queue_slos: QUEUE_SLOS }, null, 2));
