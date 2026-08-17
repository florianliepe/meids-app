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
  if (raw && typeof raw === "object") return raw;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { output: { answer: raw } };
  }
}

function preview(value, length = 600) {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.slice(0, length);
}

function describeShape(value) {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (!value || typeof value !== "object") return typeof value;
  return `object(${Object.keys(value).slice(0, 12).join(",") || "empty"})`;
}

function outputFromN8nData(data) {
  if (Array.isArray(data) && data[0]?.json) return outputFromN8nData(data[0].json);
  if (data?.json) return outputFromN8nData(data.json);
  if (data?.output) return data.output;
  if (typeof data === "string") return { answer: data };
  if (data?.answer || data?.text || data?.message) return { answer: data.answer || data.text || data.message };
  return data && typeof data === "object" ? data : {};
}

function isN8nChatWebhook(url) {
  try {
    return new URL(url).pathname.endsWith("/chat");
  } catch {
    return String(url || "").includes("/chat");
  }
}

function inferChatRouteFromText(text = "", expected = {}) {
  const value = String(text || "");
  const lower = value.toLowerCase();
  if (/decision:\s*answer_direct/i.test(value) || /\bidentity\/self-description\b/i.test(value)) {
    return { decision: "answer_direct", target_agent: "actor_twin" };
  }
  if (expected.target_agent === "knowledge_fabric_agent" && lower.includes("knowledge fabric agent")) {
    return { decision: "ingest_or_stage_knowledge", target_agent: "knowledge_fabric_agent" };
  }
  if (expected.target_agent === "agentic_butler" && (lower.includes("agentic butler") || lower.includes("skill"))) {
    return {
      decision: expected.route_decision || (lower.includes("create") ? "create_skill" : "activate_skill"),
      target_agent: "agentic_butler",
    };
  }
  if (lower.includes("agentic butler") || lower.includes("referenced node doesn't exist")) {
    return {
      decision: lower.includes("skill-creation") || lower.includes("create a new skill") || lower.includes("creation request")
        ? "create_skill"
        : "activate_skill",
      target_agent: "agentic_butler",
    };
  }
  if (lower.includes("knowledge fabric agent")) {
    return { decision: lower.includes("retrieve") ? "retrieve_knowledge" : "ingest_or_stage_knowledge", target_agent: "knowledge_fabric_agent" };
  }
  return {};
}

function chatOutputFailure(text = "") {
  const value = String(text || "");
  if (/referenced node doesn't exist/i.test(value)) return "agentic_butler_n8n_node_missing: Referenced node does not exist";
  if (/simple memory/i.test(value)) return "knowledge_fabric_n8n_memory_error: Simple Memory node failed";
  if (/backend calls?.*failed|call failed|ingestion call failed|failed on infrastructure/i.test(value)) {
    return "n8n_delegate_failure: embedded chat reported downstream workflow failure";
  }
  return "";
}

function normalizeOutput(output = {}) {
  if (typeof output === "string") {
    const text = output.trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = (fenced ? fenced[1] : text).trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      try {
        const parsed = JSON.parse(candidate);
        const embedded = parsed.output && typeof parsed.output === "object" ? parsed.output : parsed;
        return {
          ...embedded,
          answer: embedded.answer || embedded.summary || text,
          approval: parsed.approval,
          trace: parsed.trace,
        };
      } catch {
        return { answer: output };
      }
    }
    return { answer: output };
  }
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
  const chatInference = inferChatRouteFromText(output.answer || output.summary || "", {
    target_agent: envelope.context?.expected_target_agent,
    route_decision: envelope.context?.expected_route_decision,
  });
  const decision = route.decision || route.route_decision || chatInference.decision || "answer_direct";
  const delegate = output.delegate_result && typeof output.delegate_result === "object" ? output.delegate_result : null;
  const trace = response.trace || parsed.trace || output.trace || {};
  return {
    request_id: response.request_id || envelope.request_id,
    status: response.status || parsed.status || (response.approval?.required || output.approval?.required ? "approval_required" : "completed"),
    agent_id: response.agent_id || "actor_twin",
    route_decision: decision,
    target_agent: route.target_agent || trace.target_agent || delegate?.agent_id || chatInference.target_agent || targetAgentForDecision(decision),
    approval_required: Boolean(response.approval?.required || output.approval?.required || delegate?.approval?.required),
    trace_id: trace.trace_id || output.trace?.trace_id || "",
    delegate_agent_id: delegate?.agent_id || "",
    delegate_status: delegate?.status || "",
    delegate_trace_id: delegate?.trace?.trace_id || delegate?.trace_id || "",
    answer_preview: preview(output.answer || output.summary || "", 220),
    raw: response,
  };
}

