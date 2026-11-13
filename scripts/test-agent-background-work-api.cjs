const test = require("node:test");
const assert = require("node:assert/strict");
const { createWorkspaceApi } = require("../backend/workspaceApi");

const mapping = {
  tenant_id: "tenant-a",
  user_id: "user-a",
  active_twin_id: "twin-a",
  allowed_twin_ids: ["twin-a"],
  roles: ["owner"],
  group_ids: [],
};

function harness({ existingLedger = false, statusRows = [], cancellationRow = null } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("INSERT INTO runtime.background_job")) {
        return { rowCount: 1, rows: [{ job_id: params[0], status: "pending", created_at: new Date().toISOString() }] };
      }
      if (String(sql).includes("SELECT 1 FROM audit.event")) return { rowCount: existingLedger ? 1 : 0, rows: existingLedger ? [{ exists: 1 }] : [] };
      if (String(sql).includes("SELECT resource_id, action, details")) return { rowCount: statusRows.length, rows: statusRows };
      if (String(sql).includes("WITH target AS")) {
        return { rowCount: cancellationRow ? 1 : 0, rows: cancellationRow ? [cancellationRow] : [] };
      }
      if (String(sql).includes("UPDATE audit.event")) return { rowCount: 1, rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  const responses = [];
  const api = createWorkspaceApi({
    async getPgPool() { return pool; },
    async requireTwinRequestMapping() { throw new Error("Entra-only mapping must not be used by the internal adapter."); },
    async requireKnowledgeRequestMapping(_req, body) {
      assert.equal(body.knowledge_access_token || "", body.knowledge_access_token ? "signed-token" : "");
      return mapping;
    },
    async readBody(req) { return req.body || {}; },
    async readMultipartForm() { throw new Error("not used"); },
    jsonResponse(_res, status, body) { responses.push({ status, body }); },
    async stageKnowledge() {}, async promoteKnowledge() {}, async rejectKnowledge() {},
    async proxyToN8n() { return { output: "completed" }; },
    async transcribeAudio() {}, transcriptionConfig() { return {}; },
    issueKnowledgeAccessToken() { return "worker-token"; },
  });
  return { api, calls, responses };
}

test("background work accepts a token-authenticated no-write request with a durable 202", async () => {
  const { api, calls, responses } = harness();
  const req = { method: "POST", body: { twin_id: "twin-a", message: "Research and compare three options, then prepare a brief.", knowledge_access_token: "signed-token", session_id: "session-a", idempotency_key: "request-a" } };
  const handled = await api(req, {}, new URL("https://example.test/api/agents/work"));
  assert.equal(handled, true);
  assert.equal(responses[0].status, 202);
  assert.equal(responses[0].body.contract, "meids.agent-work.v1");
  assert.equal(responses[0].body.status, "queued");
  assert.equal(responses[0].body.runtime_provider, "n8n");
  assert.match(responses[0].body.job_id, /^agent-work-/);
  const insert = calls.find((call) => call.sql.includes("INSERT INTO runtime.background_job"));
  assert.equal(insert.params[4], "agent_work");
  assert.equal(JSON.parse(insert.params[6]).runtime_provider, "n8n");
  assert.equal(insert.params[8], 3);
  assert.ok(calls.some((call) => call.sql.includes("INSERT INTO audit.event")));
});

test("background work idempotency does not duplicate the visible ledger", async () => {
  const { api, calls } = harness({ existingLedger: true });
  const req = { method: "POST", body: { twin_id: "twin-a", message: "Compare three options, then prepare a no-write brief.", knowledge_access_token: "signed-token", idempotency_key: "stable-key" } };
  await api(req, {}, new URL("https://example.test/api/agents/work"));
  assert.equal(calls.filter((call) => call.sql.includes("INSERT INTO audit.event")).length, 0);
});

test("background work rejects external side effects before enqueue", async () => {
  const { api, calls } = harness();
  const req = { method: "POST", body: { twin_id: "twin-a", message: "Publish the report.", knowledge_access_token: "signed-token", allow_external_side_effects: true } };
  await assert.rejects(() => api(req, {}, new URL("https://example.test/api/agents/work")), (error) => error.statusCode === 409);
  assert.equal(calls.some((call) => call.sql.includes("INSERT INTO runtime.background_job")), false);
});

test("background work rejects side-effect language even when the client claims no-write", async () => {
  const { api, calls } = harness();
  const req = { method: "POST", body: { twin_id: "twin-a", message: "Prepare the release, then publish the report.", knowledge_access_token: "signed-token", allow_external_side_effects: false } };
  await assert.rejects(() => api(req, {}, new URL("https://example.test/api/agents/work")), (error) => error.statusCode === 409);
  assert.equal(calls.some((call) => call.sql.includes("INSERT INTO runtime.background_job")), false);
});

