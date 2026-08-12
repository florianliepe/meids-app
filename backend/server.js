const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  azureSearchConfigFromEnv,
  statusFromConfig: azureSearchStatusFromConfig,
  getIndexReadiness,
  upsertVectorDocuments,
  searchVectorKnowledge,
} = require("./azureSearch");

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = path.resolve(process.env.MEIDS_DATA_DIR || path.join(process.cwd(), ".data"));
const TRACE_FILE = path.join(DATA_DIR, "agent-traces.jsonl");
const APPROVAL_FILE = path.join(DATA_DIR, "agent-approvals.json");
const POSTGRES_SSL = String(process.env.DATABASE_SSL || "").toLowerCase() === "true";

let pgPoolPromise = null;
let pgSchemaReady = false;

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

function targetAgentForRouteDecision(decision = "", fallbackAgent = "actor_twin") {
  if (["retrieve_knowledge", "ingest_or_stage_knowledge", "update_knowledge"].includes(decision)) return "knowledge_fabric_agent";
  if (["activate_skill", "create_skill", "resume_after_approval"].includes(decision)) return "agentic_butler";
  if (decision === "request_human_clarification") return "human";
  if (decision === "answer_direct") return "actor_twin";
  return fallbackAgent || "actor_twin";
}

function visibleStateForRouteDecision(decision = "") {
  return {
    answer_direct: "answering",
    retrieve_knowledge: "using_knowledge",
    ingest_or_stage_knowledge: "using_knowledge",
    update_knowledge: "capturing_knowledge",
    activate_skill: "activating_skill",
    create_skill: "drafting_new_skill",
    resume_after_approval: "resuming_approved_work",
    request_human_clarification: "approval_required",
  }[decision] || "answering";
}

function normalizeRouteDecisionInput(value = null) {
  if (!value) return null;
  if (typeof value === "string") return { decision: value };
  if (typeof value === "object") return value;
  return null;
}

