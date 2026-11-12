#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { signKnowledgeAccessToken } = require("../backend/knowledgeAccess");
const { REQUIRED_AGENTS, evaluateAzureNativeNightly } = require("./lib/azure-native-nightly-verdict.cjs");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, "docs", "uat", "azure-native-seven-agent-no-write-uat.json");
const baseUrl = String(process.env.MEIDS_BACKEND_BASE_URL || "https://meids-prod-backend-1853a19b.azurewebsites.net").replace(/\/+$/, "");
const tenantId = String(process.env.MEIDS_UAT_TENANT_ID || "eraneos").trim();
const userId = String(process.env.MEIDS_UAT_USER_ID || "").trim();
const twinId = String(process.env.MEIDS_UAT_TWIN_ID || "").trim();
const runId = `azure_native_nightly_${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}`;

if (!userId || !twinId) throw new Error("MEIDS_UAT_USER_ID and MEIDS_UAT_TWIN_ID are required.");
const token = signKnowledgeAccessToken({
  tenant_id: tenantId,
  user_id: userId,
  active_twin_id: twinId,
  allowed_twin_ids: [twinId],
  roles: ["owner", "reviewer"],
  visibility_scopes: ["private", "twin_shared", "team_shared", "org_shared"],
  knowledge_scope: "active_twin",
}, { ttlSeconds: 1800 });
if (!token) throw new Error("MEIDS_AUTH_CONTEXT_SIGNING_KEY is required for scoped Azure-native probes.");

const baseMetadata = {
  source: "run-seven-agent-no-write-uat",
  intent: "live_probe",
  side_effect_policy: "no_write_probe",
  routingHints: { noWriteProbe: true, evidenceFirst: true },
  identity: { tenantId, userId, activeTwinId: twinId, allowedTwinIds: [twinId] },
  authorization: {
    contract: "meids.knowledge-access.v1",
    knowledgeAccessToken: token,
    knowledgeScope: "active_twin",
    handling: "opaque_backend_credential_do_not_prompt_or_log",
  },
};

function envelope(id, message, metadata = {}) {
  return {
    envelope_version: "0.1.0",
    request_id: `${runId}_${id}`,
    timestamp: new Date().toISOString(),
    agent_id: "actor_twin",
    intent: "live_probe",
    principal: { tenant_id: tenantId, user_id: userId, roles: ["owner", "reviewer"] },
    input: { message, no_write: true },
    chatInput: message,
    context: { active_twin_id: twinId, allowed_twin_ids: [twinId], trace_chain_id: `${runId}_${id}` },
    metadata: { ...baseMetadata, ...metadata },
  };
}

const scenarios = [
  {
    id: "actor_direct",
    message: "Synthetic no-write readiness probe. Reply briefly that the Azure-native Actor Twin direct path is ready. Do not call tools or retain this interaction.",
    expectedRoles: ["actor_twin"],
  },
  {
    id: "knowledge_retrieval",
    message: "What reviewed evidence does my active twin contain about this deliberately unknown nightly probe fact? Cite matching evidence or return not_found and ask exactly one question. Do not retain this interaction.",
    expectedRoles: ["knowledge_fabric_agent"],
  },
  {
    id: "conditional_critical_faculty",
    message: "Synthetic no-write probe: review the reversible decision to choose option A because it has lower latency. Return a concise corrected recommendation and do not persist or perform external actions.",
    expectedRoles: ["critical_faculty"],
    metadata: {
      routingContractOverride: { route: "execute_work_sync", skill_orchestrator: false, max_task_agent_calls: 0, critical_faculty: true },
    },
  },
  {
    id: "butler_skill_task_chain",
    message: "Synthetic no-write probe: plan and execute one in-memory task that checks alpha, beta, gamma are alphabetically ordered, then summarize the result. Do not persist or perform external actions.",
    expectedRoles: ["agentic_butler", "skill_orchestrator", "task_agent"],
    metadata: {
      routingContractOverride: { route: "execute_work_sync", skill_orchestrator: true, max_task_agent_calls: 1 },
    },
  },
];

