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

function harness({ existingLedger = false, statusRows = [] } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("INSERT INTO runtime.background_job")) {
        return { rowCount: 1, rows: [{ job_id: params[0], status: "pending", created_at: new Date().toISOString() }] };
      }
      if (String(sql).includes("SELECT 1 FROM audit.event")) return { rowCount: existingLedger ? 1 : 0, rows: existingLedger ? [{ exists: 1 }] : [] };
      if (String(sql).includes("SELECT resource_id, action, details")) return { rowCount: statusRows.length, rows: statusRows };
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
  assert.match(responses[0].body.job_id, /^agent-work-/);
  const insert = calls.find((call) => call.sql.includes("INSERT INTO runtime.background_job"));
  assert.equal(insert.params[4], "agent_work");
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

test("worker re-enters Actor Twin once with a trusted non-recursive no-write override", async () => {
  const proxyCalls = [];
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
      queued: { twin_id: "twin-a", request: "Prepare the brief.", critical_faculty: false },
      request: { chatInput: "Prepare the brief.", metadata: { identity: { activeTwinId: "twin-a" }, authorization: {} } },
    },
  };
  const client = {
    async query(sql) {
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
    async proxyToN8n(agent, request) { proxyCalls.push({ agent, request }); return { output: "finished" }; },
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
