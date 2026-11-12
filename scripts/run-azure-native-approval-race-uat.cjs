const assert = require("node:assert/strict");
const { signKnowledgeAccessToken } = require("../backend/knowledgeAccess");

const baseUrl = String(process.env.MEIDS_BACKEND_BASE_URL || "").replace(/\/+$/, "");
const tenantId = String(process.env.MEIDS_UAT_TENANT_ID || "").trim();
const userId = String(process.env.MEIDS_UAT_USER_ID || "").trim();
const twinId = String(process.env.MEIDS_UAT_TWIN_ID || "").trim();
if (!baseUrl || !tenantId || !userId || !twinId) {
  throw new Error("MEIDS_BACKEND_BASE_URL and the UAT tenant, user, and twin IDs are required.");
}

const token = signKnowledgeAccessToken({
  tenant_id: tenantId,
  user_id: userId,
  active_twin_id: twinId,
  allowed_twin_ids: [twinId],
  roles: ["owner", "reviewer"],
  visibility_scopes: ["private", "twin_shared", "team_shared", "org_shared"],
  knowledge_scope: "active_twin",
}, { ttlSeconds: 900 });
if (!token) throw new Error("MEIDS_AUTH_CONTEXT_SIGNING_KEY is required and must remain process-local.");

const marker = `AZ-NATIVE-APPROVAL-RACE-${Date.now()}`;
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  Accept: "application/json",
};

async function request(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw: raw.slice(0, 500) }; }
  return { status: response.status, data };
}

async function main() {
  const prepared = await request("/api/agents/chat", {
    request_id: `uat-${marker}`,
    session_id: `uat-${marker}`,
    twin_id: twinId,
    message: `Remember this as knowledge: ${marker}. This is a synthetic approval concurrency test and must remain review-needed.`,
  });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.data?.response?.status, "approval_required");
  assert.equal(prepared.data?.response?.runtime || prepared.data?.response?.trace?.runtime, "azure_native");
  const traceId = prepared.data?.response?.trace?.trace_id || prepared.data?.trace?.trace_id;
  assert.ok(traceId, "Approval preparation did not return a trace ID.");
  const approvalId = `appr_${traceId}`.replace(/[^\w-]/g, "_");
  const common = {
    approval_id: approvalId,
    request_id: `decision-${marker}`,
    twin_id: twinId,
    approval_note: `Synthetic concurrent decision UAT ${marker}`,
  };
  const [approve, reject] = await Promise.all([
    request("/api/agents/approvals/resume", { ...common, approved: true }),
    request("/api/agents/approvals/resume", { ...common, approved: false }),
  ]);
  const statuses = [approve.status, reject.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409]);
  const winner = approve.status === 200 ? "approve" : "reject";
  const success = approve.status === 200 ? approve.data : reject.data;
  assert.ok(["resumed", "rejected"].includes(success.status));
  console.log(JSON.stringify({
    status: "passed",
    marker,
    runtime: "azure_native",
    winner,
    responses: { approve: approve.status, reject: reject.status },
    terminal_status: success.status,
    replay_prevented: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