async function requestJson(url, options = {}, timeoutMs = 100_000) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw: raw.slice(0, 1_000) }; }
  if (!response.ok) {
    const error = new Error(body.error || body.detail || `Request returned ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return { status: response.status, body };
}

function roleExecutions(body) {
  return body?.response?.trace?.role_executions || body?.trace?.response?.trace?.role_executions || [];
}

async function runAgentScenario(scenario) {
  const started = Date.now();
  try {
    const result = await requestJson(`${baseUrl}/api/agents/actor-twin/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope(scenario.id, scenario.message, scenario.metadata || {})),
    });
    const executions = roleExecutions(result.body);
    const observed = new Set(executions.map((item) => item.agent));
    const missing = scenario.expectedRoles.filter((role) => !observed.has(role));
    const runtime = result.body?.response?.trace?.runtime || result.body?.trace?.runtime || "";
    const answer = String(result.body?.response?.output?.answer || "");
    const semanticOk = scenario.id !== "knowledge_retrieval"
      || /not[_ -]?found|not found|nicht gefunden|\[[^\]]+\]/i.test(answer);
    return {
      id: scenario.id,
      status: !missing.length && runtime === "azure_native" && semanticOk ? "completed" : "failed",
      http_status: result.status,
      duration_ms: Date.now() - started,
      runtime,
      route: result.body?.response?.output?.route_decision?.route || "",
      request_id: result.body?.response?.request_id || "",
      trace_id: result.body?.trace?.trace_id || result.body?.response?.trace?.trace_id || "",
      provider: result.body?.response?.trace?.provider || "",
      model: result.body?.response?.trace?.model || "",
      role_executions: executions,
      expected_roles: scenario.expectedRoles,
      missing_roles: missing,
      semantic_assertion: semanticOk ? "passed" : "failed",
      response_status: result.body?.response?.status || "",
    };
  } catch (error) {
    return { id: scenario.id, status: "failed", duration_ms: Date.now() - started, error: error.message, http_status: error.status || 0 };
  }
}

async function runLearningScenario() {
  const started = Date.now();
  const traceId = `${runId}_learning`;
  try {
    const accepted = await requestJson(`${baseUrl}/api/learning/post-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        knowledge_access_token: token,
        twin_id: twinId,
        request_id: `${runId}_learning_request`,
        trace_id: traceId,
        source_agent_id: "actor_twin",
        source_type: "synthetic_no_write_probe",
        source_interaction_summary: "Synthetic no-write Learning Agent readiness probe. Produce a proposal but do not persist it.",
        target_review_state: "review_needed",
        dry_run: true,
      }),
    }, 15_000);
    const jobId = String(accepted.body.job_id || "");
    if (accepted.status !== 202 || !jobId) throw new Error("Learning dispatch did not return a durable Azure-native job ID.");
    const deadline = Date.now() + 90_000;
    let latest = null;
    while (Date.now() < deadline) {
      latest = await requestJson(`${baseUrl}/api/learning/post-turn/status?twin=${encodeURIComponent(twinId)}&job=${encodeURIComponent(jobId)}`, {}, 15_000);
      if (["completed", "dead_letter", "cancelled"].includes(latest.body.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 2_500));
    }
    const result = latest?.body?.result || {};
    const completed = latest?.body?.status === "completed"
      && result.status === "proposed_no_write"
      && result.review_state === "not_persisted"
      && result.dry_run === true
      && result.role_executions?.some((item) => item.agent === "learning_agent");
    return {
      id: "learning_agent",
      status: completed ? "completed" : "failed",
      http_status: accepted.status,
      duration_ms: Date.now() - started,
      runtime: accepted.body.runtime || "",
      trace_id: traceId,
      job_id: jobId,
      job_status: latest?.body?.status || "timeout",
      attempts: latest?.body?.attempts || 0,
      role_executions: result.role_executions || [],
      expected_roles: ["learning_agent"],
      missing_roles: completed ? [] : ["learning_agent"],
      persistence: result.review_state || "unknown",
      result_status: result.status || "",
      error: completed ? "" : latest?.body?.error || "Learning job did not complete as a non-persisting proposal within 90 seconds.",
    };
  } catch (error) {
    return { id: "learning_agent", status: "failed", duration_ms: Date.now() - started, error: error.message, http_status: error.status || 0 };
  }
}

(async () => {
  const results = [];
  for (const scenario of scenarios) {
    process.stdout.write(`Running ${scenario.id}...\n`);
    results.push(await runAgentScenario(scenario));
  }
  process.stdout.write("Running learning_agent...\n");
  results.push(await runLearningScenario());
  const requiredAgents = REQUIRED_AGENTS;
  const observedAgents = [...new Set(results.flatMap((result) => result.role_executions || []).map((item) => item.agent))];
  const artifact = {
    schema_version: "1.0.0",
    generated_at: new Date().toISOString(),
    run_id: runId,
    runtime: "azure_native",
    policy: "Synthetic no-write probes. Operational traces and a dry-run job may be recorded; no knowledge, Learning increment, approval, publication, activation, or external effect is created.",
    summary: {
      scenario_count: results.length,
      completed_scenarios: results.filter((item) => item.status === "completed").length,
      required_agent_count: requiredAgents.length,
      observed_agent_count: requiredAgents.filter((agent) => observedAgents.includes(agent)).length,
    },
    required_agents: requiredAgents,
    observed_agents: observedAgents,
    results,
    boundary: "Public-safe execution metadata only. Tokens, prompts, answers, private knowledge, and identities are not stored.",
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  const verdict = evaluateAzureNativeNightly(artifact);
  console.log(JSON.stringify({ status: verdict.passed ? "completed" : "partial", output: path.relative(root, outputPath).replaceAll("\\", "/"), summary: artifact.summary, issues: verdict.issues }, null, 2));
  if (!verdict.passed) process.exitCode = 1;
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