function defaultRouteDecision(agentId, output = {}, envelope = {}) {
  const explicit = normalizeRouteDecisionInput(output.route_decision || output.routing || output.route || envelope.context?.route_decision || null);
  if (explicit) {
    const decision = explicit.decision || explicit.route_decision || explicit.intent_decision || "answer_direct";
    const targetAgent = explicit.target_agent || explicit.targetAgent || output.target_agent || targetAgentForRouteDecision(decision, agentId);
    return {
      decision,
      target_agent: targetAgent,
      intent: explicit.intent || envelope.intent || "answer_question",
      visible_state: explicit.visible_state || visibleStateForRouteDecision(decision),
      approval_required: Boolean(explicit.approval_required ?? ["create_skill", "request_human_clarification"].includes(decision)),
      handoff_required: Boolean(explicit.handoff_required ?? (targetAgent && targetAgent !== "actor_twin")),
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
  if (!output.delegate_result && response.delegate_result) output.delegate_result = response.delegate_result;
  if (!output.delegate_result && parsed.delegate_result) output.delegate_result = parsed.delegate_result;
  const routeDecision = defaultRouteDecision(agentId, output, envelope);
  const inboundTraceChain = normalizeTraceChain(envelope.context?.trace_chain);
  const responseTraceChain = normalizeTraceChain(response.trace?.trace_chain || parsed.trace?.trace_chain || output.trace?.trace_chain);
  const delegateResult = output.delegate_result && typeof output.delegate_result === "object" ? output.delegate_result : null;
  const delegateTrace = delegateResult?.trace || {};
  const traceChainId = response.trace?.trace_chain_id || parsed.trace?.trace_chain_id || output.trace?.trace_chain_id || envelope.context?.trace_chain_id || inboundTraceChain.trace_chain_id || responseTraceChain.trace_chain_id || delegateTrace.trace_chain_id || "";
  const traceChainSteps = responseTraceChain.steps.length ? responseTraceChain.steps : inboundTraceChain.steps;
  const traceId = response.trace?.trace_id || parsed.trace?.trace_id || output.trace?.trace_id || makeId("trace");
  const currentStepExists = traceChainSteps.some((step) => step.trace_id && step.trace_id === traceId);
  const baseTraceChainSteps = currentStepExists
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
  const delegateTraceId = delegateTrace.trace_id || delegateResult?.trace_id || "";
  const delegateStepExists = delegateTraceId && baseTraceChainSteps.some((step) => step.trace_id === delegateTraceId);
  const fullTraceChainSteps = delegateTraceId && !delegateStepExists
    ? [
        ...baseTraceChainSteps,
        {
          timestamp: new Date().toISOString(),
          agent_id: delegateResult.agent_id || routeDecision.target_agent || "",
          request_id: delegateResult.request_id || "",
          trace_id: delegateTraceId,
          route_decision: routeDecision.decision,
          target_agent: routeDecision.target_agent,
          status: delegateResult.status || "",
        },
      ]
    : baseTraceChainSteps;
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
    handoff_trace_id: response.trace?.handoff_trace_id || parsed.trace?.handoff_trace_id || output.trace?.handoff_trace_id || envelope.context?.handoff_trace_id || delegateTraceId || "",
    delegate_trace_id: delegateTraceId,
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

function storageMode() {
  return String(process.env.MEIDS_STORAGE_MODE || (process.env.DATABASE_URL ? "postgres" : "file")).toLowerCase();
}

function postgresEnabled() {
  return storageMode() === "postgres" && Boolean(process.env.DATABASE_URL);
}

function requirePg() {
  try {
    return require("pg");
  } catch (error) {
    const next = new Error("Postgres storage requires the optional 'pg' package. Run npm install before using MEIDS_STORAGE_MODE=postgres.");
    next.statusCode = 503;
    throw next;
  }
}

async function getPgPool() {
  if (!postgresEnabled()) return null;
  if (!pgPoolPromise) {
    const { Pool } = requirePg();
    pgPoolPromise = Promise.resolve(new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: POSTGRES_SSL ? { rejectUnauthorized: false } : undefined,
    }));
  }
  const pool = await pgPoolPromise;
  await ensurePostgresSchema(pool);
  return pool;
}

async function ensurePostgresSchema(pool) {
  if (pgSchemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_trace_chains (
      trace_chain_id text PRIMARY KEY,
      actor_trace_id text,
      target_agent text,
      route_decision text,
      status text,
      record jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agent_traces (
      trace_id text PRIMARY KEY,
      trace_chain_id text,
      request_id text,
      agent_id text,
      target_agent text,
      route_decision text,
      status text,
      runtime text,
      approval_required boolean NOT NULL DEFAULT false,
      record jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agent_approval_queue (
      approval_id text PRIMARY KEY,
      trace_id text,
      trace_chain_id text,
      request_id text,
      agent_id text,
      target_agent text,
      status text,
      record jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agent_run_events (
      event_id bigserial PRIMARY KEY,
      trace_id text,
      trace_chain_id text,
      agent_id text,
      event_type text NOT NULL,
      record jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  pgSchemaReady = true;
}

async function upsertPostgresTrace(record) {
  const pool = await getPgPool();
  const traceId = record.trace_id || makeId("trace");
  const chainId = record.trace_chain_id || traceId;
  const payload = { ...record, trace_id: traceId, trace_chain_id: chainId };
  await pool.query(
    `INSERT INTO agent_trace_chains
      (trace_chain_id, actor_trace_id, target_agent, route_decision, status, record, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
     ON CONFLICT (trace_chain_id)
     DO UPDATE SET
       actor_trace_id = EXCLUDED.actor_trace_id,
       target_agent = EXCLUDED.target_agent,
       route_decision = EXCLUDED.route_decision,
       status = EXCLUDED.status,
       record = EXCLUDED.record,
       updated_at = now()`,
    [
      chainId,
      payload.actor_trace_id || "",
      payload.target_agent || payload.agent_id || "",
      payload.route_decision || "",
      payload.status || "",
      JSON.stringify(payload),
    ],
  );
  await pool.query(
    `INSERT INTO agent_traces
      (trace_id, trace_chain_id, request_id, agent_id, target_agent, route_decision, status, runtime, approval_required, record)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (trace_id)
     DO UPDATE SET
       trace_chain_id = EXCLUDED.trace_chain_id,
       request_id = EXCLUDED.request_id,
       agent_id = EXCLUDED.agent_id,
       target_agent = EXCLUDED.target_agent,
       route_decision = EXCLUDED.route_decision,
       status = EXCLUDED.status,
       runtime = EXCLUDED.runtime,
       approval_required = EXCLUDED.approval_required,
       record = EXCLUDED.record`,
    [
      traceId,
      chainId,
      payload.request_id || "",
      payload.agent_id || "",
      payload.target_agent || payload.agent_id || "",
      payload.route_decision || "",
      payload.status || "",
      payload.runtime || "",
      Boolean(payload.approval_required),
      JSON.stringify(payload),
    ],
  );
  await pool.query(
    `INSERT INTO agent_run_events (trace_id, trace_chain_id, agent_id, event_type, record)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [traceId, chainId, payload.agent_id || "", "trace_stored", JSON.stringify(payload)],
  );
}

async function appendTrace(record) {
  if (postgresEnabled()) {
    await upsertPostgresTrace(record);
    return;
  }
  await ensureDataDir();
  await fs.appendFile(TRACE_FILE, `${JSON.stringify(record)}\n`, "utf8");
}

async function readTraces(limit = 100) {
  if (postgresEnabled()) {
    const pool = await getPgPool();
    const result = await pool.query(
      "SELECT record FROM agent_traces ORDER BY created_at DESC LIMIT $1",
      [Math.max(1, Math.min(Number(limit) || 100, 500))],
    );
    return result.rows.map((row) => row.record);
  }
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
  if (postgresEnabled()) {
    const pool = await getPgPool();
    const result = await pool.query("SELECT record FROM agent_approval_queue ORDER BY updated_at DESC, created_at DESC LIMIT 250");
    return result.rows.map((row) => row.record);
  }
  try {
    const raw = await fs.readFile(APPROVAL_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeApprovals(items) {
  if (postgresEnabled()) {
    const pool = await getPgPool();
    for (const item of items.slice(0, 250)) {
      await upsertPostgresApproval(item);
    }
    return;
  }
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

function buildTraceRecords(agentId, envelope, response) {
  const parent = buildTraceRecord(agentId, envelope, response);
  const delegate = response.output?.delegate_result && typeof response.output.delegate_result === "object"
    ? response.output.delegate_result
    : null;
  const delegateTrace = delegate?.trace || {};
  const delegateTraceId = delegateTrace.trace_id || delegate?.trace_id || parent.handoff_trace_id || "";
  if (!delegate || !delegateTraceId || delegateTraceId === parent.trace_id) return [parent];
  const routeDecision = parent.route_decision || response.output?.route_decision?.decision || "";
  const targetAgent = delegate.agent_id || parent.target_agent || targetAgentForRouteDecision(routeDecision, "agentic_butler");
  const chain = normalizeTraceChain(response.trace?.trace_chain || parent.trace_chain);
  return [
    parent,
    {
      timestamp: new Date().toISOString(),
      agent_id: targetAgent,
      agent_name: AGENTS[targetAgent]?.label || targetAgent,
      status: delegate.status || "",
      runtime: response.runtime || "backend proxy · delegated",
      request_id: delegate.request_id || parent.request_id || "",
      trace_id: delegateTraceId,
      trace_chain_id: parent.trace_chain_id || delegateTrace.trace_chain_id || "",
      trace_chain: chain.steps,
      actor_trace_id: parent.actor_trace_id || parent.trace_id || "",
      handoff_trace_id: delegateTraceId,
      target_agent: targetAgent,
      route_decision: routeDecision,
      handoff_status: delegate.status || parent.handoff_status || "",
      approval_required: delegate.status === "approval_required" || Boolean(delegate.approval?.required || response.approval?.required),
      response: delegate,
      request: envelope,
      parent_trace_id: parent.trace_id || "",
    },
  ];
}

function buildApprovalRecord(agentId, envelope, response, traceRecord) {
  if (response.status !== "approval_required" && response.approval?.required !== true) return null;
  const approval = response.approval || {};
  const trace = response.trace || {};
  const normalizedChain = normalizeTraceChain(trace.trace_chain || envelope.context?.trace_chain);
  const traceId = trace.trace_id || traceRecord.trace_id || response.request_id;
  const delegate = response.output?.delegate_result && typeof response.output.delegate_result === "object"
    ? response.output.delegate_result
    : null;
  const delegateTrace = delegate?.trace || {};
  return {
    approval_id: `appr_${traceId || response.request_id}`.replace(/[^\w-]/g, "_"),
    timestamp: new Date().toISOString(),
    agent_id: response.agent_id || agentId,
    request_id: response.request_id || envelope.request_id || "",
    trace_id: traceId,
    trace_chain_id: trace.trace_chain_id || envelope.context?.trace_chain_id || normalizedChain.trace_chain_id || "",
    trace_chain: normalizedChain.steps,
    actor_trace_id: trace.actor_trace_id || envelope.context?.actor_trace_id || "",
    handoff_trace_id: trace.handoff_trace_id || envelope.context?.handoff_trace_id || delegateTrace.trace_id || delegate?.trace_id || "",
    target_agent: trace.target_agent || delegate?.agent_id || response.agent_id || agentId,
    route_decision: trace.route_decision || response.output?.route_decision?.decision || "",
    gate: approval.gate || "requires_human_action",
    summary: approval.summary || "Human approval is required before this action can continue.",
    proposed_action: approval.proposed_action || "Resume the gated run after approval.",
    status: "pending_human_approval",
    original_request: envelope,
    original_response: response,
    delegate_result: delegate,
  };
}

async function storeApproval(record) {
  if (!record) return;
  if (postgresEnabled()) {
    await upsertPostgresApproval(record);
    return;
  }
  const approvals = await readApprovals();
  const next = [record, ...approvals.filter((item) => item.approval_id !== record.approval_id && item.trace_id !== record.trace_id)];
  await writeApprovals(next);
}

async function updateApproval(approvalId, patch) {
  if (postgresEnabled()) {
    const approvals = await readApprovals();
    const current = approvals.find((item) => item.approval_id === approvalId);
    if (!current) return null;
    const next = { ...current, ...patch, updated_at: new Date().toISOString() };
    await upsertPostgresApproval(next);
    return next;
  }
  const approvals = await readApprovals();
  const next = approvals.map((item) => item.approval_id === approvalId ? { ...item, ...patch, updated_at: new Date().toISOString() } : item);
  await writeApprovals(next);
  return next.find((item) => item.approval_id === approvalId) || null;
}

async function upsertPostgresApproval(record) {
  const pool = await getPgPool();
  await pool.query(
    `INSERT INTO agent_approval_queue
      (approval_id, trace_id, trace_chain_id, request_id, agent_id, target_agent, status, record, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
     ON CONFLICT (approval_id)
     DO UPDATE SET
       trace_id = EXCLUDED.trace_id,
       trace_chain_id = EXCLUDED.trace_chain_id,
       request_id = EXCLUDED.request_id,
       agent_id = EXCLUDED.agent_id,
       target_agent = EXCLUDED.target_agent,
       status = EXCLUDED.status,
       record = EXCLUDED.record,
       updated_at = now()`,
    [
      record.approval_id,
      record.trace_id || "",
      record.trace_chain_id || "",
      record.request_id || "",
      record.agent_id || "",
      record.target_agent || "",
      record.status || "",
      JSON.stringify(record),
    ],
  );
}

function backendSecretStoreReady() {
  return ["true", "ready", "enabled"].includes(String(process.env.MEIDS_SECRET_STORE_READY || "").toLowerCase())
    || Boolean(process.env.AZURE_KEY_VAULT_URI);
}

function n8nAdminGate() {
  const missing = [];
  if (String(process.env.N8N_ADMIN_ENABLED || "").toLowerCase() !== "true") missing.push("N8N_ADMIN_ENABLED=true");
  if (!backendSecretStoreReady()) missing.push("MEIDS_SECRET_STORE_READY=true or AZURE_KEY_VAULT_URI");
  if (!process.env.N8N_API_BASE_URL) missing.push("N8N_API_BASE_URL");
  if (!process.env.N8N_API_KEY) missing.push("N8N_API_KEY");
  return { ready: missing.length === 0, missing };
}

async function handleN8nAdminStatus(req, res) {
  const gate = n8nAdminGate();
  if (!gate.ready) {
    jsonResponse(res, 503, {
      status: "blocked",
      reason: "n8n admin endpoints are disabled until hosted secret storage and backend-only API credentials are configured.",
      missing: gate.missing,
    });
    return;
  }
  const baseUrl = String(process.env.N8N_API_BASE_URL || "").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/api/v1/workflows`, {
    headers: {
      Accept: "application/json",
      "X-N8N-API-KEY": process.env.N8N_API_KEY,
    },
  });
  const raw = await response.text();
  const data = parseMaybeJson(raw);
  if (!response.ok) {
    jsonResponse(res, response.status, {
      status: "failed",
      error: data.message || data.error || raw.slice(0, 240) || `n8n API returned ${response.status}`,
    });
    return;
  }
  const workflows = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
  jsonResponse(res, 200, {
    status: "ok",
    workflow_count: workflows.length,
    active_count: workflows.filter((workflow) => workflow.active).length,
    workflows: workflows.slice(0, 100).map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      active: Boolean(workflow.active),
      updated_at: workflow.updatedAt || workflow.updated_at || "",
    })),
  });
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
  const traceRecords = buildTraceRecords(agentId, envelope, response);
  const traceRecord = traceRecords[0];
  for (const record of traceRecords) await appendTrace(record);
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
  const traceRecords = buildTraceRecords("agentic_butler", resumeEnvelope, response);
  const traceRecord = traceRecords[0];
  for (const record of traceRecords) await appendTrace(record);
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

async function handleVectorStatus(req, res) {
  const config = azureSearchConfigFromEnv();
  const readiness = await getIndexReadiness(config);
  jsonResponse(res, 200, {
    ...azureSearchStatusFromConfig(config),
    indexes: {
      approved: config.approvedIndex,
      working: config.workingIndex,
    },
    index_readiness: readiness,
    next_action: config.configured
      ? config.embeddingConfigured
        ? "Run Knowledge Fabric vector refresh with approved OKF concepts."
        : "Configure Azure OpenAI embedding deployment before semantic vector upserts."
      : "Configure Azure AI Search backend environment variables.",
  });
}

async function handleVectorRebuild(req, res) {
  const body = await readBody(req);
  const config = azureSearchConfigFromEnv();
  const dryRun = body.dry_run === true || body.dryRun === true || !config.configured;
  const request = {
    operation: body.operation || "upsert",
    organization_id: body.organization_id || "default",
    user_id: body.user_id || "",
    twin_id: body.twin_id || body.twin || "unknown",
    source_policy: body.source_policy || (body.mode === "approved" ? "approved_only" : "selected_pending"),
    repo_name: body.repo_name || "",
    commit_sha: body.commit_sha || "",
    documents: Array.isArray(body.documents) ? body.documents : [],
  };
  if (!request.documents.length) {
    jsonResponse(res, 400, {
      status: "failed",
      error: "Vector rebuild requires a non-empty documents array.",
      expected_contract: "contracts/okf/examples/vector/upsert-request.json",
    });
    return;
  }
  if (dryRun) {
    jsonResponse(res, 200, {
      status: config.configured ? "dry_run" : "blocked",
      provider: "azure_ai_search",
      operation: request.operation,
      document_count: request.documents.length,
      approved_index: config.approvedIndex,
      working_index: config.workingIndex,
      missing: config.missing,
      note: "No Azure write was executed.",
    });
    return;
  }
  const requiresEmbedding = request.documents.some((document) => !Array.isArray(document.content_vector));
  if (requiresEmbedding && !config.embeddingConfigured) {
    jsonResponse(res, 503, {
      status: "blocked",
      provider: "azure_ai_search",
      operation: request.operation,
      document_count: request.documents.length,
      embedding: {
        status: "blocked",
        missing: config.embeddingMissing,
      },
      fallback: "Provide content_vector per document or configure Azure OpenAI embeddings before live vector upsert.",
    });
    return;
  }
  const result = await upsertVectorDocuments(request, config);
  jsonResponse(res, 200, {
    ...result,
    provider: "azure_ai_search",
    approved_index: config.approvedIndex,
    working_index: config.workingIndex,
  });
}

async function handleVectorSearch(req, res) {
  const body = await readBody(req);
  const config = azureSearchConfigFromEnv();
  if (!config.configured) {
    jsonResponse(res, 503, {
      status: "blocked",
      provider: "azure_ai_search",
      missing: config.missing,
      fallback: "Use local OKF keyword retrieval until Azure AI Search backend secrets are configured.",
    });
    return;
  }
  const result = await searchVectorKnowledge(body, config);
  jsonResponse(res, 200, result);
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
      const adminGate = n8nAdminGate();
      jsonResponse(res, 200, {
        status: "ok",
        runtime: "meids-agent-backend-proxy",
        storage: {
          mode: postgresEnabled() ? "postgres" : "file",
          postgres_configured: Boolean(process.env.DATABASE_URL),
          data_dir: postgresEnabled() ? "" : DATA_DIR,
        },
        n8n_admin: {
          status: adminGate.ready ? "ready" : "blocked",
          missing: adminGate.missing,
        },
        vector_search: azureSearchStatusFromConfig(azureSearchConfigFromEnv()),
        agents: Object.fromEntries(Object.values(AGENTS).map((agent) => [
          agent.id,
          { configured: Boolean(process.env[agent.urlEnv]), url_env: agent.urlEnv },
        ])),
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/admin/n8n/status") {
      await handleN8nAdminStatus(req, res);
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
    if (req.method === "GET" && url.pathname === "/api/vector-index/status") {
      await handleVectorStatus(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/vector-index/rebuild") {
      await handleVectorRebuild(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/vector-index/search") {
      await handleVectorSearch(req, res);
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
