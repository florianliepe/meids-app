const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateN8nEgressReadiness } = require("./lib/n8n-egress-verdict.cjs");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("Admin timeline distinguishes the fixed window, telemetry and publication timestamps", () => {
  const source = fs.readFileSync(path.join(__dirname, "../frontend/admin/admin.js"), "utf8");
  const helper = source.slice(source.indexOf("  function egressTimeline("), source.indexOf("  function hasAdminAccess("));
  const context = vm.createContext({});
  vm.runInContext(helper, context);
  const evidence = JSON.parse(fs.readFileSync(path.join(__dirname, "../frontend/assets/n8n-egress-readiness-status.json"), "utf8"));
  const fixture = { ...evidence, observation_started_at: "2026-11-13T09:23:26.551Z", required_observation_hours: 168,
    coverage: { end: "2026-11-13T10:11:08.704Z" }, generated_at: "2026-11-13T10:11:35.142Z" };
  const result = context.egressTimeline(fixture);
  assert.match(result, /Current window start: 2026-11-13 09:23:26.551 UTC/);
  assert.match(result, /Telemetry through: 2026-11-13 10:11:08.704 UTC/);
  assert.match(result, /Snapshot published: 2026-11-13 10:11:35.142 UTC/);
  assert.match(result, /Earliest possible window completion: 2026-11-20 09:23:26.551 UTC/);
  assert.match(result, /not a live counter/);
  assert.equal(context.egressTimeline(null), "");
  assert.match(context.egressTimeline({ observation_started_at: "invalid" }), /Unavailable/);
  const later = context.egressTimeline({ ...fixture, generated_at: "2026-11-14T10:11:35.142Z" });
  assert.match(later, /Current window start: 2026-11-13 09:23:26.551 UTC/);
  assert.match(later, /Telemetry through: 2026-11-13 10:11:08.704 UTC/);
});

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
