function percentile(values, percentileValue) {
  if (!Array.isArray(values) || !values.length || values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)];
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

module.exports = { percentile, summarizeRoute };
