const assert = require("node:assert/strict");
const { signKnowledgeAccessToken } = require("../backend/knowledgeAccess");

const baseUrl = String(process.env.MEIDS_BACKEND_BASE_URL || "").replace(/\/+$/, "");
const tenantId = String(process.env.MEIDS_UAT_TENANT_ID || "").trim();
const userId = String(process.env.MEIDS_UAT_USER_ID || "").trim();
const twinId = String(process.env.MEIDS_UAT_TWIN_ID || "").trim();
if (!baseUrl || !tenantId || !userId || !twinId) throw new Error("Backend and UAT scope variables are required.");

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

const marker = `AZ-NATIVE-APPROVAL-MUTATION-${Date.now()}`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };

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
    message: `Remember this as knowledge: ${marker}. This is a synthetic operation-binding test and must not be persisted.`,
  });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.data?.response?.status, "approval_required");
  const traceId = prepared.data?.response?.trace?.trace_id || prepared.data?.trace?.trace_id;
  assert.ok(traceId);
  const approvalId = `appr_${traceId}`.replace(/[^\w-]/g, "_");
  const mutated = await request("/api/agents/approvals/resume", {
    approval_id: approvalId,
    request_id: `mutated-${marker}`,
    twin_id: twinId,
    approved: true,
    approval_note: "Synthetic mutation must be rejected.",
    concept: { title: `CHANGED-${marker}` },
  });
  assert.equal(mutated.status, 409);
  assert.equal(mutated.data?.code, "approval_operation_binding_mismatch");
  const cleanup = await request("/api/agents/approvals/resume", {
    approval_id: approvalId,
    request_id: `reject-${marker}`,
    twin_id: twinId,
    approved: false,
    approval_note: "Reject synthetic mutation UAT without persistence.",
  });
  assert.equal(cleanup.status, 200);
  assert.equal(cleanup.data?.status, "rejected");
  console.log(JSON.stringify({
    status: "passed",
    marker,
    mutation_status: mutated.status,
    mutation_code: mutated.data.code,
    approval_remained_decidable: true,
    cleanup_status: cleanup.data.status,
    knowledge_write: false,
  }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
