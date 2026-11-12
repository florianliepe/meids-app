const SLO_VERSION = "meids.agent-slo.v1";

const WORKFLOW_SLOS = Object.freeze({
  actor_twin: { p50_warning_ms: 20_000, p90_warning_ms: 90_000, p90_critical_ms: 120_000, minimum_samples: 10 },
  knowledge_fabric_agent: { p50_warning_ms: 15_000, p90_warning_ms: 45_000, p90_critical_ms: 60_000, minimum_samples: 10 },
  agentic_butler: { p50_warning_ms: 60_000, p90_warning_ms: 90_000, p90_critical_ms: 120_000, minimum_samples: 10 },
  skill_orchestrator: { p50_warning_ms: 60_000, p90_warning_ms: 90_000, p90_critical_ms: 120_000, minimum_samples: 10 },
  task_agent: { p50_warning_ms: 45_000, p90_warning_ms: 75_000, p90_critical_ms: 90_000, minimum_samples: 10 },
  critical_faculty: { p50_warning_ms: 35_000, p90_warning_ms: 50_000, p90_critical_ms: 75_000, minimum_samples: 10 },
  learning_agent: { p50_warning_ms: 30_000, p90_warning_ms: 60_000, p90_critical_ms: 120_000, minimum_samples: 10 },
});

const ROUTE_SLOS = Object.freeze({
  answer_direct: { p90_warning_ms: 15_000, p90_critical_ms: 20_000 },
  retrieve_knowledge: { p90_warning_ms: 20_000, p90_critical_ms: 30_000 },
  execute_work_sync: { p90_warning_ms: 60_000, p90_critical_ms: 90_000 },
  execute_work_async_ack: { p90_warning_ms: 5_000, p90_critical_ms: 10_000 },
});

const QUEUE_SLOS = Object.freeze({
  acknowledgement_warning_ms: 5_000,
  acknowledgement_critical_ms: 10_000,
  queued_age_warning_ms: 30_000,
  queued_age_critical_ms: 90_000,
  processing_age_warning_ms: 180_000,
  processing_age_critical_ms: 240_000,
});

function evaluateWorkflowSlo(agent, metrics = {}) {
  const target = WORKFLOW_SLOS[agent];
  if (!target) return { status: "not_configured", target: null, breaches: [] };
  if (!Number.isInteger(metrics.sample_size) || metrics.sample_size < 0) {
    return { status: "incomplete_metrics", target, warnings: ["invalid_sample_size"] };
  }
  if (metrics.sample_size < target.minimum_samples) {
    return { status: "insufficient_samples", target, breaches: [] };
  }
  if (!Number.isFinite(metrics.p50_ms) || metrics.p50_ms < 0
    || !Number.isFinite(metrics.p90_ms) || metrics.p90_ms < 0
    || metrics.p90_ms < metrics.p50_ms) {
    return { status: "incomplete_metrics", target, warnings: ["missing_percentile"] };
  }
  const warnings = [];
  if (metrics.p50_ms > target.p50_warning_ms) warnings.push("p50_ms");
  if (metrics.p90_ms > target.p90_warning_ms) warnings.push("p90_ms");
  const critical = metrics.p90_ms > target.p90_critical_ms;
  return { status: critical ? "critical" : warnings.length ? "warning" : "met", target, warnings };
}

module.exports = { SLO_VERSION, WORKFLOW_SLOS, ROUTE_SLOS, QUEUE_SLOS, evaluateWorkflowSlo };