test("status lookup is constrained by tenant, owner, twin, and job", async () => {
  const row = { resource_id: "agent-work-1", action: "agent.work.completed", details: { twin_id: "twin-a", status: "completed", summary: "done" }, created_at: new Date().toISOString() };
  const { api, calls, responses } = harness({ statusRows: [row] });
  const req = { method: "GET" };
  await api(req, {}, new URL("https://example.test/api/agents/work?twin=twin-a&job=agent-work-1"));
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].body.status, "completed");
  const select = calls.find((call) => call.sql.includes("SELECT resource_id, action, details"));
  assert.deepEqual(select.params.slice(0, 4), ["tenant-a", "user-a", "twin-a", "agent-work-1"]);
  assert.match(select.sql, /actor_user_id = \$2/);
  assert.match(select.sql, /details->>'twin_id' = \$3/);
});

test("queued background work can be cancelled once through an owner-scoped compare-and-set", async () => {
  const { api, calls, responses } = harness({
    cancellationRow: { job_id: "agent-work-cancel", status: "cancelled", cancelled: true },
  });
  const req = { method: "DELETE", body: { twin_id: "twin-a", job_id: "agent-work-cancel" } };
  await api(req, {}, new URL("https://example.test/api/agents/work"));
  const cancel = calls.find((call) => call.sql.includes("WITH target AS"));
  assert.ok(cancel);
  assert.deepEqual(cancel.params, ["agent-work-cancel", "tenant-a", "user-a", "twin-a"]);
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].body.status, "cancelled");
  assert.ok(calls.some((call) => call.sql.includes("agent.work.cancelled")));
});

test("processing background work rejects cancellation without rewriting the ledger", async () => {
  const { api, calls } = harness({
    cancellationRow: { job_id: "agent-work-running", status: "processing", cancelled: false },
  });
  const req = { method: "DELETE", body: { twin_id: "twin-a", job_id: "agent-work-running" } };
  await assert.rejects(
    () => api(req, {}, new URL("https://example.test/api/agents/work")),
    (error) => error.statusCode === 409 && /processing/.test(error.message),
  );
  assert.equal(calls.some((call) => call.sql.includes("agent.work.cancelled")), false);
});

test("already-cancelled background work rejects repeated cancellation without rewriting the ledger", async () => {
  const { api, calls } = harness({
    cancellationRow: { job_id: "agent-work-cancelled", status: "cancelled", cancelled: false },
  });
  const req = { method: "DELETE", body: { twin_id: "twin-a", job_id: "agent-work-cancelled" } };
  await assert.rejects(
    () => api(req, {}, new URL("https://example.test/api/agents/work")),
    (error) => error.statusCode === 409 && /cancelled/.test(error.message),
  );
  assert.equal(calls.some((call) => call.sql.includes("agent.work.cancelled")), false);
});

test("owner-scoped cancellation does not reveal a missing or foreign job", async () => {
  const { api, calls } = harness();
  const req = { method: "DELETE", body: { twin_id: "twin-a", job_id: "agent-work-foreign" } };
  await assert.rejects(
    () => api(req, {}, new URL("https://example.test/api/agents/work")),
    (error) => error.statusCode === 404,
  );
  assert.equal(calls.some((call) => call.sql.includes("agent.work.cancelled")), false);
});

