const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = path.resolve(process.env.MEIDS_DATA_DIR || path.join(process.cwd(), ".data"));
const TRACE_FILE = path.join(DATA_DIR, "agent-traces.jsonl");
const APPROVAL_FILE = path.join(DATA_DIR, "agent-approvals.json");

const AGENTS = {
  actor_twin: {
    id: "actor_twin",
    label: "Actor Twin",
    urlEnv: "N8N_ACTOR_TWIN_WEBHOOK_URL",
    paths: ["/api/agents/actor-twin/chat", "/api/agents/actor_twin/chat"],
    expectedStatus: "completed",
  },
  knowledge_fabric_agent: {
    id: "knowledge_fabric_agent",
    label: "Knowledge Fabric Agent",
    urlEnv: "N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL",
    paths: ["/api/agents/knowledge-fabric/ingest", "/api/agents/knowledge_fabric_agent/ingest"],
    expectedStatus: "completed",
  },
  agentic_butler: {
    id: "agentic_butler",
    label: "Agentic Butler",
    urlEnv: "N8N_AGENTIC_BUTLER_WEBHOOK_URL",
    paths: ["/api/agents/agentic-butler/run", "/api/agents/agentic_butler/run"],
    expectedStatus: "approval_required",
  },
};

const PATH_TO_AGENT = Object.values(AGENTS).reduce((acc, agent) => {
  agent.paths.forEach((item) => {
    acc[item] = agent.id;
  });
  return acc;
}, {});

function jsonResponse(res, status, data, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(),
    ...headers,
  });
  res.end(JSON.stringify(data, null, 2));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function allowedOrigin() {
  const configured = String(process.env.ALLOWED_FRONTEND_ORIGINS || "*").trim();
  if (!configured || configured === "*") return "*";
  return configured.split(",").map((item) => item.trim()).filter(Boolean)[0] || "*";
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function parseMaybeJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return { output: { answer: String(value) } };
  }
}

