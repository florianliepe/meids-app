function percentile(values, percentileValue) {
  if (!Array.isArray(values) || !values.length || values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)];
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function windowRecord(artifact = {}) {
  return {
    run_id: artifact.run_id,
    generated_at: artifact.generated_at,
    candidate: artifact.candidate,
    availability_policy: artifact.availability_policy,
    window: artifact.window,
    summary: artifact.summary,
    routes: artifact.routes,
    results: artifact.results,
    ...(artifact.integrity ? { integrity: artifact.integrity } : {}),
  };
}

function comparableWindow(window = {}) {
  const record = windowRecord(window);
  delete record.integrity;
  return stableStringify(record);
}

function summarizeRoute(route, results, target, options = {}) {
  const minimumSamples = Number(options.minimumSamples || 10);
  const targetSamples = Number(options.targetSamples || 100);
  const expected = results.filter((item) => item.route_id === route);
  const durations = expected.map((item) => item.duration_ms);
  const completeDurations = durations.every((value) => Number.isFinite(value) && value >= 0);
  const counts = {
    completed: expected.filter((item) => item.status === "completed").length,
    failed: expected.filter((item) => item.status === "failed").length,
    timeout: expected.filter((item) => item.status === "timeout").length,
    cancelled: expected.filter((item) => item.status === "cancelled").length,
    unknown: expected.filter((item) => item.status === "unknown_completion").length,
  };
  const p50 = completeDurations ? percentile(durations, 50) : null;
  const p90 = completeDurations ? percentile(durations, 90) : null;
  const issues = [];
  if (expected.length < minimumSamples) issues.push("insufficient_samples");
  if (!completeDurations) issues.push("incomplete_duration_metrics");
  if (Object.values(counts).reduce((sum, value) => sum + value, 0) !== expected.length) issues.push("unclassified_result");
  if (counts.failed || counts.timeout || counts.cancelled || counts.unknown) issues.push("non_success_result");
  if (Number.isFinite(p90) && p90 > target.p90_critical_ms) issues.push("p90_critical");
  else if (Number.isFinite(p90) && p90 > target.p90_warning_ms) issues.push("p90_warning");
  return {
    route,
    sample_size: expected.length,
    latency_sample_size: completeDurations ? durations.length : 0,
    latency_population: "all_observed_results",
    sample_maturity: expected.length >= targetSamples ? "target" : expected.length >= minimumSamples ? "provisional" : "insufficient",
    counts,
    success_rate: expected.length ? Number((counts.completed / expected.length).toFixed(4)) : 0,
    p50_ms: p50,
    p90_ms: p90,
    max_ms: completeDurations ? Math.max(...durations) : null,
    target,
    status: issues.length ? "failed" : "passed",
    issues,
  };
}

function appendWindow(existingWindows = [], artifact = {}) {
  const windows = [...existingWindows];
  if (!artifact?.run_id) return windows;
  const existingIndex = windows.findIndex((item) => item.run_id === artifact.run_id);
  if (existingIndex >= 0) {
    if (comparableWindow(windows[existingIndex]) !== comparableWindow(artifact)) {
      windows[existingIndex] = {
        ...windows[existingIndex],
        integrity: { status: "conflict", issue: "conflicting_run_id" },
      };
    }
    return windows;
  }
  windows.push(windowRecord(artifact));
  return windows.sort((a, b) => String(a.generated_at).localeCompare(String(b.generated_at)));
}

