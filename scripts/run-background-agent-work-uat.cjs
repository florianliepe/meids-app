#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { signKnowledgeAccessToken } = require("../backend/knowledgeAccess");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, "docs", "uat", "azure-native-background-work-uat.json");
const backendUrl = String(process.env.MEIDS_BACKEND_BASE_URL || "https://meids-prod-backend-1853a19b.azurewebsites.net").replace(/\/+$/, "");
const userId = String(process.env.MEIDS_UAT_USER_ID || "").trim();
const twinId = String(process.env.MEIDS_UAT_TWIN_ID || "").trim();
const tenantId = String(process.env.MEIDS_UAT_TENANT_ID || "eraneos").trim();
if (!userId || !twinId) throw new Error("MEIDS_UAT_USER_ID and MEIDS_UAT_TWIN_ID are required.");

const token = signKnowledgeAccessToken({
  tenant_id: tenantId, user_id: userId, active_twin_id: twinId, allowed_twin_ids: [twinId],
  roles: ["owner", "reviewer"], visibility_scopes: ["private", "twin_shared", "team_shared", "org_shared"], knowledge_scope: "active_twin",
}, { ttlSeconds: 1200 });
if (!token) throw new Error("MEIDS_AUTH_CONTEXT_SIGNING_KEY is required.");

const runId = `background_uat_${Date.now().toString(36)}`;
const query = "Controlled no-write UAT: compare synthetic options alpha, beta, and gamma, then prepare a concise decision brief with assumptions and a recommendation. Do not send, publish, persist knowledge, activate capabilities, or perform external side effects.";
const metadata = {
  source: "meids-background-work-uat",
  interfaceContract: "meids.actor_twin.embedded_chat.v1",
  identity: { tenantId, userId, activeTwinId: twinId, allowedTwinIds: [twinId] },
  authorization: { contract: "meids.knowledge-access.v1", knowledgeAccessToken: token, knowledgeScope: "active_twin", handling: "opaque_backend_credential_do_not_prompt_or_log" },
  routingHints: { evidenceFirst: true },
};

async function request(url, options = {}) {
  const started = Date.now();
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeout || 150_000) });
  const raw = await response.text();
  let body = raw;
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = raw; }
  return { response, body, raw: raw.replaceAll(token, "[redacted]"), duration_ms: Date.now() - started };
}

(async () => {
  const ack = await request(`${backendUrl}/api/agents/work`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      twin_id: twinId,
      message: query,
      session_id: runId,
      idempotency_key: runId,
      knowledge_access_token: token,
      metadata,
    }),
    timeout: 30_000,
  });
  if (!ack.response.ok) throw new Error(`Actor acknowledgement failed ${ack.response.status}: ${ack.raw.slice(0, 600)}`);
  const jobId = String(ack.body?.job_id || "");
  if (!jobId) throw new Error(`Actor response did not include a durable background job ID: ${ack.raw.slice(0, 800)}`);
  if (ack.duration_ms > 10_000) throw new Error(`Background acknowledgement exceeded 10 seconds: ${ack.duration_ms}ms.`);

  let job = null;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const status = await request(`${backendUrl}/api/agents/work?twin=${encodeURIComponent(twinId)}&job=${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 15_000,
    });
    if (!status.response.ok) throw new Error(`Status lookup failed ${status.response.status}: ${status.raw.slice(0, 600)}`);
    job = status.body;
    if (["completed", "failed"].includes(job.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  if (job?.status !== "completed") throw new Error(`Background job did not complete: ${JSON.stringify(job || {})}`);

  const blocked = await request(`${backendUrl}/api/agents/work`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ twin_id: twinId, message: "Prepare the release and then publish it.", allow_external_side_effects: false }),
    timeout: 15_000,
  });
  if (blocked.response.status !== 409) throw new Error(`Side-effect request must return 409, received ${blocked.response.status}.`);

  const artifact = {
    schema_version: "1.0.0",
    generated_at: new Date().toISOString(),
    status: "passed", contract: "meids.agent-work.v1", run_id: runId, job_id: jobId,
    acknowledgement_ms: ack.duration_ms, final_status: job.status, attempts: job.attempts,
    runtime_provider: job.runtime_provider || ack.body?.runtime_provider || "",
    side_effect_guard_http_status: blocked.response.status,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ ...artifact, output: path.relative(root, outputPath).replaceAll("\\", "/") }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
