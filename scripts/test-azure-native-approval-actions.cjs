const assert = require("node:assert/strict");
const {
  approvalRoute,
  approvalMessage,
  approvalTwinId,
  knowledgeStagePayload,
  skillProposalPayload,
  stageSkillProposal,
} = require("../backend/agentApprovalActions");
const { buildApprovalRecord } = require("../backend/server");

const approval = {
  request_id: "request-1",
  trace_id: "trace-1",
  route_decision: "",
  original_request: {
    principal: { tenant_id: "tenant-a", user_id: "user-a" },
    chatInput: "Remember this as knowledge: I prefer concise answers.",
    context: { active_twin_id: "twin-a" },
  },
  original_response: {
    runtime: "azure_native",
    output: { route_decision: { route: "ingest_or_stage_knowledge" } },
  },
};

assert.equal(approvalRoute(approval), "ingest_or_stage_knowledge");
assert.equal(approvalMessage(approval), "Remember this as knowledge: I prefer concise answers.");
assert.equal(approvalTwinId(approval), "twin-a");
const knowledge = knowledgeStagePayload(approval, {});
assert.equal(knowledge.twin_id, "twin-a");
assert.equal(knowledge.concept.visibility_scope, "private");
assert.match(knowledge.concept.summary, /concise answers/);
assert.equal(knowledge.evidence.length, 1);

const skillApproval = structuredClone(approval);
skillApproval.original_request.chatInput = "Create a new reusable meeting preparation skill.";
skillApproval.original_response.output.route_decision.route = "create_skill";
const skill = skillProposalPayload(skillApproval, {});
assert.equal(skill.twin_id, "twin-a");
assert.match(skill.name, /meeting preparation/i);
assert.equal(skill.spec.approval_policy, "never_auto_approve_generated_skills");

const approvalRecord = buildApprovalRecord("actor_twin", approval.original_request, {
  request_id: approval.request_id,
  agent_id: "actor_twin",
  status: "approval_required",
  output: { route_decision: { route: "ingest_or_stage_knowledge" } },
  trace: { runtime: "azure_native", trace_id: approval.trace_id },
  runtime: "azure_native",
}, { trace_id: approval.trace_id });
assert.match(approvalRecord.operation_sha256, /^[a-f0-9]{64}$/);
assert(Date.parse(approvalRecord.expires_at) > Date.now());

const queries = [];
const client = {
  async query(sql, params = []) {
    queries.push({ sql, params });
    if (/RETURNING skill_id/.test(sql)) return { rows: [{ skill_id: params[0], twin_id: params[3], name: params[4], status: "pending_approval", risk_class: params[6], version: "0.1.0" }] };
    return { rows: [], rowCount: 1 };
  },
  release() {},
};
const pool = { async connect() { return client; } };

(async () => {
  const staged = await stageSkillProposal(pool, {
    tenant_id: "tenant-a",
    user_id: "user-a",
    allowed_twin_ids: ["twin-a"],
    group_ids: [],
  }, skill);
  assert.equal(staged.status, "pending_approval");
  assert(queries.some(({ sql }) => /INSERT INTO agent\.skill_spec/.test(sql)));
  assert(queries.some(({ sql }) => /INSERT INTO audit\.event/.test(sql)));
  assert(queries.some(({ sql }) => sql === "COMMIT"));
  await assert.rejects(
    () => stageSkillProposal(pool, { tenant_id: "tenant-a", user_id: "user-a", allowed_twin_ids: ["other"] }, skill),
    (error) => error.statusCode === 403,
  );
  console.log("Azure-native approval action tests passed");
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