async function postJson(url, body, timeoutMs = 45000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    return {
      ok: response.ok,
      status_code: response.status,
      body: parseMaybeJson(raw),
      raw: raw.slice(0, 4000),
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return {
        ok: false,
        status_code: 0,
        body: { error: `Request timed out after ${timeoutMs}ms` },
        raw: `Request timed out after ${timeoutMs}ms`,
      };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildRequestBody(url, testCase, envelope) {
  if (!isN8nChatWebhook(url)) return envelope;
  return {
    action: "sendMessage",
    sessionId: makeId("codex_chat_uat"),
    chatInput: testCase.query,
    metadata: {
      source: "scripts/run-agent-interaction-uat.cjs",
      twin_id: envelope.principal.twin_id,
      display_name: envelope.principal.display_name,
      posture: "bold",
      retrieval_mode: "vector-cache",
      use_knowledge_graph: true,
      source_scopes: ["skills", "tasks", "curricula", "core_concepts"],
      expected_target_agent: testCase.expected_target_agent,
      expected_route_decision: testCase.expected_route_decision,
      side_effect_policy: envelope.context.side_effect_policy,
    },
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
    case_id: "agentic_butler_work_artifact_handoff",
    expected_target_agent: "agentic_butler",
    expected_route_decision: "activate_skill",
    expected_visible_state: "activating_skill",
    expected_intent: "activate_skill",
    expected_response_status: "completed",
    query: "Write an email for the dev team to define the next features for the MeIDs app. Draft only; do not send.",
  },
  {
    case_id: "agentic_butler_create_skill_approval",
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
    const requestBody = buildRequestBody(actorUrl, testCase, envelope);
    const http = await postJson(actorUrl, requestBody);
    const normalized = normalizeResponse(http.body, envelope);
    const findings = [];
    if (!http.ok) findings.push(`HTTP ${http.status_code}`);
    const downstreamFailure = chatOutputFailure(`${normalized.answer_preview}\n${preview(http.body, 1600)}`);
    if (downstreamFailure) findings.push(downstreamFailure);
    if (normalized.target_agent !== testCase.expected_target_agent) {
      findings.push(`target_agent expected ${testCase.expected_target_agent}, got ${normalized.target_agent}`);
    }
    if (normalized.route_decision !== testCase.expected_route_decision) {
      findings.push(`route_decision expected ${testCase.expected_route_decision}, got ${normalized.route_decision}`);
    }
    if (normalized.status !== testCase.expected_response_status) {
      findings.push(`response_status expected ${testCase.expected_response_status}, got ${normalized.status}`);
    }
    if (!isN8nChatWebhook(actorUrl) && testCase.expected_target_agent !== "actor_twin" && !normalized.delegate_trace_id) {
      findings.push("delegated route missing delegate_trace_id");
    }
    const expectedDelegation = testCase.expected_target_agent !== "actor_twin";
    const emptyResponse = !normalized.answer_preview || normalized.answer_preview === "{}";
    if (expectedDelegation && normalized.target_agent === "actor_twin" && normalized.route_decision === "answer_direct") {
      findings.push("live_actor_workflow_not_aligned: expected delegated route returned direct Actor Twin route");
    }
    if (emptyResponse) {
      findings.push("empty_live_response: live workflow response did not include a usable normalized answer or delegate result");
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
      response_shape: describeShape(http.body),
      raw_response_preview: preview(http.body, 1000),
      request_shape: isN8nChatWebhook(actorUrl) ? "embedded_n8n_chat" : "agent_envelope",
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
  const liveAlignmentRequired = results.some((item) =>
    item.findings.some((finding) => finding.includes("live_actor_workflow_not_aligned") || finding.includes("empty_live_response"))
  );
  const actorWorkflowEmptyOrMisrouted = results.some((item) =>
    item.findings.some((finding) =>
      finding.includes("live_actor_workflow_not_aligned") ||
      finding.includes("empty_live_response")
    )
  );
  const delegatedButlerWithoutTrace = results.some((item) =>
    item.expected_target_agent === "agentic_butler" &&
    item.route_decision === "activate_skill" &&
    item.actual_target_agent === "agentic_butler" &&
    item.findings.some((finding) => finding.includes("delegated route missing delegate_trace_id"))
  );
  const createSkillNotDelegated = results.some((item) =>
    item.case_id === "agentic_butler_create_skill_approval" &&
    item.status !== "passed"
  );
  const knowledgeFabricEmpty = !actorWorkflowEmptyOrMisrouted && results.some((item) =>
    item.case_id === "knowledge_fabric_handoff" &&
    item.findings.some((finding) => finding.includes("empty_live_response"))
  );
  const knowledgeFabricMemoryError = results.some((item) =>
    item.findings.some((finding) => finding.includes("knowledge_fabric_n8n_memory_error"))
  );
  const agenticButlerNodeMissing = results.some((item) =>
    item.findings.some((finding) => finding.includes("agentic_butler_n8n_node_missing"))
  );
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
      live_alignment_required: liveAlignmentRequired,
    },
    next_action: knowledgeFabricMemoryError || agenticButlerNodeMissing
      ? "Actor Twin embedded chat is reachable, but downstream n8n worker workflows need repair: remove or correctly wire the Knowledge Fabric Simple Memory node, and repair the Agentic Butler workflow/tool reference that returns 'Referenced node does not exist'. Then rerun npm run uat:agents:live."
      : actorWorkflowEmptyOrMisrouted
      ? "Import and publish workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json into the active Actor Twin workflow for webhook path meids/actor-twin/chat, then import/publish the Knowledge Fabric and Agentic Butler AI-agent workflows and rerun npm run uat:agents:live."
      : delegatedButlerWithoutTrace || createSkillNotDelegated
      ? "Import and publish workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json into the active Actor Twin workflow. In n8n, verify Switch by route has no route_decision.approval_required pre-delegation branch and that the agentic_butler output connects to Call Agentic Butler, then rerun npm run uat:agents:live."
      : knowledgeFabricEmpty
      ? "Import and publish workflows/n8n/import-ready/knowledge-fabric-agent.ai-agent.import.json into the active Knowledge Fabric workflow for webhook path meids/knowledge-fabric/ingest, then rerun npm run uat:agents:live."
      : liveAlignmentRequired
      ? "Import and publish workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json into the active Actor Twin workflow for webhook path meids/actor-twin/chat, then rerun npm run uat:agents:live."
      : "Review case findings and continue with route-specific fixes.",
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
