const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { appendWindow, percentile, summarizeRoute, summarizeWindows } = require("./lib/azure-native-route-soak.cjs");
const fs = require("node:fs");
const path = require("node:path");

const target = { p90_warning_ms: 100, p90_critical_ms: 200 };

function availabilityPolicy(effectiveAt = "2026-11-14T00:00:00Z", overrides = {}) {
  const definition = { contract: "test.availability.v1", minimum_success_rate: 0.99, effective_at: effectiveAt, ...overrides };
  return { ...definition, config_sha256: crypto.createHash("sha256").update(JSON.stringify(definition)).digest("hex") };
}

function governedWindow(window, policy, startAt = window.generated_at) {
  return { ...window, availability_policy: policy, window: { ...(window.window || {}), start_at: startAt } };
}

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
  const policy = availabilityPolicy("2026-11-12T00:00:00Z", { minimum_success_rate: 1 });
  const mature = summarizeWindows([first, second, third].map((window) => governedWindow(window, policy)), { direct: target }, { availabilityPolicy: policy });
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

  const aggregate = summarizeWindows(windows, { direct: target, retrieval: target }, { minimumWindows: 1, targetSamples: 1, availabilityPolicy: { minimum_success_rate: 0.5, effective_at: "2026-11-12T00:00:00Z" } });
  assert.equal(aggregate.status, "observation_in_progress");
  assert.equal(aggregate.sampling_status, "observation_in_progress");
  assert.deepEqual(aggregate.conflicting_run_ids, ["window-1"]);
  assert.deepEqual(aggregate.excluded_windows, [{ run_id: "window-1", reasons: ["conflicting_run_id"] }]);
  assert.equal(aggregate.routes.find((route) => route.route === "direct").sample_size, 0);
  assert.equal(aggregate.routes.find((route) => route.route === "retrieval").sample_size, 0);
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
  assert.equal(aggregate.window_count, 2);
  assert.deepEqual(aggregate.excluded_windows, [{ run_id: "window-3", reasons: ["unmarked_capacity_cohort"] }]);
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

test("historical windows cannot satisfy a prospective availability policy", () => {
  const candidate = { capacity_cohort: "50rpm-50ktpm" };
  const windows = [34, 33, 33].map((count, index) => ({
    run_id: `window-${index + 1}`,
    generated_at: `2026-11-${11 + index}T08:00:00Z`,
    candidate,
    results: Array.from({ length: count }, () => ({ route_id: "direct", status: "completed", duration_ms: 50 })),
  }));
  const policy = availabilityPolicy();
  const aggregate = summarizeWindows(windows.map((window) => governedWindow(window, policy)), { direct: target }, { availabilityPolicy: policy });
  assert.equal(aggregate.sampling_status, "passed");
  assert.equal(aggregate.availability_status, "not_evaluated");
  assert.equal(aggregate.availability_window_count, 0);
  assert.equal(aggregate.availability_routes[0].sample_size, 0);
  assert.ok(aggregate.issues.includes("availability_observation_incomplete"));
});

test("availability uses immutable window start time with an inclusive UTC boundary", () => {
  const policy = availabilityPolicy();
  const result = [{ route_id: "direct", status: "completed", duration_ms: 50 }];
  const windows = [
    governedWindow({ run_id: "before", generated_at: "2026-11-20T00:00:00Z", candidate: { capacity_cohort: "test" }, results: result }, policy, "2026-11-13T23:59:59.999Z"),
    governedWindow({ run_id: "at", generated_at: "2026-11-14T00:00:01Z", candidate: { capacity_cohort: "test" }, results: result }, policy, "2026-11-14T01:00:00+01:00"),
    governedWindow({ run_id: "after", generated_at: "2026-11-14T00:00:02Z", candidate: { capacity_cohort: "test" }, results: result }, policy, "2026-11-14T00:00:00.001Z"),
    governedWindow({ run_id: "invalid", generated_at: "2026-11-20T00:00:00Z", candidate: { capacity_cohort: "test" }, results: result }, policy, "not-a-time"),
  ];
  const aggregate = summarizeWindows(windows, { direct: target }, { minimumWindows: 1, targetSamples: 1, availabilityPolicy: policy });
  assert.equal(aggregate.availability_window_count, 2);
  assert.equal(aggregate.availability_status, "passed");
  assert.deepEqual(aggregate.availability_excluded_windows, [
    { run_id: "before", reasons: ["pre_policy_window"] },
    { run_id: "invalid", reasons: ["missing_or_invalid_window_start_at"] },
  ]);
});