function parseEmbeddedJsonObject(value = "") {
  const text = String(value || "").trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function outputFromN8nData(data = {}) {
  if (Array.isArray(data) && data[0]?.json) return outputFromN8nData(data[0].json);
  if (data.json) return outputFromN8nData(data.json);
  if (data.output) return data.output;
  if (data.text || data.message || data.response) {
    return { answer: data.text || data.message || data.response };
  }
  return data;
}

function normalizeAgentOutput(output = {}) {
  if (!output || typeof output !== "object") return { answer: String(output || "") };
  const embedded = parseEmbeddedJsonObject(output.answer || output.text || output.message || output.response || "");
  if (!embedded || typeof embedded !== "object") return output;
  const embeddedOutput = embedded.output && typeof embedded.output === "object" ? embedded.output : embedded;
  return {
    ...output,
    ...embeddedOutput,
    answer: embeddedOutput.answer || output.answer || output.text || output.message || output.response,
    approval: embedded.approval || output.approval,
    trace: embedded.trace || output.trace,
  };
}

function normalizeTraceChain(value = null) {
  if (Array.isArray(value)) return { trace_chain_id: "", steps: value.filter(Boolean) };
  if (value && typeof value === "object") {
    return {
      trace_chain_id: value.trace_chain_id || value.chain_id || "",
      steps: Array.isArray(value.steps) ? value.steps.filter(Boolean) : [],
    };
  }
  return { trace_chain_id: "", steps: [] };
}

function defaultRouteDecision(agentId, output = {}, envelope = {}) {
  const explicit = output.route_decision || output.routing || output.route || envelope.context?.route_decision || null;
  if (explicit && typeof explicit === "object") {
    return {
      decision: explicit.decision || "answer_direct",
      target_agent: explicit.target_agent || agentId,
      intent: explicit.intent || envelope.intent || "answer_question",
      visible_state: explicit.visible_state || "answering",
      approval_required: Boolean(explicit.approval_required),
      handoff_required: Boolean(explicit.handoff_required ?? (explicit.target_agent && explicit.target_agent !== "actor_twin")),
      reason: explicit.reason || "Route decision supplied by agent response.",
    };
  }
  if (agentId === "knowledge_fabric_agent") {
    return {
      decision: "update_knowledge",
      target_agent: "knowledge_fabric_agent",
      intent: envelope.intent || "ingest_source",
      visible_state: "capturing_knowledge",
      approval_required: false,
      handoff_required: true,
      reason: "Knowledge source input was routed to the Knowledge Fabric Agent.",
    };
  }
  if (agentId === "agentic_butler") {
    return {
      decision: envelope.intent === "create_skill" ? "create_skill" : "activate_skill",
      target_agent: "agentic_butler",
      intent: envelope.intent || "activate_skill",
      visible_state: "approval_required",
      approval_required: true,
      handoff_required: true,
      reason: "Work execution is handled by Agentic Butler with human approval gates.",
    };
  }
  return {
    decision: "answer_direct",
    target_agent: "actor_twin",
    intent: envelope.intent || "answer_question",
    visible_state: "answering",
    approval_required: false,
    handoff_required: false,
    reason: "Actor Twin can answer from context without handoff.",
  };
}

function normalizeAgentResponse(agentId, data, envelope = {}, runtime = "backend proxy") {
  const parsed = parseMaybeJson(data);
  const response = parsed.response || parsed.data || parsed || {};
  const output = normalizeAgentOutput(response.output || parsed.output || outputFromN8nData(parsed));
  if (!output.route_decision && response.route_decision) output.route_decision = response.route_decision;
  if (!output.route_decision && parsed.route_decision) output.route_decision = parsed.route_decision;
  const routeDecision = defaultRouteDecision(agentId, output, envelope);
  const inboundTraceChain = normalizeTraceChain(envelope.context?.trace_chain);
  const responseTraceChain = normalizeTraceChain(response.trace?.trace_chain || parsed.trace?.trace_chain || output.trace?.trace_chain);
  const traceChainId = response.trace?.trace_chain_id || parsed.trace?.trace_chain_id || output.trace?.trace_chain_id || envelope.context?.trace_chain_id || inboundTraceChain.trace_chain_id || responseTraceChain.trace_chain_id || "";
  const traceChainSteps = responseTraceChain.steps.length ? responseTraceChain.steps : inboundTraceChain.steps;
  const traceId = response.trace?.trace_id || parsed.trace?.trace_id || output.trace?.trace_id || makeId("trace");
  const currentStepExists = traceChainSteps.some((step) => step.trace_id && step.trace_id === traceId);
  const fullTraceChainSteps = currentStepExists
    ? traceChainSteps
    : [
        ...traceChainSteps,
        {
          timestamp: new Date().toISOString(),
          agent_id: response.agent_id || agentId,
          request_id: response.request_id || envelope.request_id || "",
          trace_id: traceId,
          route_decision: routeDecision.decision,
          target_agent: routeDecision.target_agent,
          status: response.status || parsed.status || "",
        },
      ];
  const approval = response.approval || parsed.approval || output.approval || (
    response.status === "approval_required" || routeDecision.approval_required
      ? {
          required: true,
          gate: "requires_human_action",
          summary: output.approval_request?.reason || output.summary || "Human approval is required before this action can continue.",
          proposed_action: output.approval_request?.proposed_action || "Resume the gated Agentic Butler run after approval.",
        }
      : null
  );
  const trace = {
    stored: true,
    ...(response.trace || parsed.trace || output.trace || {}),
    trace_id: traceId,
    trace_chain_id: traceChainId,
    trace_chain: {
      trace_chain_id: traceChainId,
      steps: fullTraceChainSteps,
    },
    actor_trace_id: response.trace?.actor_trace_id || parsed.trace?.actor_trace_id || output.trace?.actor_trace_id || envelope.context?.actor_trace_id || "",
    handoff_trace_id: response.trace?.handoff_trace_id || parsed.trace?.handoff_trace_id || output.trace?.handoff_trace_id || envelope.context?.handoff_trace_id || "",
    target_agent: routeDecision.target_agent,
    route_decision: routeDecision.decision,
    handoff_status: routeDecision.handoff_required ? (approval?.required ? "approval_required" : "handoff_completed") : "not_required",
  };
  const status = response.status || parsed.status || (approval?.required ? "approval_required" : "completed");
  return {
    envelope_version: response.envelope_version || envelope.envelope_version || "0.1.0",
    request_id: response.request_id || envelope.request_id || makeId("req"),
    agent_id: response.agent_id || agentId,
    status,
    output: {
      ...output,
      route_decision: output.route_decision || routeDecision,
    },
    approval,
    trace,
    runtime,
    error: response.error || parsed.error || null,
  };
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function appendTrace(record) {
  await ensureDataDir();
  await fs.appendFile(TRACE_FILE, `${JSON.stringify(record)}\n`, "utf8");
}

async function readTraces(limit = 100) {
  try {
    const raw = await fs.readFile(TRACE_FILE, "utf8");
    return raw.split(/\r?\n/)
      .filter(Boolean)
      .map((line) => parseMaybeJson(line))
      .reverse()
      .slice(0, limit);
  } catch {
    return [];
  }
}

async function readApprovals() {
  try {
    const raw = await fs.readFile(APPROVAL_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeApprovals(items) {
  await ensureDataDir();
  await fs.writeFile(APPROVAL_FILE, JSON.stringify(items.slice(0, 250), null, 2), "utf8");
}

function buildTraceRecord(agentId, envelope, response) {
  const trace = response.trace || {};
  const normalizedChain = normalizeTraceChain(trace.trace_chain || envelope.context?.trace_chain);
  return {
    timestamp: new Date().toISOString(),
    agent_id: response.agent_id || agentId,
    status: response.status || "",
    runtime: response.runtime || "backend proxy",
    request_id: response.request_id || envelope.request_id || "",
    trace_id: trace.trace_id || "",
    trace_chain_id: trace.trace_chain_id || envelope.context?.trace_chain_id || normalizedChain.trace_chain_id || "",
    trace_chain: normalizedChain.steps,
    actor_trace_id: trace.actor_trace_id || envelope.context?.actor_trace_id || "",
    handoff_trace_id: trace.handoff_trace_id || envelope.context?.handoff_trace_id || "",
    target_agent: trace.target_agent || response.agent_id || agentId,
    route_decision: trace.route_decision || response.output?.route_decision?.decision || "",
    handoff_status: trace.handoff_status || "",
    approval_required: response.status === "approval_required" || Boolean(response.approval?.required),
    response,
    request: envelope,
  };
}

function buildApprovalRecord(agentId, envelope, response, traceRecord) {
  if (response.status !== "approval_required" && response.approval?.required !== true) return null;
  const approval = response.approval || {};
  const trace = response.trace || {};
  const normalizedChain = normalizeTraceChain(trace.trace_chain || envelope.context?.trace_chain);
  const traceId = trace.trace_id || traceRecord.trace_id || response.request_id;
  return {
    approval_id: `appr_${traceId || response.request_id}`.replace(/[^\w-]/g, "_"),
    timestamp: new Date().toISOString(),
    agent_id: response.agent_id || agentId,
    request_id: response.request_id || envelope.request_id || "",
    trace_id: traceId,
    trace_chain_id: trace.trace_chain_id || envelope.context?.trace_chain_id || normalizedChain.trace_chain_id || "",
    trace_chain: normalizedChain.steps,
    actor_trace_id: trace.actor_trace_id || envelope.context?.actor_trace_id || "",
    handoff_trace_id: trace.handoff_trace_id || envelope.context?.handoff_trace_id || "",
    target_agent: trace.target_agent || response.agent_id || agentId,
    route_decision: trace.route_decision || response.output?.route_decision?.decision || "",
    gate: approval.gate || "requires_human_action",
    summary: approval.summary || "Human approval is required before this action can continue.",
    proposed_action: approval.proposed_action || "Resume the gated run after approval.",
    status: "pending_human_approval",
    original_request: envelope,
  };
}

async function storeApproval(record) {
  if (!record) return;
  const approvals = await readApprovals();
  const next = [record, ...approvals.filter((item) => item.approval_id !== record.approval_id && item.trace_id !== record.trace_id)];
  await writeApprovals(next);
}

async function updateApproval(approvalId, patch) {
  const approvals = await readApprovals();
  const next = approvals.map((item) => item.approval_id === approvalId ? { ...item, ...patch, updated_at: new Date().toISOString() } : item);
  await writeApprovals(next);
  return next.find((item) => item.approval_id === approvalId) || null;
}

async function proxyToN8n(agentId, envelope) {
  const agent = AGENTS[agentId];
  const webhookUrl = process.env[agent.urlEnv];
  if (!webhookUrl) {
    const error = new Error(`${agent.urlEnv} is not configured`);
    error.statusCode = 503;
    throw error;
  }
  const headers = { "Content-Type": "application/json" };
  if (process.env.N8N_WEBHOOK_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${process.env.N8N_WEBHOOK_AUTH_TOKEN}`;
  }
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(envelope),
  });
  const raw = await response.text();
  if (!response.ok) {
    const error = new Error(raw || `${agent.label} returned ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  return normalizeAgentResponse(agentId, parseMaybeJson(raw), envelope);
}

async function handleAgentProxy(req, res, agentId) {
  const envelope = await readBody(req);
  const response = await proxyToN8n(agentId, envelope);
  const traceRecord = buildTraceRecord(agentId, envelope, response);
  await appendTrace(traceRecord);
  await storeApproval(buildApprovalRecord(agentId, envelope, response, traceRecord));
  jsonResponse(res, 200, { agent_id: agentId, response, trace: traceRecord });
}

async function handleResumeApproval(req, res, approvalId) {
  const body = await readBody(req);
  const approvals = await readApprovals();
  const approval = approvals.find((item) => item.approval_id === approvalId);
  if (!approval) {
    jsonResponse(res, 404, { status: "failed", error: `Approval not found: ${approvalId}` });
    return;
  }
  if (body?.input?.approved === false || body?.approved === false) {
    const updated = await updateApproval(approvalId, { status: "rejected" });
    jsonResponse(res, 200, { status: "rejected", approval: updated });
    return;
  }
  const resumeEnvelope = {
    envelope_version: body.envelope_version || "0.1.0",
    request_id: body.request_id || makeId("resume"),
    timestamp: new Date().toISOString(),
    agent_id: "agentic_butler",
    intent: "resume_after_approval",
    principal: body.principal || approval.original_request?.principal || {},
    input: {
      original_request_id: approval.request_id,
      original_trace_id: approval.trace_id,
      approved: true,
      approval_note: body.input?.approval_note || body.approval_note || "Approved through MeIDs backend proxy.",
    },
    context: {
      ...(body.context || {}),
      actor_trace_id: approval.actor_trace_id,
      handoff_trace_id: approval.handoff_trace_id || approval.trace_id,
      trace_chain_id: approval.trace_chain_id || body.context?.trace_chain_id || "",
      trace_chain: {
        trace_chain_id: approval.trace_chain_id || body.context?.trace_chain_id || "",
        steps: normalizeTraceChain(approval.trace_chain || body.context?.trace_chain).steps,
      },
      target_agent: approval.target_agent || "agentic_butler",
      route_decision: approval.route_decision,
      approval_id: approval.approval_id,
    },
  };
  const response = await proxyToN8n("agentic_butler", resumeEnvelope);
  const traceRecord = buildTraceRecord("agentic_butler", resumeEnvelope, response);
  await appendTrace(traceRecord);
  const updated = await updateApproval(approvalId, {
    status: "resumed",
    resumed_trace_id: traceRecord.trace_id,
    resumed_at: new Date().toISOString(),
  });
  jsonResponse(res, 200, { status: "resumed", approval: updated, response, trace: traceRecord });
}

async function handleManualTrace(req, res) {
  const body = await readBody(req);
  const trace = {
    timestamp: new Date().toISOString(),
    source: "frontend",
    ...(body.trace || body),
  };
  await appendTrace(trace);
  jsonResponse(res, 200, { status: "stored", trace });
}

async function handleManualApproval(req, res) {
  const body = await readBody(req);
  const record = {
    approval_id: body.approval_id || makeId("appr"),
    timestamp: new Date().toISOString(),
    status: "pending_human_approval",
    ...body,
  };
  await storeApproval(record);
  jsonResponse(res, 200, { status: "stored", approval: record });
}

async function routeRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      jsonResponse(res, 200, {
        status: "ok",
        runtime: "meids-agent-backend-proxy",
        agents: Object.fromEntries(Object.values(AGENTS).map((agent) => [
          agent.id,
          { configured: Boolean(process.env[agent.urlEnv]), url_env: agent.urlEnv },
        ])),
      });
      return;
    }
    if (req.method === "POST" && PATH_TO_AGENT[url.pathname]) {
      await handleAgentProxy(req, res, PATH_TO_AGENT[url.pathname]);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/agents/traces") {
      jsonResponse(res, 200, { traces: await readTraces(Number(url.searchParams.get("limit") || 100)) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/agents/traces") {
      await handleManualTrace(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/agents/approvals") {
      jsonResponse(res, 200, { approvals: await readApprovals() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/agents/approvals") {
      await handleManualApproval(req, res);
      return;
    }
    const resumeMatch = url.pathname.match(/^\/api\/agents\/approvals\/([^/]+)\/resume$/);
    if (req.method === "POST" && resumeMatch) {
      await handleResumeApproval(req, res, decodeURIComponent(resumeMatch[1]));
      return;
    }
    jsonResponse(res, 404, { status: "failed", error: "Not found" });
  } catch (error) {
    jsonResponse(res, error.statusCode || 500, {
      status: "failed",
      error: error.message || "Unhandled backend proxy error",
    });
  }
}

if (require.main === module) {
  http.createServer(routeRequest).listen(PORT, () => {
    console.log(`MeIDs agent backend proxy listening on ${PORT}`);
  });
}

module.exports = {
  AGENTS,
  normalizeAgentResponse,
  buildTraceRecord,
  buildApprovalRecord,
  routeRequest,
};
