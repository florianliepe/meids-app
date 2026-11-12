const assert = require("node:assert/strict");
const test = require("node:test");
const { percentile, summarizeRoute } = require("./lib/azure-native-route-soak.cjs");
const fs = require("node:fs");
const path = require("node:path");

const target = { p90_warning_ms: 100, p90_critical_ms: 200 };

test("nearest-rank percentiles are deterministic", () => {
  assert.equal(percentile([10, 20, 30, 40, 50], 50), 30);
  assert.equal(percentile([10, 20, 30, 40, 50], 90), 50);
});

test("failures remain in the denominator and duration percentile", () => {
  const results = Array.from({ length: 9 }, (_, index) => ({ route_id: "direct", status: "completed", duration_ms: 10 + index }));
  results.push({ route_id: "direct", status: "timeout", duration_ms: 250 });
  const summary = summarizeRoute("direct", results, target);
  assert.equal(summary.sample_size, 10);
  assert.equal(summary.counts.completed, 9);
  assert.equal(summary.counts.timeout, 1);
  assert.equal(summary.success_rate, 0.9);
  assert.equal(summary.p90_ms, 18);
  assert.equal(summary.max_ms, 250);
  assert.equal(summary.status, "failed");
  assert.ok(summary.issues.includes("non_success_result"));
});

test("missing durations fail closed", () => {
  const results = Array.from({ length: 10 }, () => ({ route_id: "direct", status: "completed", duration_ms: 10 }));
  delete results[3].duration_ms;
  const summary = summarizeRoute("direct", results, target);
  assert.equal(summary.p90_ms, null);
  assert.equal(summary.status, "failed");
  assert.ok(summary.issues.includes("incomplete_duration_metrics"));
});

test("ten clean samples pass provisionally while one hundred reach target maturity", () => {
  const ten = Array.from({ length: 10 }, () => ({ route_id: "direct", status: "completed", duration_ms: 50 }));
  assert.equal(summarizeRoute("direct", ten, target).sample_maturity, "provisional");
  const hundred = Array.from({ length: 100 }, () => ({ route_id: "direct", status: "completed", duration_ms: 50 }));
  assert.equal(summarizeRoute("direct", hundred, target).sample_maturity, "target");
  assert.equal(summarizeRoute("direct", hundred, target).status, "passed");
});

test("the live soak uses the established trusted no-write override boundary", () => {
  const source = fs.readFileSync(path.join(__dirname, "run-azure-native-route-soak.cjs"), "utf8");
  assert.match(source, /source: "run-seven-agent-no-write-uat", probe_suite: "azure-native-route-soak"/);
  assert.match(source, /side_effect_policy: "no_write_probe"/);
});
