#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { signKnowledgeAccessToken } = require("../backend/knowledgeAccess");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, "docs", "uat", "n8n-seven-agent-no-write-uat.json");
const runtime = JSON.parse(fs.readFileSync(path.join(root, "frontend", "assets", "agent-runtime-config.json"), "utf8"));
const actorUrl = String(runtime.n8nActorTwinWebhookUrl || runtime.n8nAgentWebhooks?.actor_twin || "").trim();
const n8nOrigin = actorUrl ? new URL(actorUrl).origin : "";
const userId = String(process.env.MEIDS_UAT_USER_ID || "").trim();
const twinId = String(process.env.MEIDS_UAT_TWIN_ID || "").trim();
const tenantId = String(process.env.MEIDS_UAT_TENANT_ID || "eraneos").trim();

if (!actorUrl) throw new Error("Actor Twin webhook URL is not configured.");
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
if (!token) throw new Error("MEIDS_AUTH_CONTEXT_SIGNING_KEY is required for scoped retrieval probes.");

const runId = `launch_gate_${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}`;
const scenarios = [
  {
    id: "actor_direct",
    url: actorUrl,
    query: "No-write launch probe: report Actor Twin routing readiness only. Do not call tools and do not persist anything.",
  },
  {
    id: "knowledge_retrieval",
    url: actorUrl,
    query: "No-write launch probe: call Knowledge Fabric Agent with operation=retrieve for the active twin and report only whether scoped reviewed retrieval is reachable. Do not stage, update, merge, approve, or persist knowledge.",
  },
  {
    id: "critical_faculty",
    url: actorUrl,
    query: "No-write launch probe: ask Critical Faculty Agent to critique this synthetic reversible decision: choose option A because it has lower latency. Return its recommendation without taking action or persisting knowledge.",
  },
  {
    id: "butler_skill_task_chain",
    url: actorUrl,
    query: "No-write launch probe: delegate to Agentic Butler, which must call Skill Orchestrator and exactly one Task Agent for an in-memory dry run that checks the three words alpha, beta, gamma are alphabetically ordered. Do not use GitHub, send, schedule, publish, persist, or activate anything.",
  },
  {
    id: "learning_agent",
    url: `${n8nOrigin}/webhook/meids/learning/dispatch`,
    body: {
      query: "No-write readiness probe only. Confirm the Learning Agent can synthesize a synthetic lesson, but do not call Knowledge Fabric and do not stage or persist output.",
      dispatch_type: "live_probe",
      input: { execute: false },
      context: { side_effect_policy: "no_write_probe", tenant_id: tenantId, user_id: userId, twin_id: twinId },
      trace: { trace_id: `${runId}_learning`, twin_id: twinId, input_summary: "synthetic probe", output_summary: "synthetic probe" },
    },
  },
];

function actorBody(scenario) {
  return {
    action: "sendMessage",
    sessionId: `${runId}_${scenario.id}`,
    chatInput: scenario.query,
    metadata: {
      source: "run-seven-agent-no-write-uat",
      interfaceContract: "meids.actor_twin.embedded_chat.v1",
      activeTwin: twinId,
      identity: { tenantId, userId, activeTwinId: twinId, allowedTwinIds: [twinId] },
      authorization: {
        contract: "meids.knowledge-access.v1",
        knowledgeAccessToken: token,
        knowledgeScope: "active_twin",
        handling: "opaque_backend_credential_do_not_prompt_or_log",
      },
      intent: "live_probe",
      input: { execute: false },
      side_effect_policy: "no_write_probe",
      routingHints: { evidenceFirst: true, noWriteProbe: true },
    },
  };
}

async function postScenario(scenario) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 240_000);
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(scenario.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scenario.body || actorBody(scenario)),
      signal: controller.signal,
    });
    const raw = await response.text();
    return {
      id: scenario.id,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      status: response.ok ? "completed" : "failed",
      http_status: response.status,
      response_preview: raw.replaceAll(token, "[redacted]").slice(0, 1200),
    };
  } catch (error) {
    return {
      id: scenario.id,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      status: "failed",
      error: error.name === "AbortError" ? "Timed out after 240 seconds" : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

(async () => {
  const results = [];
  for (const scenario of scenarios) {
    process.stdout.write(`Running ${scenario.id}...\n`);
    results.push(await postScenario(scenario));
  }
  const artifact = {
    schema_version: "0.1.0",
    generated_at: new Date().toISOString(),
    run_id: runId,
    policy: "Synthetic no-write probes. Requests must not stage, approve, merge, publish, send, schedule, or delete data.",
    results,
  };
  const learning = results.find((item) => item.id === "learning_agent");
  if (learning && ![200, 202].includes(learning.http_status)) {
    learning.status = "failed";
    learning.error = `Learning Agent dispatch must acknowledge immediately with HTTP 200 or 202, received ${learning.http_status || 0}.`;
  }
  if (learning && /firstEntryJson/.test(learning.response_preview || "")) {
    learning.status = "failed";
    learning.error = "Learning Agent dispatch returned the obsolete literal firstEntryJson response.";
  }
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({
    status: results.every((item) => item.status === "completed") ? "completed" : "partial",
    output: path.relative(root, outputPath).replaceAll("\\", "/"),
    scenarios: results.map((item) => ({ id: item.id, status: item.status, http_status: item.http_status || 0 })),
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
