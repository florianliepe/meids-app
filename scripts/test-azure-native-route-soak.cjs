const assert = require("node:assert/strict");
const test = require("node:test");
const { appendWindow, percentile, summarizeRoute, summarizeWindows } = require("./lib/azure-native-route-soak.cjs");
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
  assert.equal(summary.latency_sample_size, 10);
  assert.equal(summary.latency_population, "all_observed_results");
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

test("multi-window maturity requires three unique windows and one hundred samples per route", () => {
  const results = (count) => Array.from({ length: count }, () => ({ route_id: "direct", status: "completed", duration_ms: 50 }));
  const candidate = { capacity_cohort: "50rpm-50ktpm" };
  const first = { run_id: "window-1", generated_at: "2026-11-12T20:00:00Z", candidate, results: results(10) };
  const second = { run_id: "window-2", generated_at: "2026-11-13T08:00:00Z", candidate, results: results(45) };
  const third = { run_id: "window-3", generated_at: "2026-11-14T08:00:00Z", candidate, results: results(45) };
  const twoWindows = summarizeWindows([first, second], { direct: target });
  assert.equal(twoWindows.status, "observation_in_progress");
  assert.deepEqual(twoWindows.issues, ["insufficient_windows", "insufficient_route_samples", "availability_policy_not_defined"]);
  const mature = summarizeWindows([first, second, third], { direct: target }, { availabilityMinimumSuccessRate: 1 });
  assert.equal(mature.status, "passed");
  assert.equal(mature.sampling_status, "passed");
  assert.equal(mature.availability_status, "passed");
  assert.equal(mature.window_count, 3);
  assert.equal(mature.routes[0].sample_size, 100);
  assert.equal(mature.routes[0].sample_maturity, "target");
});

test("window history is deduplicated and keeps failed results in the aggregate", () => {
  const candidate = { capacity_cohort: "50rpm-50ktpm" };
  const first = { run_id: "window-1", generated_at: "2026-11-12T20:00:00Z", candidate, results: Array.from({ length: 100 }, () => ({ route_id: "direct", status: "completed", duration_ms: 50 })) };
  const failed = { run_id: "window-2", generated_at: "2026-11-13T08:00:00Z", candidate, results: [{ route_id: "direct", status: "timeout", duration_ms: 250 }] };
  let windows = appendWindow([], first);
  windows = appendWindow(windows, first);
  windows = appendWindow(windows, failed);
  assert.equal(windows.length, 2);
  const aggregate = summarizeWindows([...windows, { run_id: "window-3", generated_at: "2026-11-14T08:00:00Z", candidate, results: [] }], { direct: target });
  assert.equal(aggregate.status, "observation_in_progress");
  assert.equal(aggregate.routes[0].sample_size, 101);
  assert.equal(aggregate.routes[0].counts.timeout, 1);
  assert.equal(aggregate.availability_status, "policy_not_defined");
  assert.ok(aggregate.routes[0].issues.includes("non_success_result"));
});

test("conflicting duplicate run ids fail closed without replacing original samples", () => {
  const candidate = { capacity_cohort: "50rpm-50ktpm", backend_revision: "abc123" };
  const original = {
    run_id: "window-1",
    generated_at: "2026-11-12T20:00:00Z",
    candidate,
    results: [
      { route_id: "direct", status: "failed", duration_ms: 250 },
      { route_id: "retrieval", status: "completed", duration_ms: 80 },
    ],
  };
  const exactDuplicate = JSON.parse(JSON.stringify(original));
  const conflicting = {
    ...JSON.parse(JSON.stringify(original)),
    candidate: { ...candidate, backend_revision: "def456" },
    results: [
      { route_id: "direct", status: "completed", duration_ms: 50 },
      { route_id: "retrieval", status: "completed", duration_ms: 70 },
    ],
  };
  let windows = appendWindow([], original);
  windows = appendWindow(windows, exactDuplicate);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].integrity, undefined);
  windows = appendWindow(windows, conflicting);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].integrity.status, "conflict");
  assert.equal(windows[0].results[0].status, "failed", "Conflicting success must not replace the original failed sample");

  const aggregate = summarizeWindows(windows, { direct: target, retrieval: target }, { minimumWindows: 1, targetSamples: 1, availabilityMinimumSuccessRate: 0.5 });
  assert.equal(aggregate.status, "observation_in_progress");
  assert.equal(aggregate.sampling_status, "observation_in_progress");
  assert.deepEqual(aggregate.conflicting_run_ids, ["window-1"]);
  assert.ok(aggregate.issues.includes("conflicting_run_id"));
  assert.equal(aggregate.routes.find((route) => route.route === "direct").counts.failed, 1);
  assert.equal(aggregate.routes.find((route) => route.route === "retrieval").sample_size, 1, "Distinct routes within one run must remain separate samples");
});

test("an unmarked capacity cohort can never satisfy maturity", () => {
  const windows = [1, 2, 3].map((index) => ({
    run_id: `window-${index}`,
    generated_at: `2026-11-${11 + index}T08:00:00Z`,
    candidate: { capacity_cohort: index === 3 ? "unspecified" : "50rpm-50ktpm" },
    results: Array.from({ length: 34 }, () => ({ route_id: "direct", status: "completed", duration_ms: 50 })),
  }));
  const aggregate = summarizeWindows(windows, { direct: target });
  assert.equal(aggregate.status, "observation_in_progress");
  assert.ok(aggregate.issues.includes("unmarked_capacity_cohort"));
});

test("sampling maturity can pass while availability remains unevaluated", () => {
  const candidate = { capacity_cohort: "50rpm-50ktpm" };
  const windows = [34, 33, 33].map((count, index) => ({
    run_id: `window-${index + 1}`,
    generated_at: `2026-11-${12 + index}T08:00:00Z`,
    candidate,
    results: Array.from({ length: count }, () => ({ route_id: "direct", status: "completed", duration_ms: 50 })),
  }));
  const aggregate = summarizeWindows(windows, { direct: target });
  assert.equal(aggregate.status, "observation_in_progress");
  assert.equal(aggregate.sampling_status, "passed");
  assert.equal(aggregate.availability_status, "policy_not_defined");
  assert.deepEqual(aggregate.issues, ["availability_policy_not_defined"]);
});

test("a governed retrieval unavailable response remains a failed functional outcome", () => {
  const source = fs.readFileSync(path.join(__dirname, "run-azure-native-route-soak.cjs"), "utf8");
  assert.match(source, /response\.status === "completed"/);
  assert.match(source, /functional_status: String\(response\.status/);
  assert.match(source, /error_code: String\(response\.output\?\.error_code/);
  assert.match(source, /search_retry_count: Number\(response\.trace\?\.search_retry_count/);
});
