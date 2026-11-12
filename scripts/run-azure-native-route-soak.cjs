#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { signKnowledgeAccessToken } = require("../backend/knowledgeAccess");
const { ROUTE_SLOS } = require("../backend/agentSloPolicy");
const { summarizeRoute } = require("./lib/azure-native-route-soak.cjs");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, "docs", "uat", "azure-native-route-soak.json");
const baseUrl = String(process.env.MEIDS_BACKEND_BASE_URL || "https://meids-prod-backend-1853a19b.azurewebsites.net").replace(/\/+$/, "");
const tenantId = String(process.env.MEIDS_UAT_TENANT_ID || "eraneos").trim();
const userId = String(process.env.MEIDS_UAT_USER_ID || "").trim();
const twinId = String(process.env.MEIDS_UAT_TWIN_ID || "").trim();
const samples = Math.max(1, Math.min(Number(process.env.MEIDS_SOAK_SAMPLES || 10), 100));
const runId = `azure_route_soak_${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}`;
if (!userId || !twinId) throw new Error("MEIDS_UAT_USER_ID and MEIDS_UAT_TWIN_ID are required.");

const token = signKnowledgeAccessToken({
  tenant_id: tenantId, user_id: userId, active_twin_id: twinId, allowed_twin_ids: [twinId],
  roles: ["owner", "reviewer"], visibility_scopes: ["private", "twin_shared", "team_shared", "org_shared"], knowledge_scope: "active_twin",
}, { ttlSeconds: 3600 });
if (!token) throw new Error("MEIDS_AUTH_CONTEXT_SIGNING_KEY is required.");

const routeDefinitions = [
  { id: "answer_direct", message: "Synthetic no-write route soak. Reply only with ready. Do not call tools or retain this interaction.", expected: ["actor_twin"], override: { route: "answer_direct", critical_faculty: false } },
  { id: "retrieve_knowledge", message: "Synthetic no-write route soak. Find this deliberately unknown fact in reviewed evidence; return not_found and one question without speculation.", expected: ["knowledge_fabric_agent"], override: { route: "retrieve_knowledge", critical_faculty: false } },
  { id: "execute_work_sync", message: "Synthetic no-write route soak. Check that alpha, beta, gamma are alphabetically ordered and return the result. Do not persist or perform external actions.", expected: ["agentic_butler"], override: { route: "execute_work_sync", skill_orchestrator: false, max_task_agent_calls: 0, critical_faculty: false } },
];

function envelope(definition, index) {
  const requestId = `${runId}_${definition.id}_${index}`;
  return {
    envelope_version: "0.1.0", request_id: requestId, timestamp: new Date().toISOString(), agent_id: "actor_twin", intent: "live_probe",
    principal: { tenant_id: tenantId, user_id: userId, roles: ["owner", "reviewer"] },
    input: { message: definition.message, no_write: true }, chatInput: definition.message,
    context: { active_twin_id: twinId, allowed_twin_ids: [twinId], trace_chain_id: requestId },
    metadata: {
      source: "run-seven-agent-no-write-uat", probe_suite: "azure-native-route-soak", intent: "live_probe", side_effect_policy: "no_write_probe",
      routingHints: { noWriteProbe: true, evidenceFirst: true }, routingContractOverride: definition.override,
      identity: { tenantId, userId, activeTwinId: twinId, allowedTwinIds: [twinId] },
      authorization: { contract: "meids.knowledge-access.v1", knowledgeAccessToken: token, knowledgeScope: "active_twin", handling: "opaque_backend_credential_do_not_prompt_or_log" },
    },
  };
}

async function fetchJson(url, options, timeoutMs) {
  const started = Date.now();
  try {
    const response = await fetch(url, { ...options, headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(options?.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) });
    const raw = await response.text();
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    return { response, body, duration_ms: Date.now() - started };
  } catch (error) {
    return { error, duration_ms: Date.now() - started };
  }
}

function classifyError(result) {
  if (result.error?.name === "TimeoutError" || result.error?.name === "AbortError") return "timeout";
  return "failed";
}

