const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateN8nEgressReadiness } = require("./lib/n8n-egress-verdict.cjs");

function healthy(overrides = {}) {
  return {
    coverageHours: 168,
    minimumHours: 168,
    coverageStartDelayHours: 0,
    ingestionLagHours: 0.1,
    hourBuckets: 169,
    requiredHourBuckets: 169,
    httpDependencies: 10,
    searchCalls: 5,
    positiveControls: 100,
    roleInstances: 1,
    configuredWorkers: 1,
    sampledDependencies: 0,
    unknownHttpDependencies: 0,
    workflowChecked: true,
    workflowInventoryComplete: true,
    runtimeBoundaryHealthy: true,
    browserClean: true,
    n8nCalls: 0,
    n8nWorkflowExecutions: 0,
    ...overrides,
  };
}

test("the 168-hour boundary does not round an incomplete window up", () => {
  assert.equal(evaluateN8nEgressReadiness(healthy({ coverageHours: 167.999 })).status, "observation_in_progress");
  assert.equal(evaluateN8nEgressReadiness(healthy()).status, "passed");
});

test("late, stale, gapped, or sampled telemetry fails closed", () => {
  for (const input of [
    { coverageStartDelayHours: 4 },
    { ingestionLagHours: 6 },
    { hourBuckets: 168 },
    { sampledDependencies: 1 },
  ]) assert.equal(evaluateN8nEgressReadiness(healthy(input)).status, "insufficient_telemetry");
});

test("global traffic cannot hide an uncovered worker or missing HTTP control", () => {
  assert.equal(evaluateN8nEgressReadiness(healthy({ roleInstances: 1, configuredWorkers: 2 })).status, "insufficient_telemetry");
  assert.equal(evaluateN8nEgressReadiness(healthy({ httpDependencies: 0, positiveControls: 1000 })).status, "insufficient_telemetry");
});

test("unknown HTTP, incomplete workflow inventory, runtime drift, and browser exposure block retirement", () => {
  for (const input of [
    { unknownHttpDependencies: 1 },
    { workflowInventoryComplete: false },
    { runtimeBoundaryHealthy: false },
    { browserClean: false },
  ]) assert.equal(evaluateN8nEgressReadiness(healthy(input)).status, "insufficient_telemetry");
});

test("any n8n dependency or workflow execution is a failure even with incomplete telemetry", () => {
  assert.equal(evaluateN8nEgressReadiness(healthy({ n8nCalls: 1, ingestionLagHours: 8 })).status, "failed");
  assert.equal(evaluateN8nEgressReadiness(healthy({ n8nWorkflowExecutions: 1 })).status, "failed");
});