test("availability requires the execution-time policy contract and hash", () => {
  const policy = availabilityPolicy();
  const changedPolicy = availabilityPolicy(undefined, { minimum_success_rate: 0.98 });
  const base = { generated_at: "2026-11-14T01:00:00Z", candidate: { capacity_cohort: "test" }, results: [{ route_id: "direct", status: "completed", duration_ms: 50 }] };
  const windows = [
    governedWindow({ ...base, run_id: "valid" }, policy),
    governedWindow({ ...base, run_id: "missing" }, {}),
    governedWindow({ ...base, run_id: "wrong-hash" }, changedPolicy),
    governedWindow({ ...base, run_id: "wrong-contract" }, { ...policy, contract: "other.v1" }),
  ];
  const aggregate = summarizeWindows(windows, { direct: target }, { minimumWindows: 1, targetSamples: 1, availabilityPolicy: policy });
  assert.equal(aggregate.availability_window_count, 1);
  assert.equal(aggregate.availability_routes[0].sample_size, 1);
  assert.deepEqual(aggregate.availability_excluded_windows.map((item) => item.run_id), ["missing", "wrong-hash", "wrong-contract"]);
});

test("availability requires three eligible windows and one hundred samples per route without rounding", () => {
  const policy = availabilityPolicy();
  const candidate = { capacity_cohort: "test" };
  const makeResults = (route, completed, failed = 0) => [
    ...Array.from({ length: completed }, () => ({ route_id: route, status: "completed", duration_ms: 50 })),
    ...Array.from({ length: failed }, () => ({ route_id: route, status: "failed", functional_status: "blocked", error_code: "retrieval_unavailable", duration_ms: 50 })),
  ];
  const windows = [
    governedWindow({ run_id: "one", generated_at: "2026-11-14T01:00:00Z", candidate, results: [...makeResults("direct", 34), ...makeResults("retrieval", 50)] }, policy),
    governedWindow({ run_id: "two", generated_at: "2026-11-14T02:00:00Z", candidate, results: [...makeResults("direct", 33), ...makeResults("retrieval", 49, 1)] }, policy),
    governedWindow({ run_id: "three", generated_at: "2026-11-14T03:00:00Z", candidate, results: makeResults("direct", 33) }, policy),
  ];
  const aggregate = summarizeWindows(windows, { direct: target, retrieval: target }, { availabilityPolicy: policy });
  assert.equal(aggregate.availability_status, "not_evaluated");
  assert.equal(aggregate.availability_routes.find((route) => route.route === "direct").availability_status, "passed");
  const retrieval = aggregate.availability_routes.find((route) => route.route === "retrieval");
  assert.equal(retrieval.sample_size, 100);
  assert.equal(retrieval.availability_window_count, 2);
  assert.equal(retrieval.availability_status, "not_evaluated");

  const exactPolicy = availabilityPolicy(undefined, { minimum_success_rate: 0.99 });
  const exact = [97, 1, 1].map((completed, index) => governedWindow({
    run_id: `exact-${index}`,
    generated_at: `2026-11-14T0${index + 4}:00:00Z`,
    candidate,
    results: makeResults("direct", completed, index === 0 ? 1 : 0),
  }, exactPolicy));
  const exactAggregate = summarizeWindows(exact, { direct: target }, { availabilityPolicy: exactPolicy });
  assert.equal(exactAggregate.availability_routes[0].sample_size, 100);
  assert.equal(exactAggregate.availability_routes[0].counts.completed, 99);
  assert.equal(exactAggregate.availability_status, "passed");

  const below = [329, 329, 328].map((completed, index) => governedWindow({
    run_id: `below-${index}`,
    generated_at: `2026-11-14T0${index + 7}:00:00Z`,
    candidate,
    results: makeResults("direct", completed, [5, 5, 4][index]),
  }, exactPolicy));
  const belowAggregate = summarizeWindows(below, { direct: target }, { availabilityPolicy: exactPolicy });
  assert.equal(belowAggregate.availability_routes[0].availability_success_rate_exact, 0.986);
  assert.equal(belowAggregate.availability_status, "failed");
});

test("a governed retrieval unavailable response remains a failed functional outcome", () => {
  const source = fs.readFileSync(path.join(__dirname, "run-azure-native-route-soak.cjs"), "utf8");
  assert.match(source, /response\.status === "completed"/);
  assert.match(source, /functional_status: String\(response\.status/);
  assert.match(source, /error_code: String\(response\.output\?\.error_code/);
  assert.match(source, /search_retry_count: Number\(response\.trace\?\.search_retry_count/);
});