async function runForeground(definition, index) {
  const result = await fetchJson(`${baseUrl}/api/agents/actor-twin/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(envelope(definition, index)),
  }, ROUTE_SLOS[definition.id].p90_critical_ms + 5_000);
  if (result.error) return { route_id: definition.id, status: classifyError(result), duration_ms: result.duration_ms, http_status: 0 };
  const response = result.body?.response || {};
  const roles = response.trace?.role_executions || [];
  const observed = new Set(roles.map((item) => item.agent));
  const route = response.output?.route_decision?.route || "";
  const valid = result.response.ok && response.status === "completed" && response.trace?.runtime === "azure_native"
    && route === definition.id && definition.expected.every((role) => observed.has(role));
  return { route_id: definition.id, status: valid ? "completed" : "failed", duration_ms: result.duration_ms, http_status: result.response.status, observed_route: route, runtime: response.trace?.runtime || "", provider_throttle_retries: Number(response.trace?.provider_throttle_retries || 0), provider_throttle_rejections: Number(response.trace?.provider_throttle_rejections || 0), roles: [...observed] };
}

async function runAsync(index) {
  const routeId = "execute_work_async_ack";
  const message = "Synthetic no-write route soak: research two reversible options, compare them, then prepare a concise recommendation. Do not persist, publish, send, activate, or perform external effects.";
  const idempotencyKey = `${runId}_async_${index}`;
  const ack = await fetchJson(`${baseUrl}/api/agents/work`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ twin_id: twinId, message, knowledge_access_token: token, idempotency_key: idempotencyKey, session_id: runId }),
  }, ROUTE_SLOS[routeId].p90_critical_ms + 5_000);
  if (ack.error) return { route_id: routeId, status: classifyError(ack), duration_ms: ack.duration_ms, http_status: 0 };
  const jobId = String(ack.body?.job_id || "");
  if (ack.response.status !== 202 || !jobId) return { route_id: routeId, status: "failed", duration_ms: ack.duration_ms, http_status: ack.response.status };
  const completionStarted = Date.now();
  let terminal = "unknown_completion";
  let attempts = 0;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const poll = await fetchJson(`${baseUrl}/api/agents/work?twin=${encodeURIComponent(twinId)}&job=${encodeURIComponent(jobId)}`, {}, 15_000);
    if (poll.error || !poll.response.ok) { terminal = classifyError(poll); break; }
    attempts = Number(poll.body?.attempts || 0);
    if (["completed", "failed", "cancelled", "unknown_completion"].includes(poll.body?.status)) { terminal = poll.body.status; break; }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return {
    route_id: routeId, status: terminal === "completed" ? "completed" : terminal,
    duration_ms: ack.duration_ms, acknowledgement_ms: ack.duration_ms, completion_ms: Date.now() - completionStarted,
    http_status: ack.response.status, attempts,
  };
}

async function runLearning(index) {
  const routeId = "detached_learning";
  const traceId = `${runId}_learning_${index}`;
  const accepted = await fetchJson(`${baseUrl}/api/learning/post-turn`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ knowledge_access_token: token, twin_id: twinId, request_id: `${traceId}_request`, trace_id: traceId, source_agent_id: "actor_twin", source_type: "synthetic_no_write_probe", source_interaction_summary: "Synthetic route soak Learning proposal; do not persist.", target_review_state: "review_needed", dry_run: true }),
  }, 10_000);
  if (accepted.error) return { route_id: routeId, status: classifyError(accepted), duration_ms: accepted.duration_ms, http_status: 0 };
  const jobId = String(accepted.body?.job_id || "");
  if (accepted.response.status !== 202 || !jobId) return { route_id: routeId, status: "failed", duration_ms: accepted.duration_ms, http_status: accepted.response.status };
  const started = Date.now();
  let latest = null;
  while (Date.now() - started < 120_000) {
    latest = await fetchJson(`${baseUrl}/api/learning/post-turn/status?twin=${encodeURIComponent(twinId)}&job=${encodeURIComponent(jobId)}`, {}, 15_000);
    if (latest.error || !latest.response.ok || ["completed", "dead_letter", "cancelled", "unknown_completion"].includes(latest.body?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const result = latest?.body?.result || {};
  const guard = result.domain_write_guard || {};
  const valid = latest?.body?.status === "completed" && result.status === "proposed_no_write" && result.review_state === "not_persisted"
    && result.dry_run === true && guard.unchanged === true && guard.before_digest && guard.before_digest === guard.after_digest;
  return { route_id: routeId, status: valid ? "completed" : latest?.body?.status === "cancelled" ? "cancelled" : latest?.body?.status === "unknown_completion" ? "unknown_completion" : "failed", duration_ms: accepted.duration_ms + (Date.now() - started), acknowledgement_ms: accepted.duration_ms, completion_ms: Date.now() - started, http_status: accepted.response.status, attempts: Number(latest?.body?.attempts || 0) };
}

(async () => {
  const generatedAt = new Date().toISOString();
  const results = [];
  for (let index = 0; index < samples; index += 1) {
    for (const definition of routeDefinitions) results.push(await runForeground(definition, index));
    results.push(await runAsync(index));
    results.push(await runLearning(index));
    process.stdout.write(`Completed soak iteration ${index + 1}/${samples}\n`);
  }
  const targets = { ...ROUTE_SLOS, detached_learning: { p90_warning_ms: 60_000, p90_critical_ms: 120_000 } };
  const summaries = Object.keys(targets).filter((route) => routeDefinitions.some((item) => item.id === route) || ["execute_work_async_ack", "detached_learning"].includes(route))
    .map((route) => summarizeRoute(route, results, targets[route]));
  const artifact = {
    schema_version: "1.0.0", contract: "meids.azure-native-route-soak.v1", generated_at: generatedAt, run_id: runId,
    candidate: { backend: baseUrl, runtime: "azure_native", slo_contract: "meids.agent-slo.v1" },
    window: { mode: "serial_warm", samples_per_route: samples, target_samples_per_route: 100, route_count: summaries.length },
    summary: { status: summaries.every((item) => item.status === "passed") ? "passed" : "failed", routes_passed: summaries.filter((item) => item.status === "passed").length, routes_total: summaries.length },
    routes: summaries,
    results,
    boundary: "Public-safe synthetic no-write performance metadata. No prompts, answers, tokens, identities, private knowledge, or job identifiers are stored.",
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ status: artifact.summary.status, output: path.relative(root, outputPath).replaceAll("\\", "/"), window: artifact.window, routes: summaries }, null, 2));
  if (artifact.summary.status !== "passed") process.exitCode = 1;
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
