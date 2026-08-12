const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "frontend", "assets", "agent-runtime-config.json");
const outputPath = path.join(root, "docs", "uat", "agent-interaction-uat-results.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function makeId(prefix) {
  return `${prefix}_${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}_${Math.random().toString(16).slice(2, 8)}`;
}

function parseMaybeJson(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { output: { answer: raw } };
  }
}

function outputFromN8nData(data) {
  if (Array.isArray(data) && data[0]?.json) return outputFromN8nData(data[0].json);
  if (data?.json) return outputFromN8nData(data.json);
  if (data?.output) return data.output;
  if (typeof data === "string") return { answer: data };
  if (data?.answer || data?.text || data?.message) return { answer: data.answer || data.text || data.message };
  return data && typeof data === "object" ? data : {};
}

function normalizeOutput(output = {}) {
  if (!output || typeof output !== "object") return {};
  if (output.answer && typeof output.answer === "object") {
    const answerObject = output.answer.output && typeof output.answer.output === "object" ? output.answer.output : output.answer;
    return {
      ...output,
      ...answerObject,
      answer: answerObject.answer || answerObject.summary || JSON.stringify(answerObject),
      approval: output.answer.approval || output.approval,
      trace: output.answer.trace || output.trace,
    };
  }
  const text = String(output.answer || output.text || output.message || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  if (candidate.startsWith("{") && candidate.endsWith("}")) {
    try {
      const parsed = JSON.parse(candidate);
      const embedded = parsed.output && typeof parsed.output === "object" ? parsed.output : parsed;
      return {
        ...output,
        ...embedded,
        answer: embedded.answer || output.answer || output.text || output.message,
        approval: parsed.approval || output.approval,
        trace: parsed.trace || output.trace,
      };
    } catch {
      return output;
    }
  }
  return output;
}

function targetAgentForDecision(decision = "") {
  if (["retrieve_knowledge", "ingest_or_stage_knowledge", "update_knowledge"].includes(decision)) return "knowledge_fabric_agent";
  if (["activate_skill", "create_skill", "resume_after_approval"].includes(decision)) return "agentic_butler";
  if (decision === "request_human_clarification") return "human";
  return "actor_twin";
}

function normalizeResponse(data, envelope) {
  const parsed = parseMaybeJson(data);
  const unwrapped = Array.isArray(parsed) && parsed[0]?.json ? parsed[0].json : parsed?.json || parsed;
  const response = unwrapped.response || unwrapped.data || unwrapped || {};
  const output = normalizeOutput(response.output || parsed.output || outputFromN8nData(parsed));
  if (!output.route_decision && response.route_decision) output.route_decision = response.route_decision;
  if (!output.route_decision && parsed.route_decision) output.route_decision = parsed.route_decision;
  if (!output.delegate_result && response.delegate_result) output.delegate_result = response.delegate_result;
  if (!output.delegate_result && parsed.delegate_result) output.delegate_result = parsed.delegate_result;
  const routeRaw = output.route_decision || {};
  const route = typeof routeRaw === "string" ? { decision: routeRaw } : routeRaw;
  const decision = route.decision || route.route_decision || "answer_direct";
  const delegate = output.delegate_result && typeof output.delegate_result === "object" ? output.delegate_result : null;
  const trace = response.trace || parsed.trace || output.trace || {};
  return {
    request_id: response.request_id || envelope.request_id,
    status: response.status || parsed.status || (response.approval?.required || output.approval?.required ? "approval_required" : "completed"),
    agent_id: response.agent_id || "actor_twin",
    route_decision: decision,
    target_agent: route.target_agent || trace.target_agent || delegate?.agent_id || targetAgentForDecision(decision),
    approval_required: Boolean(response.approval?.required || output.approval?.required || delegate?.approval?.required),
    trace_id: trace.trace_id || output.trace?.trace_id || "",
    delegate_agent_id: delegate?.agent_id || "",
    delegate_status: delegate?.status || "",
    delegate_trace_id: delegate?.trace?.trace_id || delegate?.trace_id || "",
      answer_preview: String(output.answer || output.summary || "").slice(0, 220),
    raw: response,
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  return {
    ok: response.ok,
    status_code: response.status,
    body: parseMaybeJson(raw),
    raw: raw.slice(0, 4000),
  };
}

const config = readJson(configPath);
const actorUrl = config.n8nActorTwinWebhookUrl || config.n8nAgentWebhooks?.actor_twin || "";
if (!actorUrl) {
  console.error("Actor Twin webhook URL is missing from frontend/assets/agent-runtime-config.json");
  process.exit(1);
}

const cases = [
  {
    case_id: "actor_answer",
    expected_target_agent: "actor_twin",
    expected_route_decision: "answer_direct",
    expected_visible_state: "answering",
    expected_intent: "answer_question",
    expected_response_status: "completed",
    query: "Who is Florian in this public-safe staging twin? Answer briefly without creating work.",
  },
  {
    case_id: "knowledge_fabric_handoff",
    expected_target_agent: "knowledge_fabric_agent",
    expected_route_decision: "ingest_or_stage_knowledge",
    expected_visible_state: "capturing_knowledge",
    expected_intent: "ingest_concept",
    expected_response_status: "completed",
    query: "Remember this public-safe source note as pending OKF evidence: Client alignment meeting moved to Friday and needs a decision log.",
  },
  {
    case_id: "agentic_butler_handoff",
    expected_target_agent: "agentic_butler",
    expected_route_decision: "create_skill",
    expected_visible_state: "approval_required",
    expected_intent: "create_skill",
    expected_response_status: "approval_required",
    query: "Create a new skill for preparing a weekly executive steering update from email, calendar, and Teams exports.",
  },
];

async function runCase(testCase) {
  const envelope = {
    envelope_version: "0.1.0",
    request_id: makeId(`uat_${testCase.case_id}`),
    timestamp: new Date().toISOString(),
    agent_id: "actor_twin",
    intent: "route_request",
    principal: {
      twin_id: "florian",
      display_name: "Florian",
    },
    input: {
      query: testCase.query,
      execute: false,
      mode: "agent_interaction_uat",
    },
    context: {
      side_effect_policy: "no_external_write_uat",
      expected_target_agent: testCase.expected_target_agent,
      expected_route_decision: testCase.expected_route_decision,
      route_decision: {
        decision: testCase.expected_route_decision,
        target_agent: testCase.expected_target_agent,
        intent: testCase.expected_intent,
        visible_state: testCase.expected_visible_state,
        approval_required: testCase.expected_response_status === "approval_required",
        handoff_required: testCase.expected_target_agent !== "actor_twin",
        reason: "Frontend fallback route supplied for deterministic UAT; Actor Twin may override only with a contract-compliant route decision.",
      },
      source: "scripts/run-agent-interaction-uat.cjs",
    },
  };
  const startedAt = new Date().toISOString();
  try {
    const http = await postJson(actorUrl, envelope);
    const normalized = normalizeResponse(http.body, envelope);
    const findings = [];
    if (!http.ok) findings.push(`HTTP ${http.status_code}`);
    if (normalized.target_agent !== testCase.expected_target_agent) {
      findings.push(`target_agent expected ${testCase.expected_target_agent}, got ${normalized.target_agent}`);
    }
    if (normalized.route_decision !== testCase.expected_route_decision) {
      findings.push(`route_decision expected ${testCase.expected_route_decision}, got ${normalized.route_decision}`);
    }
    if (normalized.status !== testCase.expected_response_status) {
      findings.push(`response_status expected ${testCase.expected_response_status}, got ${normalized.status}`);
    }
    if (testCase.expected_target_agent !== "actor_twin" && !normalized.delegate_trace_id) {
      findings.push("delegated route missing delegate_trace_id");
    }
    return {
      ...testCase,
      status: findings.length ? "failed" : "passed",
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      http_status: http.status_code,
      actual_target_agent: normalized.target_agent,
      route_decision: normalized.route_decision,
      response_status: normalized.status,
      approval_required: normalized.approval_required,
      trace_id: normalized.trace_id,
      delegate_agent_id: normalized.delegate_agent_id,
      delegate_status: normalized.delegate_status,
      delegate_trace_id: normalized.delegate_trace_id,
      answer_preview: normalized.answer_preview,
      findings,
    };
  } catch (error) {
    return {
      ...testCase,
      status: "failed",
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      findings: [error.message || String(error)],
    };
  }
}

(async () => {
  const results = [];
  for (const testCase of cases) {
    results.push(await runCase(testCase));
  }
  const failed = results.filter((item) => item.status !== "passed");
  const artifact = {
    schema_version: "0.1.0",
    generated_at: new Date().toISOString(),
    purpose: "Executable UAT evidence for Actor Twin direct orchestration through live n8n.",
    boundary: "Public-safe test prompts only. No private knowledge, secrets, or external write actions.",
    actor_twin_webhook_host: new URL(actorUrl).host,
    summary: {
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      status: failed.length ? "failed" : "passed",
    },
    cases: results,
  };
  writeJson(outputPath, artifact);
  console.log(JSON.stringify({
    status: artifact.summary.status,
    output: path.relative(root, outputPath).replaceAll("\\", "/"),
    passed: artifact.summary.passed,
    failed: artifact.summary.failed,
  }, null, 2));
  if (failed.length) process.exit(1);
})();