test("worker re-enters Actor Twin once with a trusted non-recursive no-write override", async () => {
  const proxyCalls = [];
  const databaseCalls = [];
  const job = {
    job_id: "agent-work-worker-test",
    job_type: "agent_work",
    tenant_id: mapping.tenant_id,
    actor_user_id: mapping.user_id,
    twin_id: mapping.active_twin_id,
    attempts: 1,
    max_attempts: 3,
    leased_by: "worker-a",
    payload: {
      mapping,
      runtime_provider: "azure_native",
      queued: { twin_id: "twin-a", request: "Prepare the brief.", critical_faculty: false },
      request: { chatInput: "Prepare the brief.", metadata: { identity: { activeTwinId: "twin-a" }, authorization: {} } },
    },
  };
  const client = {
    async query(sql, params = []) {
      databaseCalls.push({ sql: String(sql), params });
      if (String(sql).includes("RETURNING job.*")) return { rowCount: 1, rows: [job] };
      if (String(sql).includes("UPDATE audit.event")) return { rowCount: 1, rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const pool = {
    async connect() { return client; },
    async query() { return { rowCount: 1, rows: [] }; },
  };
  const api = createWorkspaceApi({
    async getPgPool() { return pool; },
    async requireTwinRequestMapping() { return mapping; },
    async requireKnowledgeRequestMapping() { return mapping; },
    async readBody() { return {}; }, async readMultipartForm() { throw new Error("not used"); },
    jsonResponse() {}, async stageKnowledge() {}, async promoteKnowledge() {}, async rejectKnowledge() {},
    async executeAgent(agent, request, options) {
      proxyCalls.push({ agent, request, options });
      return {
        status: "completed",
        output: { answer: "finished" },
        trace: { runtime: "azure_native", role_executions: [{ agent: "agentic_butler" }] },
      };
    },
    async transcribeAudio() {}, transcriptionConfig() { return {}; }, issueKnowledgeAccessToken() { return "fresh-worker-token"; },
  });
  const result = await api.processRuntimeJobs({ workerId: "worker-a" });
  assert.equal(result.results[0].status, "completed");
  assert.equal(proxyCalls.length, 1);
  assert.equal(proxyCalls[0].agent, "actor_twin");
  assert.equal(proxyCalls[0].request.metadata.source, "meids_backend_background_work");
  assert.equal(proxyCalls[0].request.metadata.routingContractOverride.route, "execute_work_sync");
  assert.equal(proxyCalls[0].request.metadata.side_effect_policy, "no_external_side_effects");
  assert.equal(proxyCalls[0].request.metadata.authorization.knowledgeAccessToken, "fresh-worker-token");
  assert.equal(proxyCalls[0].options.runtimeProvider, "azure_native");
  const completedLedger = databaseCalls.find((call) => call.sql.includes("UPDATE audit.event")
    && String(call.params[2]) === "agent.work.completed");
  const completed = JSON.parse(completedLedger.params[3]);
  assert.equal(completed.result.trace.runtime, "azure_native");
  assert.equal(completed.result.trace.role_executions[0].agent, "agentic_butler");
});

test("Azure-native Learning runs detached and stages only review-needed output", async () => {
  const job = {
    job_id: "learning-worker-test",
    job_type: "learning_post_turn",
    tenant_id: mapping.tenant_id,
    actor_user_id: mapping.user_id,
    twin_id: mapping.active_twin_id,
    attempts: 1,
    max_attempts: 3,
    leased_by: "worker-learning",
    payload: {
      mapping,
      runtime_provider: "azure_native",
      learning: {
        request_id: "request-learning",
        trace_id: "trace-learning",
        source_interaction_summary: "The user corrected a durable preference.",
      },
    },
  };
  const calls = [];
  const staged = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("RETURNING job.*")) return { rowCount: 1, rows: [job] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const pool = {
    async connect() { return client; },
    async query(sql, params = []) { calls.push({ sql: String(sql), params }); return { rowCount: 1, rows: [] }; },
  };
  const api = createWorkspaceApi({
    async getPgPool() { return pool; },
    async requireTwinRequestMapping() { return mapping; }, async requireKnowledgeRequestMapping() { return mapping; },
    async readBody() { return {}; }, async readMultipartForm() { throw new Error("not used"); }, jsonResponse() {},
    async stageKnowledge() {}, async promoteKnowledge() {}, async rejectKnowledge() {},
    async stageLearning(_pool, suppliedMapping, body) {
      staged.push({ suppliedMapping, body });
      return { status: "staged", increment_id: "increment-learning", review_state: "review_needed" };
    },
    async generateLearningProposal(learning) {
      assert.equal(learning.trace_id, "trace-learning");
      return { summary: "Corrected preference", increment_type: "preference_correction", concept_deltas: [], payload: { target_review_state: "review_needed" } };
    },
    async proxyToN8n() { throw new Error("Learning must not call n8n"); },
    async transcribeAudio() {}, transcriptionConfig() { return {}; }, issueKnowledgeAccessToken() { return "unused"; },
  });
  const result = await api.processRuntimeJobs({ workerId: "worker-learning" });
  assert.equal(result.results[0].status, "completed");
  assert.equal(staged.length, 1);
  assert.equal(staged[0].suppliedMapping.user_id, mapping.user_id);
  assert.equal(staged[0].body.trace_id, "trace-learning");
  assert.equal(staged[0].body.payload.target_review_state, "review_needed");
  assert.ok(calls.some((call) => call.sql.includes("status = 'completed'")));
});

test("Azure-native Learning dry run executes the proposal without staging knowledge", async () => {
  const job = {
    job_id: "learning-dry-run-test",
    job_type: "learning_post_turn",
    tenant_id: mapping.tenant_id,
    actor_user_id: mapping.user_id,
    twin_id: mapping.active_twin_id,
    attempts: 1,
    max_attempts: 3,
    leased_by: "worker-learning-dry",
    payload: {
      mapping,
      runtime_provider: "azure_native",
      learning: {
        request_id: "request-learning-dry",
        trace_id: "trace-learning-dry",
        source_interaction_summary: "Synthetic no-write learning probe.",
        dry_run: true,
      },
    },
  };
  const calls = [];
  let staged = false;
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("RETURNING job.*")) return { rowCount: 1, rows: [job] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const pool = {
    async connect() { return client; },
    async query(sql, params = []) { calls.push({ sql: String(sql), params }); return { rowCount: 1, rows: [] }; },
  };
  const api = createWorkspaceApi({
    async getPgPool() { return pool; },
    async requireTwinRequestMapping() { return mapping; },
    async requireKnowledgeRequestMapping() { return mapping; },
    async readBody() { return {}; }, async readMultipartForm() { throw new Error("not used"); },
    jsonResponse() {}, async stageKnowledge() {}, async promoteKnowledge() {}, async rejectKnowledge() {},
    async stageLearning() { staged = true; throw new Error("dry run must not stage"); },
    async generateLearningProposal() {
      return { summary: "Synthetic proposal", increment_type: "probe", concept_deltas: [{ operation: "create" }] };
    },
    async proxyToN8n() { throw new Error("Learning must not call n8n"); },
    async transcribeAudio() {}, transcriptionConfig() { return {}; }, issueKnowledgeAccessToken() { return "unused"; },
  });
  const result = await api.processRuntimeJobs({ workerId: "worker-learning-dry" });
  assert.equal(result.results[0].status, "completed");
  assert.equal(staged, false);
  const completion = calls.find((call) => call.sql.includes("status = 'completed'"));
  assert.ok(completion);
  const stored = JSON.parse(completion.params[1]);
  assert.equal(stored.status, "proposed_no_write");
  assert.equal(stored.review_state, "not_persisted");
  assert.equal(stored.role_executions[0].agent, "learning_agent");
  assert.equal(stored.domain_write_guard.contract, "meids.learning-dry-run-domain-proof.v1");
  assert.equal(stored.domain_write_guard.entity_count, 12);
  assert.equal(stored.domain_write_guard.unchanged, true);
  assert.equal(stored.domain_write_guard.before_digest, stored.domain_write_guard.after_digest);
});

test("worker does not report an n8n timeout fallback as completed or retry it automatically", async () => {
  const job = {
    job_id: "agent-work-timeout-test", job_type: "agent_work",
    tenant_id: mapping.tenant_id, actor_user_id: mapping.user_id, twin_id: mapping.active_twin_id,
    attempts: 1, max_attempts: 3, leased_by: "worker-timeout",
    payload: {
      mapping,
      queued: { twin_id: "twin-a", request: "Prepare the brief.", critical_faculty: false },
      request: { chatInput: "Prepare the brief.", metadata: { identity: { activeTwinId: "twin-a" }, authorization: {} } },
    },
  };
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("RETURNING job.*")) return { rowCount: 1, rows: [job] };
      if (String(sql).includes("UPDATE audit.event")) return { rowCount: 1, rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const pool = {
    async connect() { return client; },
    async query(sql, params = []) { calls.push({ sql: String(sql), params }); return { rowCount: 1, rows: [] }; },
  };
  const api = createWorkspaceApi({
    async getPgPool() { return pool; },
    async requireTwinRequestMapping() { return mapping; }, async requireKnowledgeRequestMapping() { return mapping; },
    async readBody() { return {}; }, async readMultipartForm() { throw new Error("not used"); }, jsonResponse() {},
    async stageKnowledge() {}, async promoteKnowledge() {}, async rejectKnowledge() {},
    async proxyToN8n(_agent, _request, options) {
      assert.equal(options.timeoutMs, 180000);
      assert.equal(options.maxTimeoutMs, 240000);
      return { status: "failed", error: { code: "n8n_agent_timeout", message: "timed out" }, trace: { timeout: true } };
    },
    async transcribeAudio() {}, transcriptionConfig() { return {}; }, issueKnowledgeAccessToken() { return "fresh-worker-token"; },
  });
  const result = await api.processRuntimeJobs({ workerId: "worker-timeout" });
  assert.equal(result.results[0].status, "dead_letter");
  const failedLedger = calls.find((call) => call.sql.includes("UPDATE audit.event") && call.params[2] === "agent.work.failed");
  assert.ok(failedLedger);
  assert.equal(failedLedger.params[3].includes('"retry_scheduled":false'), true);
});