function summarizeWindows(windows, targets, options = {}) {
  const availabilityPolicy = options.availabilityPolicy || null;
  const minimumWindows = Number(availabilityPolicy?.minimum_windows_per_route || options.minimumWindows || 3);
  const targetSamples = Number(availabilityPolicy?.target_samples_per_route || options.targetSamples || 100);
  const availabilityMinimumSuccessRate = Number(availabilityPolicy?.minimum_success_rate);
  const availabilityEffectiveAt = Date.parse(String(availabilityPolicy?.effective_at || ""));
  const availabilityPolicyHash = String(availabilityPolicy?.config_sha256 || "");
  const requiredRoutes = Array.isArray(availabilityPolicy?.required_routes) ? availabilityPolicy.required_routes : [];
  const targetRoutes = Object.keys(targets);
  const routeScopeMatches = !requiredRoutes.length
    || (requiredRoutes.length === targetRoutes.length && requiredRoutes.every((route) => targetRoutes.includes(route)));
  const uniqueWindows = [];
  const conflictingRunIds = new Set();
  for (const window of Array.isArray(windows) ? windows : []) {
    if (!window?.run_id) continue;
    const existing = uniqueWindows.find((item) => item.run_id === window.run_id);
    if (!existing) uniqueWindows.push(window);
    else if (comparableWindow(existing) !== comparableWindow(window)) conflictingRunIds.add(window.run_id);
    if (window.integrity?.status === "conflict") conflictingRunIds.add(window.run_id);
  }
  const excludedWindows = uniqueWindows.flatMap((window) => {
    const reasons = [];
    if (window.integrity?.status === "conflict") reasons.push("conflicting_run_id");
    if (!window?.candidate?.capacity_cohort || window.candidate.capacity_cohort === "unspecified") reasons.push("unmarked_capacity_cohort");
    return reasons.length ? [{ run_id: window.run_id, reasons }] : [];
  });
  const excludedIds = new Set(excludedWindows.map((item) => item.run_id));
  const eligibleWindows = uniqueWindows.filter((window) => !excludedIds.has(window.run_id));
  const results = eligibleWindows.flatMap((item) => Array.isArray(item.results) ? item.results : []);
  const routes = Object.entries(targets).map(([route, target]) => summarizeRoute(route, results, target, {
    minimumSamples: targetSamples,
    targetSamples,
  }));
  const samplingPassed = eligibleWindows.length >= minimumWindows
    && routes.every((route) => route.sample_size >= targetSamples);
  const availabilityPolicyDefined = Number.isFinite(availabilityMinimumSuccessRate)
    && availabilityMinimumSuccessRate > 0
    && availabilityMinimumSuccessRate <= 1
    && Number.isFinite(availabilityEffectiveAt)
    && /^[a-f0-9]{64}$/.test(availabilityPolicyHash)
    && routeScopeMatches;
  const availabilityExcludedWindows = [];
  const availabilityWindows = availabilityPolicyDefined ? eligibleWindows.filter((window) => {
    const reasons = [];
    const startAt = Date.parse(String(window?.window?.start_at || ""));
    if (!Number.isFinite(startAt)) reasons.push("missing_or_invalid_window_start_at");
    else if (startAt < availabilityEffectiveAt) reasons.push("pre_policy_window");
    if (String(window?.availability_policy?.contract || "") !== String(availabilityPolicy.contract || "")) reasons.push("policy_contract_mismatch");
    if (String(window?.availability_policy?.config_sha256 || "") !== availabilityPolicyHash) reasons.push("policy_hash_mismatch");
    if (reasons.length) availabilityExcludedWindows.push({ run_id: window.run_id, reasons });
    return reasons.length === 0;
  }) : [];
  const availabilityResults = availabilityWindows.flatMap((item) => Array.isArray(item.results) ? item.results : []);
  const availabilityRoutes = Object.entries(targets).map(([route, target]) => {
    const summary = summarizeRoute(route, availabilityResults, target, { minimumSamples: targetSamples, targetSamples });
    const routeWindowCount = availabilityWindows.filter((window) => Array.isArray(window.results)
      && window.results.some((result) => result.route_id === route)).length;
    const exactSuccessRate = summary.sample_size ? summary.counts.completed / summary.sample_size : 0;
    const mature = routeWindowCount >= minimumWindows && summary.sample_size >= targetSamples;
    return {
      ...summary,
      availability_window_count: routeWindowCount,
      availability_success_rate_exact: exactSuccessRate,
      availability_status: !mature ? "not_evaluated" : exactSuccessRate >= availabilityMinimumSuccessRate ? "passed" : "failed",
    };
  });
  const availabilityMature = availabilityPolicyDefined
    && availabilityWindows.length >= minimumWindows
    && availabilityRoutes.every((route) => route.availability_window_count >= minimumWindows && route.sample_size >= targetSamples);
  const availabilityPassed = availabilityMature
    && availabilityRoutes.every((route) => route.availability_success_rate_exact >= availabilityMinimumSuccessRate);
  const issues = [];
  if (eligibleWindows.length < minimumWindows) issues.push("insufficient_windows");
  if (routes.some((route) => route.sample_size < targetSamples)) issues.push("insufficient_route_samples");
  if (!availabilityPolicyDefined) issues.push("availability_policy_not_defined");
  else if (!availabilityMature) issues.push("availability_observation_incomplete");
  else if (!availabilityPassed) issues.push("availability_target_not_met");
  return {
    status: samplingPassed && availabilityPassed ? "passed" : "observation_in_progress",
    sampling_status: samplingPassed ? "passed" : "observation_in_progress",
    availability_status: !availabilityPolicyDefined ? "policy_not_defined" : !availabilityMature ? "not_evaluated" : availabilityPassed ? "passed" : "failed",
    availability_policy: availabilityPolicyDefined ? availabilityPolicy : null,
    availability_minimum_success_rate: availabilityPolicyDefined ? availabilityMinimumSuccessRate : null,
    availability_window_count: availabilityWindows.length,
    availability_excluded_windows: availabilityExcludedWindows,
    availability_routes: availabilityRoutes,
    window_count: eligibleWindows.length,
    observed_window_count: uniqueWindows.length,
    minimum_windows: minimumWindows,
    target_samples_per_route: targetSamples,
    conflicting_run_ids: [...conflictingRunIds].sort(),
    excluded_windows: excludedWindows,
    routes,
    issues,
  };
}

module.exports = { appendWindow, percentile, summarizeRoute, summarizeWindows };
