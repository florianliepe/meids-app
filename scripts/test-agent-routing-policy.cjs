const assert = require("node:assert/strict");
const { POLICY_VERSION, classifyAgentInteraction } = require("../backend/agentRoutingPolicy");

const cases = [
  ["Hello, what can you do?", "answer_direct"],
  ["Who am I and what is my academic background?", "retrieve_knowledge"],
  ["Show the reviewed sources for our negotiation approach.", "retrieve_knowledge"],
  ["Remember this as knowledge: I prefer concise evidence summaries.", "ingest_or_stage_knowledge"],
  ["Draft a short internal email from the supplied text.", "execute_work_sync"],
  ["Research the evidence, compare three options, then prepare a decision brief.", "execute_work_async"],
  ["Create a new reusable meeting preparation skill.", "create_skill"],
  ["Interview me to extract my implicit decision criteria.", "elicit_tacit_knowledge"],
  ["Draft", "request_human_clarification"],
  ["Wer bin ich und welche Erfahrungen habe ich?", "retrieve_knowledge"],
  ["Speichere diese Notiz als Wissen.", "ingest_or_stage_knowledge"],
];

for (const [message, expected] of cases) {
  const actual = classifyAgentInteraction({ message });
  assert.equal(actual.contract, POLICY_VERSION);
  assert.equal(actual.route, expected, `${message}: expected ${expected}, got ${actual.route}`);
}

const routine = classifyAgentInteraction({ message: "Draft a short agenda." });
assert.equal(routine.gates.critical_faculty, false);
assert.equal(routine.gates.skill_orchestrator, false);
assert.equal(routine.gates.learning_mode, "post_turn_only");

const risky = classifyAgentInteraction({ message: "Compare the reviewed evidence and make a binding production architecture decision despite contradictory assumptions." });
assert.equal(risky.gates.critical_faculty, true);
assert.equal(risky.gates.external_side_effect_approval, false);

const sideEffect = classifyAgentInteraction({ message: "Publish the final report." });
assert.equal(sideEffect.gates.external_side_effect_approval, true);

const negatedSideEffect = classifyAgentInteraction({ message: "Compare three options, then prepare a brief. Do not send, publish, deploy, or delete anything." });
assert.equal(negatedSideEffect.route, "execute_work_async");
assert.equal(negatedSideEffect.gates.external_side_effect_approval, false);

const negatedWriteOnly = classifyAgentInteraction({ message: "Synthetic no-write readiness probe. Confirm the direct path is ready." });
assert.equal(negatedWriteOnly.route, "answer_direct");

const adversativeSideEffect = classifyAgentInteraction({ message: "Do not send the draft, but publish the final report." });
assert.equal(adversativeSideEffect.gates.external_side_effect_approval, true);

const probeOverride = classifyAgentInteraction({
  message: "Check alpha, beta, gamma.",
  metadata: {
    source: "run-seven-agent-no-write-uat",
    intent: "live_probe",
    side_effect_policy: "no_write_probe",
    routingHints: { noWriteProbe: true },
    routingContractOverride: { route: "execute_work_sync", skill_orchestrator: true, max_task_agent_calls: 1 },
  },
});
assert.equal(probeOverride.gates.skill_orchestrator, true);
assert.equal(probeOverride.gates.max_task_agent_calls, 1);
assert.equal(probeOverride.gates.critical_faculty, false);

const criticalProbeOverride = classifyAgentInteraction({
  message: "Review synthetic option A.",
  metadata: {
    source: "run-seven-agent-no-write-uat",
    intent: "live_probe",
    side_effect_policy: "no_write_probe",
    routingHints: { noWriteProbe: true },
    routingContractOverride: { route: "execute_work_sync", critical_faculty: true },
  },
});
assert.equal(criticalProbeOverride.gates.critical_faculty, true);

const backgroundOverride = classifyAgentInteraction({
  message: "Research the evidence, compare the options, then prepare a decision brief.",
  metadata: {
    source: "meids_backend_background_work",
    intent: "execute_background_work",
    side_effect_policy: "no_external_side_effects",
    routingHints: { backgroundWorker: true },
    routingContractOverride: { route: "execute_work_sync", skill_orchestrator: true, max_task_agent_calls: 2 },
  },
});
assert.equal(backgroundOverride.route, "execute_work_sync");
assert.equal(backgroundOverride.gates.external_side_effect_approval, false);
assert.equal(backgroundOverride.gates.external_side_effects_allowed, false);
assert.equal(backgroundOverride.worker_override, "trusted_background_work");
assert.equal(backgroundOverride.gates.max_task_agent_calls, 2);
assert.equal(backgroundOverride.gates.retrieval_required, true);

const skillOverride = classifyAgentInteraction({
  message: "Opaque approved skill payload",
  metadata: {
    source: "meids_backend_skill_execution",
    intent: "execute_approved_skill",
    side_effect_policy: "no_external_side_effects",
    routingHints: { skillWorker: true },
    routingContractOverride: { route: "execute_work_sync", max_task_agent_calls: 2, retrieval_required: true },
  },
});
assert.equal(skillOverride.route, "execute_work_sync");
assert.equal(skillOverride.worker_override, "trusted_skill_execution");
assert.equal(skillOverride.gates.skill_orchestrator, true);
assert.equal(skillOverride.gates.retrieval_required, true);
assert.equal(skillOverride.gates.external_side_effect_approval, false);

const untrustedBackgroundOverride = classifyAgentInteraction({
  message: "Research the evidence, compare the options, then prepare a decision brief.",
  metadata: {
    source: "browser",
    routingContractOverride: { route: "execute_work_sync" },
  },
});
assert.equal(untrustedBackgroundOverride.route, "execute_work_async");
assert.equal(untrustedBackgroundOverride.worker_override, undefined);

console.log(`Agent routing policy tests passed: ${cases.length + 10} cases`);
