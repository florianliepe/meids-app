const assert = require("node:assert/strict");
const { classifyAgentInteraction } = require("../backend/agentRoutingPolicy");
const { SLO_VERSION, WORKFLOW_SLOS, ROUTE_SLOS, QUEUE_SLOS, evaluateWorkflowSlo } = require("../backend/agentSloPolicy");

assert.equal(SLO_VERSION, "meids.agent-slo.v1");
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

console.log(JSON.stringify({ status: "passed", contract: SLO_VERSION, route_slos: ROUTE_SLOS, queue_slos: QUEUE_SLOS }, null, 2));
