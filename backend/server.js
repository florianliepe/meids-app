const { readBuildInfo } = require("./buildInfo");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const {
  azureSearchConfigFromEnv,
  statusFromConfig: azureSearchStatusFromConfig,
  getIndexReadiness,
  upsertVectorDocuments,
  searchVectorKnowledge,
} = require("./azureSearch");
const {
  signKnowledgeAccessToken,
  verifyKnowledgeAccessToken,
  signingKeyFromEnv,
} = require("./knowledgeAccess");
const {
  stageKnowledge,
  stageLearning,
  promoteKnowledge,
  rejectKnowledge,
  backfillKnowledgeSearch,
  processOutboxBatch,
} = require("./knowledgePersistence");
const { createWorkspaceApi } = require("./workspaceApi");
const { normalizeUploadFilename } = require("./documentExtraction");

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = path.resolve(process.env.MEIDS_DATA_DIR || path.join(process.cwd(), ".data"));
const TRACE_FILE = path.join(DATA_DIR, "agent-traces.jsonl");
const APPROVAL_FILE = path.join(DATA_DIR, "agent-approvals.json");
const POSTGRES_SSL = String(process.env.DATABASE_SSL || "true").toLowerCase() === "true";
const POSTGRES_TOKEN_RESOURCE = "https://ossrdbms-aad.database.windows.net";

let pgPoolPromise = null;
let pgSchemaReady = false;
let postgresIdentityToken = { value: "", expiresAt: 0 };

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
    expectedStatus: "completed",
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
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
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

async function readRawBody(req, maxBytes = 25 * 1024 * 1024) {
  const chunks = [];
  let receivedBytes = 0;
  for await (const chunk of req) {
    receivedBytes += chunk.length;
    if (receivedBytes > maxBytes) {
      const error = new Error(`Upload exceeds the ${Math.ceil(maxBytes / 1024 / 1024)} MB request limit.`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function splitMultipartBuffer(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = buffer.indexOf(delimiter);
  while (cursor !== -1) {
    const next = buffer.indexOf(delimiter, cursor + delimiter.length);
    if (next === -1) break;
    let part = buffer.subarray(cursor + delimiter.length, next);
    if (part.subarray(0, 2).toString() === "\r\n") part = part.subarray(2);
    if (part.subarray(part.length - 2).toString() === "\r\n") part = part.subarray(0, part.length - 2);
    if (part.length && part.toString("utf8", 0, Math.min(part.length, 2)) !== "--") parts.push(part);
    cursor = next;
  }
  return parts;
}

function decodeMultipartFilename(header) {
  const encoded = header.match(/(?:^|;)\s*filename\*\s*=\s*(?:"([^"]*)"|([^;\r\n]*))/i);
  if (encoded) {
    const raw = String(encoded[1] ?? encoded[2] ?? "").trim();
    const value = raw.match(/^[^']*'[^']*'(.*)$/)?.[1] ?? raw;
    try {
      return normalizeUploadFilename(decodeURIComponent(value));
    } catch (error) {
      return normalizeUploadFilename(value);
    }
  }
  return normalizeUploadFilename(header.match(/(?:^|;)\s*filename\s*=\s*"([^"]*)"/i)?.[1] || "");
}

async function readMultipartForm(req, options = {}) {
  const contentType = String(req.headers["content-type"] || "");
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2];
  if (!boundary) {
    const error = new Error("Multipart form upload is missing a boundary.");
    error.statusCode = 400;
    throw error;
  }
  const body = await readRawBody(req, options.maxBytes);
  const fields = {};
  const files = {};
  for (const part of splitMultipartBuffer(body, boundary)) {
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;
    const header = part.subarray(0, headerEnd).toString("utf8");
    let payload = part.subarray(headerEnd + 4);
    if (payload.subarray(payload.length - 2).toString() === "\r\n") payload = payload.subarray(0, payload.length - 2);
    const name = header.match(/name="([^"]+)"/i)?.[1];
    if (!name) continue;
    const filename = decodeMultipartFilename(header);
    const type = header.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || "application/octet-stream";
    if (filename) {
      files[name] = { filename, type, buffer: payload };
    } else {
      fields[name] = payload.toString("utf8");
    }
  }
  return { fields, files };
}

function openAiTranscriptionConfig() {
  const gatewayModel = String(process.env.ERANEOS_AI_GATEWAY_TRANSCRIPTION_MODEL || "").trim();
  const useGateway = Boolean(gatewayModel);
  const apiKey = String(useGateway ? process.env.ERANEOS_AI_GATEWAY_API_KEY || "" : process.env.OPENAI_API_KEY || "").trim();
  const baseUrl = String(useGateway
    ? process.env.ERANEOS_AI_GATEWAY_BASE_URL || "https://ai-gateway.eraneos.com/v1"
    : process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1"
  ).trim().replace(/\/+$/, "");
  const model = gatewayModel || String(process.env.OPENAI_TRANSCRIPTION_MODEL || "").trim();
  const mode = String(useGateway
    ? process.env.ERANEOS_AI_GATEWAY_TRANSCRIPTION_MODE || "chat_completions_audio"
    : process.env.OPENAI_TRANSCRIPTION_MODE || "audio_transcriptions"
  ).trim().toLowerCase();
  const supportedModes = new Set(["audio_transcriptions", "chat_completions_audio"]);
  const fallbackModels = String(useGateway ? process.env.ERANEOS_AI_GATEWAY_TRANSCRIPTION_FALLBACK_MODELS || "" : "")
    .split(",")
    .map((candidate) => candidate.trim())
    .filter((candidate, index, candidates) => candidate && candidate !== model && candidates.indexOf(candidate) === index)
    .slice(0, 2);
  return {
    apiKey,
    baseUrl,
    model,
    fallbackModels,
    mode,
    provider: useGateway ? "eraneos_ai_gateway" : "openai",
    configured: Boolean(apiKey && baseUrl && model && supportedModes.has(mode)),
    missing: [
      ...(!apiKey ? [useGateway ? "ERANEOS_AI_GATEWAY_API_KEY" : "OPENAI_API_KEY"] : []),
      ...(!baseUrl ? [useGateway ? "ERANEOS_AI_GATEWAY_BASE_URL" : "OPENAI_BASE_URL"] : []),
      ...(!model ? ["ERANEOS_AI_GATEWAY_TRANSCRIPTION_MODEL or OPENAI_TRANSCRIPTION_MODEL"] : []),
      ...(!supportedModes.has(mode) ? ["supported transcription mode"] : []),
    ],
  };
}

function parseGatewayResponse(response, text) {
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const detail = data.error?.message || data.message || data.raw || response.statusText;
    const modelHint = /invalid model|model.*not.*found|unknown model/i.test(String(detail || ""))
      ? " The configured gateway does not expose this speech-to-text model. Select an advertised audio-input model or configure a governed STT endpoint."
      : "";
    const error = new Error(`Transcription provider failed: ${detail}.${modelHint}`.replace(/\.\./g, "."));
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

function gatewayAudioFormat(file) {
  const extension = String(file.gatewayFilename || file.filename || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (["mpeg", "mpga"].includes(extension)) return "mp3";
  return extension || (String(file.mediaType || file.type).includes("wav") ? "wav" : "webm");
}

function chatCompletionText(data) {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === "string" ? part : part?.text || "").join("\n").trim();
  }
  return String(data.output_text || data.text || data.transcript || "").trim();
}

async function transcribeAudioWithChatCompletion(file, config, model = config.model) {
  const maxTokens = Math.max(1_000, Math.min(Number(process.env.TRANSCRIPTION_MAX_OUTPUT_TOKENS || 16_384), 65_536));
  const timeoutMs = Math.max(30_000, Math.min(Number(process.env.TRANSCRIPTION_TIMEOUT_MS || 180_000), 600_000));
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      reasoning_effort: "none",
      messages: [
        {
          role: "system",
          content: "You are a deterministic speech-to-text engine. Preserve the spoken language, wording, speaker changes, and meaningful punctuation. Do not summarize, translate, answer, or add commentary. Output transcript text only.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this audio verbatim in its spoken language. Return transcript text only." },
            {
              type: "input_audio",
              input_audio: {
                data: file.buffer.toString("base64"),
                format: gatewayAudioFormat(file),
              },
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = parseGatewayResponse(response, await response.text());
  if (["length", "max_tokens"].includes(String(data.choices?.[0]?.finish_reason || "").toLowerCase())) {
    const error = new Error("Transcription output was truncated. Split the recording into smaller files and try again.");
    error.statusCode = 422;
    throw error;
  }
  const transcript = chatCompletionText(data);
  if (!transcript) {
    const finishReason = String(data.choices?.[0]?.finish_reason || "unknown").toLowerCase();
    const error = new Error(finishReason === "content_filter"
      ? `The transcription model ${model} blocked the audio response. A configured fallback model may retry it.`
      : `The transcription model ${model} returned no readable transcript (finish reason: ${finishReason}).`);
    error.statusCode = 422;
    error.fallbackEligible = true;
    error.finishReason = finishReason;
    throw error;
  }
  return transcript;
}

async function transcribeAudioWithOpenAiCompatibleGateway(file) {
  const config = openAiTranscriptionConfig();
  if (!config.configured) {
    const error = new Error(`Voice transcription backend is not configured: ${config.missing.join(", ")}`);
    error.statusCode = 503;
    throw error;
  }
  if (config.mode === "chat_completions_audio") {
    const models = [config.model, ...config.fallbackModels];
    let lastError;
    for (const [index, model] of models.entries()) {
      try {
        const transcript = await transcribeAudioWithChatCompletion(file, config, model);
        if (index > 0) {
          console.warn(JSON.stringify({
            event: "voice_transcription_model_fallback",
            status: "completed",
            primary_model: config.model,
            selected_model: model,
          }));
        }
        return transcript;
      } catch (error) {
        lastError = error;
        const fallbackModel = models[index + 1];
        if (!error.fallbackEligible || !fallbackModel) throw error;
        console.warn(JSON.stringify({
          event: "voice_transcription_model_fallback",
          status: "retrying",
          rejected_model: model,
          finish_reason: error.finishReason || "unknown",
          fallback_model: fallbackModel,
        }));
      }
    }
    throw lastError;
  }
  const form = new FormData();
  form.append("model", config.model);
  form.append("file", new Blob([file.buffer], { type: file.mediaType || file.type || "audio/webm" }), file.gatewayFilename || "meids-audio.webm");
  const response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: form,
  });
  const text = await response.text();
  const data = parseGatewayResponse(response, text);
  return String(data.text || data.transcript || data.output_text || "").trim();
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
    const createsGeneratedCapability = envelope.intent === "create_skill" || envelope.context?.route_decision?.decision === "create_skill";
    return {
      decision: createsGeneratedCapability ? "create_skill" : "activate_skill",
      target_agent: "agentic_butler",
      intent: envelope.intent || "activate_skill",
      visible_state: createsGeneratedCapability ? "approval_required" : "activating_skill",
      approval_required: createsGeneratedCapability,
      handoff_required: true,
      reason: createsGeneratedCapability
        ? "Generated skill or agent activation requires human approval."
        : "Agentic Butler executes Actor Twin delegated draft, planning, and internal skill work autonomously.",
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
  return String(process.env.MEIDS_STORAGE_MODE || (process.env.DATABASE_URL || process.env.DATABASE_HOST ? "postgres" : "file")).toLowerCase();
}

function postgresEnabled() {
  return storageMode() === "postgres" && Boolean(process.env.DATABASE_URL || process.env.DATABASE_HOST);
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
    const managedIdentity = String(process.env.POSTGRES_AUTH_MODE || "").toLowerCase() === "managed_identity";
    pgPoolPromise = Promise.resolve(new Pool(managedIdentity ? {
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT || 5432),
      database: process.env.DATABASE_NAME || "meids_prod",
      user: process.env.DATABASE_USER,
      password: postgresManagedIdentityAccessToken,
      ssl: POSTGRES_SSL ? { rejectUnauthorized: true } : undefined,
      max: Number(process.env.DATABASE_POOL_MAX || 10),
    } : {
      connectionString: process.env.DATABASE_URL,
      ssl: POSTGRES_SSL ? { rejectUnauthorized: true } : undefined,
      max: Number(process.env.DATABASE_POOL_MAX || 10),
    }));
  }
  const pool = await pgPoolPromise;
  const schemaManaged = String(process.env.POSTGRES_AUTH_MODE || "").toLowerCase() === "managed_identity"
    || ["true", "1", "on"].includes(String(process.env.MEIDS_DATABASE_SCHEMA_MANAGED || "false").toLowerCase());
  if (!schemaManaged) await ensurePostgresSchema(pool);
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

async function appendTrace(record, learningContext = {}) {
  if (postgresEnabled()) {
    await upsertPostgresTrace(record);
  } else {
    await ensureDataDir();
    await fs.appendFile(TRACE_FILE, `${JSON.stringify(record)}\n`, "utf8");
  }
  queuePostTurnLearning({
    ...record,
    _learning_context: learningContext,
  });
}

async function postgresManagedIdentityAccessToken() {
  if (postgresIdentityToken.value && postgresIdentityToken.expiresAt > Date.now() + 60_000) {
    return postgresIdentityToken.value;
  }
  const endpoint = String(process.env.IDENTITY_ENDPOINT || "").trim();
  const identityHeader = String(process.env.IDENTITY_HEADER || "").trim();
  if (!endpoint || !identityHeader) throw new Error("App Service managed identity endpoint is unavailable for PostgreSQL.");
  const url = new URL(endpoint);
  url.searchParams.set("resource", POSTGRES_TOKEN_RESOURCE);
  url.searchParams.set("api-version", "2019-08-01");
  const clientId = String(process.env.POSTGRES_MANAGED_IDENTITY_CLIENT_ID || "").trim();
  if (clientId) url.searchParams.set("client_id", clientId);
  const response = await fetch(url, {
    headers: {
      "X-IDENTITY-HEADER": identityHeader,
      Metadata: "true",
    },
    signal: AbortSignal.timeout(10_000),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || raw || `Managed identity token request returned ${response.status}`);
  }
  const numericExpiry = Number(data.expires_on);
  const expiresAt = Number.isFinite(numericExpiry) && numericExpiry > 0
    ? numericExpiry * 1000
    : Date.parse(String(data.expires_on || ""));
  postgresIdentityToken = {
    value: data.access_token,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 5 * 60_000,
  };
  return postgresIdentityToken.value;
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

function n8nAgentTimeoutMs() {
  const configured = Number(process.env.N8N_AGENT_TIMEOUT_MS || 120000);
  if (!Number.isFinite(configured) || configured <= 0) return 120000;
  return Math.max(5000, Math.min(configured, 300000));
}

function n8nTimeoutFallbackResponse(agentId, envelope, timeoutMs) {
  const agent = AGENTS[agentId];
  return normalizeAgentResponse(agentId, {
    status: "failed",
    agent_id: agentId,
    output: {
      answer: `${agent.label} did not finish within ${Math.round(timeoutMs / 1000)} seconds. The request was stopped at the backend boundary; retry with a narrower request or inspect the n8n execution trace.`,
      summary: `${agent.label} timeout fallback after ${timeoutMs}ms.`,
      route_decision: defaultRouteDecision(agentId, {}, envelope),
    },
    error: {
      code: "n8n_agent_timeout",
      message: `${agent.label} exceeded N8N_AGENT_TIMEOUT_MS.`,
    },
    trace: {
      timeout: true,
      timeout_ms: timeoutMs,
      boundary: "backend_proxy",
    },
  }, envelope, "backend proxy · timeout fallback");
}

async function proxyToN8n(agentId, envelope, options = {}) {
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
  const requestedTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.max(5000, Math.min(requestedTimeout, n8nAgentTimeoutMs()))
    : n8nAgentTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      return n8nTimeoutFallbackResponse(agentId, envelope, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

function boundedTraceText(value, max = 20_000) {
  if (value == null) return "";
  return String(typeof value === "string" ? value : JSON.stringify(value)).trim().slice(0, max);
}

async function handlePostAnswerTrace(req, res) {
  const body = await readBody(req);
  const mapping = await requireKnowledgeRequestMapping(req, body);
  const supplied = body.trace && typeof body.trace === "object" ? body.trace : {};
  const twinId = cleanTwinId(supplied.twin_id || supplied.active_twin_id || mapping.active_twin_id);
  if (!twinId || !mapping.allowed_twin_ids.includes(twinId)) {
    const error = new Error("Post-answer trace must target an assigned twin.");
    error.statusCode = 403;
    throw error;
  }
  const traceId = boundedTraceText(supplied.trace_id, 256) || makeId("trace");
  const record = {
    timestamp: new Date().toISOString(),
    trace_id: traceId,
    trace_chain_id: boundedTraceText(supplied.trace_chain_id, 256) || traceId,
    request_id: boundedTraceText(supplied.request_id, 256),
    actor_trace_id: traceId,
    agent_id: "actor_twin",
    target_agent: "actor_twin",
    route_decision: boundedTraceText(supplied.route_decision, 120) || "answer_completed",
    status: "completed",
    runtime: "n8n_post_answer",
    source: "n8n_actor_twin",
    tenant_id: mapping.tenant_id,
    user_id: mapping.user_id,
    twin_id: twinId,
    input_summary: boundedTraceText(supplied.input_summary),
    output_summary: boundedTraceText(supplied.output_summary),
    grounding: supplied.grounding && typeof supplied.grounding === "object" ? supplied.grounding : {},
    trace_learning_recommended: supplied.trace_learning_recommended !== false,
  };
  await appendTrace(record, {
    knowledge_access_token: body.knowledge_access_token
      || body.auth_context?.knowledge_access_token
      || body.metadata?.authorization?.knowledgeAccessToken
      || "",
    tenant_id: mapping.tenant_id,
    user_id: mapping.user_id,
    twin_id: twinId,
    organization_id: mapping.tenant_id,
  });
  jsonResponse(res, 201, {
    status: "stored",
    trace_id: traceId,
    post_turn_learning: record.trace_learning_recommended
      ? (postTurnLearningEnabled() ? "queued" : "disabled")
      : "not_recommended",
  });
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
  const accessContext = knowledgeAccessContextFromRequest(req, body);
  const config = azureSearchConfigFromEnv();
  const dryRun = body.dry_run === true || body.dryRun === true || !config.configured;
  const request = {
    operation: body.operation || "upsert",
    organization_id: accessContext?.tenant_id || body.organization_id || "",
    user_id: accessContext?.user_id || body.user_id || "",
    twin_id: body.twin_id || body.twin || accessContext?.active_twin_id || "",
    source_policy: body.source_policy || (body.mode === "approved" ? "approved_only" : "selected_pending"),
    repo_name: body.repo_name || "",
    commit_sha: body.commit_sha || "",
    vector_mode: body.vector_mode || body.embedding_mode || "",
    allow_deterministic_vectors: body.allow_deterministic_vectors === true || body.allowDeterministicVectors === true,
    documents: Array.isArray(body.documents) ? body.documents : [],
  };
  if (!request.organization_id || !request.twin_id) {
    jsonResponse(res, 400, {
      status: "failed",
      error: "Vector rebuild requires authenticated tenant/twin scope or explicit organization_id and twin_id.",
    });
    return;
  }
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
  const deterministicFallbackAllowed = Boolean(
    config.deterministicVectorsAllowed
    || request.allow_deterministic_vectors
    || ["deterministic_fallback", "deterministic_hash_fallback"].includes(String(request.vector_mode || "").trim().toLowerCase())
  );
  if (requiresEmbedding && !config.embeddingConfigured && !deterministicFallbackAllowed) {
    jsonResponse(res, 503, {
      status: "blocked",
      provider: "azure_ai_search",
      operation: request.operation,
      document_count: request.documents.length,
      embedding: {
        status: "blocked",
        missing: config.embeddingMissing,
      },
      fallback: "Provide content_vector per document, configure Azure OpenAI embeddings, or explicitly enable deterministic UAT vectors before live vector upsert.",
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
  const accessContext = knowledgeAccessContextFromRequest(req, body);
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
  const result = await searchVectorKnowledge({
    ...body,
    access_context: accessContext,
    organization_id: accessContext?.tenant_id || body.organization_id,
    twin_id: accessContext?.active_twin_id || body.twin_id || body.twin,
  }, config);
  jsonResponse(res, 200, result);
}

function normalizeScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number >= 0 && number <= 1) return number;
  return Number((1 - (1 / (1 + Math.max(0, number)))).toFixed(4));
}

function lexicalTokens(values = []) {
  const stopWords = new Set(["a", "an", "and", "are", "as", "be", "before", "by", "for", "in", "into", "is", "it", "of", "or", "should", "the", "they", "to", "with"]);
  return values
    .flatMap((item) => String(item || "").toLowerCase().split(/[^a-z0-9]+/))
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && !stopWords.has(item));
}

function lexicalOverlapScore(candidateTerms = [], resultTerms = []) {
  const left = new Set(lexicalTokens(candidateTerms));
  const right = new Set(lexicalTokens(resultTerms));
  if (!left.size || !right.size) return 0;
  const overlap = [...left].filter((item) => right.has(item)).length;
  return Number((overlap / Math.max(left.size, right.size)).toFixed(4));
}

function candidateDuplicateTerms(candidate = {}) {
  return [
    candidate.title,
    candidate.name,
    candidate.purpose,
    candidate.summary,
    candidate.text,
    candidate.query,
    candidate.chatInput,
    ...(Array.isArray(candidate.aliases) ? candidate.aliases : []),
    ...(Array.isArray(candidate.tags) ? candidate.tags : []),
  ].filter(Boolean);
}

function classifyDuplicateCandidate({ vectorScore = null, lexicalScore = 0, graphScore = 0, scopeCompatible = false } = {}) {
  const vectorCorroborated = vectorScore !== null && vectorScore >= 0.88 && lexicalScore >= 0.35;
  if ((vectorCorroborated && scopeCompatible) || (lexicalScore >= 0.8 && scopeCompatible)) {
    return { status: "strong_duplicate", action: "stage_merge_delta_or_reject_duplicate" };
  }
  if ((vectorScore !== null && vectorScore >= 0.72 && lexicalScore >= 0.15) || graphScore >= 0.7 || lexicalScore >= 0.5) {
    return { status: "near_match", action: "stage_updated_review_needed" };
  }
  if ((vectorScore !== null && vectorScore >= 0.55) || graphScore > 0) {
    return { status: "related_only", action: "create_new_with_candidate_related_edge" };
  }
  return { status: "insufficient_evidence", action: "hold_evidence_pending" };
}

function summarizeDuplicateHit(candidate = {}, hit = {}) {
  const candidateTerms = candidateDuplicateTerms(candidate);
  const resultTerms = candidateDuplicateTerms(hit);
  const rawVectorSearchScore = normalizeScore(hit["@search.score"]);
  const vectorScore = rawVectorSearchScore !== null && rawVectorSearchScore > 0
    ? normalizeScore(2 - (1 / rawVectorSearchScore))
    : normalizeScore(hit.score || hit.vector_score || hit.similarity);
  const lexicalScore = lexicalOverlapScore(candidateTerms, resultTerms);
  const graphScore = candidate.graph_cluster_id && hit.graph_cluster_id && candidate.graph_cluster_id === hit.graph_cluster_id
    ? 1
    : candidate.graph_node_id && hit.graph_node_id && candidate.graph_node_id === hit.graph_node_id
      ? 1
      : 0;
  const scopeCompatible = !candidate.okf_type || !hit.okf_type || candidate.okf_type === hit.okf_type;
  const classification = classifyDuplicateCandidate({ vectorScore, lexicalScore, graphScore, scopeCompatible });
  return {
    concept_id: hit.okf_concept_id || hit.id || "",
    title: hit.title || "",
    repo_path: hit.repo_path || "",
    evidence_id: hit.evidence_id || "",
    graph_node_id: hit.graph_node_id || "",
    graph_cluster_id: hit.graph_cluster_id || "",
    scores: {
      vector_similarity: vectorScore,
      raw_vector_search_score: rawVectorSearchScore,
      lexical_overlap: lexicalScore,
      graph_proximity: graphScore,
      scope_compatible: scopeCompatible,
    },
    classification: classification.status,
    recommended_action: classification.action,
  };
}

async function handleKnowledgeDuplicateCheck(req, res) {
  const body = await readBody(req);
  const accessContext = knowledgeAccessContextFromRequest(req, body);
  const candidate = body.candidate || body.concept || body;
  const queryText = [
    candidate.title || candidate.name,
    candidate.purpose,
    candidate.summary,
    candidate.text,
    candidate.query,
    candidate.chatInput,
    Array.isArray(candidate.aliases) ? candidate.aliases.join(" ") : "",
  ].filter(Boolean).join("\n").trim();
  if (!queryText) {
    jsonResponse(res, 400, {
      status: "failed",
      duplicate_check: { status: "insufficient_evidence" },
      error: "Duplicate check requires candidate title, purpose, summary, text, query, chatInput, or aliases.",
    });
    return;
  }
  const config = azureSearchConfigFromEnv();
  if (!config.configured) {
    jsonResponse(res, 200, {
      status: "completed",
      duplicate_check: {
        status: "insufficient_evidence",
        reason: "Azure AI Search is not configured for score-backed duplicate detection.",
        missing: config.missing,
      },
      merge_candidates: [],
      recommended_action: "hold_evidence_pending",
    });
    return;
  }
  const organizationId = accessContext?.tenant_id || body.organization_id || candidate.organization_id;
  if (!organizationId) {
    jsonResponse(res, 400, {
      status: "failed",
      duplicate_check: { status: "insufficient_evidence" },
      error: "Duplicate check requires an authenticated tenant or explicit organization_id.",
    });
    return;
  }
  const retrieval = await searchVectorKnowledge({
    query: queryText,
    query_vector: Array.isArray(candidate.query_vector)
      ? candidate.query_vector
      : Array.isArray(candidate.content_vector)
        ? candidate.content_vector
        : Array.isArray(body.query_vector)
          ? body.query_vector
          : Array.isArray(body.content_vector)
            ? body.content_vector
            : undefined,
    twin_id: candidate.twin_id || body.twin_id || body.twin || "",
    organization_id: organizationId,
    source_policy: body.source_policy || "selected_pending",
    score_mode: "vector_similarity",
    top: Number(body.top || 8),
    include_shared: body.include_shared !== false,
    access_context: accessContext,
  }, config);
  const hits = retrieval.results.flatMap((item) => item.value || []);
  const mergeCandidates = hits.map((hit) => summarizeDuplicateHit(candidate, hit))
    .sort((a, b) => {
      const aScore = Math.max(a.scores.vector_similarity || 0, a.scores.lexical_overlap || 0, a.scores.graph_proximity || 0);
      const bScore = Math.max(b.scores.vector_similarity || 0, b.scores.lexical_overlap || 0, b.scores.graph_proximity || 0);
      return bScore - aScore;
    });
  const strongest = mergeCandidates[0] || null;
  const status = strongest?.classification || "insufficient_evidence";
  jsonResponse(res, 200, {
    status: "completed",
    provider: "azure_ai_search",
    retrieval_mode: retrieval.retrieval_mode,
    duplicate_check: {
      status,
      score_sources: ["vector_similarity", "lexical_overlap", "graph_proximity", "scope_compatibility"],
      thresholds: {
        strong_duplicate: "vector >= 0.88 and lexical >= 0.35, or lexical >= 0.8, with compatible scope",
        near_match: "vector >= 0.72 and lexical >= 0.15, or graph >= 0.7, or lexical >= 0.5",
        related_only: "vector >= 0.55 or graph proximity present",
      },
    },
    merge_candidates: mergeCandidates,
    recommended_action: strongest?.recommended_action || "hold_evidence_pending",
    retrieval,
  });
}

function learningDispatchUrl() {
  const explicit = String(process.env.N8N_LEARNING_AGENT_DISPATCH_WEBHOOK_URL || "").trim();
  if (explicit) return explicit;
  const base = String(process.env.N8N_API_BASE_URL || "").trim().replace(/\/+$/, "");
  return base ? `${base}/webhook/meids/learning/dispatch` : "";
}

function postTurnLearningEnabled() {
  return !["false", "0", "off", "disabled"].includes(String(process.env.MEIDS_POST_TURN_LEARNING_ENABLED || "true").toLowerCase());
}

function firstTruthyObject(...values) {
  for (const value of values) {
    if (!value) continue;
    if (value === true) return { recommended: true };
    if (typeof value === "string") return { summary: value };
    if (typeof value === "object") return value;
  }
  return null;
}

function traceLearningRecommendation(record = {}) {
  const response = record.response || {};
  const output = response.output || record.output || {};
  const delegateOutput = output.delegate_result?.output || {};
  return firstTruthyObject(
    output.trace_learning_recommended,
    output.learning_recommended,
    output.learning?.trace_learning_recommended,
    delegateOutput.trace_learning_recommended,
    response.trace?.trace_learning_recommended,
    record.trace_learning_recommended,
  );
}

function postTurnLearningPayloadFromTrace(record = {}) {
  const recommendation = traceLearningRecommendation(record);
  if (!recommendation) return null;
  const response = record.response || {};
  const output = response.output || record.output || {};
  const trace = record.trace && typeof record.trace === "object" ? record.trace : {};
  const learningContext = record._learning_context && typeof record._learning_context === "object"
    ? record._learning_context
    : {};
  const inputSummary = record.input_summary || trace.input_summary || "";
  const outputSummary = record.output_summary || trace.output_summary || output.summary || output.answer || "";
  const interactionSummary = recommendation.summary
    || [inputSummary && `User input: ${inputSummary}`, outputSummary && `Actor output: ${outputSummary}`]
      .filter(Boolean)
      .join("\n");
  return {
    request_id: record.request_id || response.request_id || makeId("learn"),
    trace_id: record.trace_id || response.trace?.trace_id || "",
    trace_chain_id: record.trace_chain_id || response.trace?.trace_chain_id || "",
    source_agent_id: record.agent_id || response.agent_id || "",
    source_type: "agent_trace",
    query: interactionSummary,
    source_interaction_summary: interactionSummary,
    trace_learning_recommended: recommendation,
    knowledge_access_token: learningContext.knowledge_access_token || "",
    tenant_id: learningContext.tenant_id || record.tenant_id || "",
    user_id: learningContext.user_id || record.user_id || "",
    twin_id: learningContext.twin_id || record.twin_id || "",
    organization_id: learningContext.organization_id || record.tenant_id || "",
    source_trace: {
      agent_id: record.agent_id || "",
      target_agent: record.target_agent || "",
      route_decision: record.route_decision || "",
      status: record.status || "",
      handoff_status: record.handoff_status || "",
      approval_required: Boolean(record.approval_required),
      input_summary: inputSummary,
      output_summary: outputSummary,
    },
    target_review_state: recommendation.review_state || "review_needed",
  };
}

async function dispatchPostTurnLearning(payload) {
  const dispatchUrl = learningDispatchUrl();
  if (!dispatchUrl) {
    const error = new Error("Post-turn Learning dispatch URL is not configured.");
    error.statusCode = 503;
    throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(dispatchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dispatch_type: "post_turn_learning",
        source: "meids_backend",
        created_at: new Date().toISOString(),
        ...payload,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Learning Agent dispatch returned ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function queuePostTurnLearning(record) {
  if (!postTurnLearningEnabled()) return;
  if (record?.agent_id === "learning_agent") return;
  const payload = postTurnLearningPayloadFromTrace(record);
  if (!payload) return;
  dispatchPostTurnLearning(payload).catch(() => {});
}

async function handlePostTurnLearning(req, res) {
  const body = await readBody(req);
  if (!learningDispatchUrl()) {
    jsonResponse(res, 503, {
      status: "blocked",
      error: "Post-turn Learning dispatch requires N8N_LEARNING_AGENT_DISPATCH_WEBHOOK_URL or N8N_API_BASE_URL.",
    });
    return;
  }
  dispatchPostTurnLearning(body).catch(() => {});
  jsonResponse(res, 202, {
    status: "accepted",
    dispatch: "post_turn_learning",
    target: "learning_agent",
  });
}

function backendHealthPayload() {
  const adminGate = n8nAdminGate();
  const transcription = openAiTranscriptionConfig();
  return {
    status: "ok",
    runtime: "meids-agent-backend-proxy",
    storage: {
      mode: postgresEnabled() ? "postgres" : "file",
      postgres_configured: Boolean(process.env.DATABASE_URL || process.env.DATABASE_HOST),
      data_dir: postgresEnabled() ? "" : DATA_DIR,
    },
    n8n_admin: {
      status: adminGate.ready ? "ready" : "blocked",
      missing: adminGate.missing,
    },
    voice_transcription: {
      status: transcription.configured ? "configured" : "blocked",
      provider: transcription.provider,
      base_url_configured: Boolean(transcription.baseUrl),
      model: transcription.model,
      mode: transcription.mode,
      missing: transcription.missing,
      reason: transcription.configured
        ? "An explicit audio-input model and transcription transport are configured. Provider support is verified on each transcription request."
        : "A gateway key alone does not enable speech-to-text. Configure an explicit transcription model exposed by the provider.",
    },
    vector_search: azureSearchStatusFromConfig(azureSearchConfigFromEnv()),
    agents: Object.fromEntries(Object.values(AGENTS).map((agent) => [
      agent.id,
      { configured: Boolean(process.env[agent.urlEnv]), url_env: agent.urlEnv },
    ])),
  };
}

function frontendStatusPayload() {
  const health = backendHealthPayload();
  return {
    status: health.status,
    active_twin: process.env.MEIDS_ACTIVE_TWIN || "florian",
    ai_provider: process.env.MEIDS_AI_PROVIDER || "eraneos-ai-gateway",
    openai_configured: health.voice_transcription.status === "configured",
    guardrail_policy: process.env.MEIDS_GUARDRAIL_POLICY || "approval-gated",
    app_version: process.env.MEIDS_APP_VERSION || "backend-proxy",
    n8n_chat: {
      configured: Boolean(process.env.N8N_ACTOR_TWIN_WEBHOOK_URL),
    },
    voice_transcription: health.voice_transcription,
    vector_search: health.vector_search,
    capabilities: {
      twins: { status: "ready", persistence: "postgresql" },
      twin_pictures: { status: "ready", persistence: "postgresql_bounded_data_url" },
      source_ingest: { status: "ready", formats: ["txt", "md", "json", "csv", "yaml", "yml", "xml"] },
      binary_document_extraction: { status: "unavailable", reason: "Document extraction worker is not deployed." },
      knowledge: { status: "ready", persistence: "postgresql_outbox" },
      voice_concepts: { status: "ready", transcription: health.voice_transcription.status },
      skills: { status: "ready", routing: "actor_twin_to_butler_workflow_tool" },
      graph: { status: "ready", source: "governed_okf_concepts" },
      activity: { status: "ready", source: "tenant_scoped_audit" },
      agents: { status: "ready", delegation: "call_n8n_workflow_tool_first" },
    },
  };
}

async function backendReadinessPayload() {
  const health = backendHealthPayload();
  if (!postgresEnabled()) {
    health.storage.database_status = "not_applicable";
    return health;
  }

  try {
    const pool = await getPgPool();
    const database = await pool.query("SELECT to_regclass('knowledge.graph_edge') AS graph_edge");
    health.storage.database_status = "ready";
    health.storage.graph_persistence = database.rows[0]?.graph_edge ? "ready" : "migration_required";
    try {
      const statusPath = path.join(process.env.TEMP || "/tmp", "meids-migration-status.json");
      const migrationStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));
      health.storage.migration_status = migrationStatus.status;
      health.storage.migration_checked_at = migrationStatus.checked_at;
    } catch {}
    return health;
  } catch (error) {
    health.status = "degraded";
    health.storage.database_status = "error";
    health.storage.database_error = String(error?.message || error);
    return health;
  }
}

function parseAzureClientPrincipal(req) {
  const encoded = req.headers["x-ms-client-principal"];
  if (encoded) {
    try {
      const raw = Buffer.from(String(encoded), "base64").toString("utf8");
      const principal = JSON.parse(raw);
      const userId = String(principal?.userId || "").trim().toLowerCase();
      const userDetails = String(principal?.userDetails || "").trim().toLowerCase();
      if (["anonymous", "authenticated"].includes(userId) || userDetails === "anonymous") return null;
      if (principal?.userId || principal?.userDetails) return principal;
    } catch (error) {
      return null;
    }
  }
  const userId = req.headers["x-ms-client-principal-id"];
  const userName = req.headers["x-ms-client-principal-name"];
  if (userId || userName) {
    const normalizedUserId = String(userId || "").trim().toLowerCase();
    const normalizedUserName = String(userName || "").trim().toLowerCase();
    if (["anonymous", "authenticated"].includes(normalizedUserId) || normalizedUserName === "anonymous") return null;
    return {
      identityProvider: req.headers["x-ms-client-principal-idp"] || "aad",
      userId: String(userId || userName),
      userDetails: String(userName || userId),
      userRoles: String(req.headers["x-ms-client-principal-roles"] || "")
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean),
      claims: [],
    };
  }
  return null;
}

function csvSetting(name, fallback = "") {
  return String(process.env[name] || fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function principalClaimValues(principal = {}, claimTypes = []) {
  const acceptedTypes = new Set(claimTypes.map((value) => String(value).toLowerCase()));
  return (Array.isArray(principal.claims) ? principal.claims : [])
    .filter((claim) => acceptedTypes.has(String(claim?.typ || claim?.type || "").toLowerCase()))
    .flatMap((claim) => {
      const value = claim?.val ?? claim?.value;
      return Array.isArray(value) ? value : [value];
    })
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function rawMeidsRolesFromPrincipal(principal = {}) {
  const platformRoles = Array.isArray(principal.userRoles) ? principal.userRoles : [];
  const claimRoles = principalClaimValues(principal, [
    "roles",
    "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
  ]);
  return [...new Set([...platformRoles, ...claimRoles]
    .filter((role) => !["anonymous", "authenticated"].includes(String(role).toLowerCase()))
    .map((role) => String(role).replace(/^meids[.:_-]/i, "").toLowerCase()))];
}

function explicitMeidsRolesFromPrincipal(principal = {}) {
  return rawMeidsRolesFromPrincipal(principal)
    .map((role) => ["user", "employee"].includes(role) ? "viewer" : role);
}

function principalIdentityEmail(principal = {}) {
  return String(
    principalClaimValues(principal, [
      "email",
      "emails",
      "preferred_username",
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
    ])[0] || principal.userDetails || ""
  ).trim().toLowerCase();
}

function principalTenantId(principal = {}) {
  return principalClaimValues(principal, [
    "tid",
    "http://schemas.microsoft.com/identity/claims/tenantid",
  ])[0] || "";
}

function trustedApplicationPrincipal(principal = {}) {
  const identityProvider = String(principal.identityProvider || "").trim().toLowerCase();
  const allowedProviders = csvSetting("MEIDS_AUTH_ALLOWED_IDPS", "eraneos,aad")
    .map((value) => value.toLowerCase());
  if (!allowedProviders.includes(identityProvider)) return false;
  const expectedTenantId = String(process.env.MEIDS_ENTRA_TENANT_ID || "").trim().toLowerCase();
  const actualTenantId = principalTenantId(principal).trim().toLowerCase();
  return !expectedTenantId || !actualTenantId || actualTenantId === expectedTenantId;
}

function meidsRolesFromPrincipal(principal = {}) {
  const roles = explicitMeidsRolesFromPrincipal(principal);
  return roles.length ? roles : csvSetting("MEIDS_AUTH_DEFAULT_ROLES", "viewer");
}

function permissionsFromRoles(roles = []) {
  const set = new Set(roles.map((role) => String(role).toLowerCase()));
  const owner = set.has("owner");
  const admin = owner || set.has("admin");
  const editor = admin || set.has("editor");
  const reviewer = editor || set.has("reviewer");
  return {
    can_chat: true,
    can_create_twin: true,
    can_edit_own_knowledge: true,
    can_review_knowledge: reviewer,
    can_create_skill: editor,
    can_approve_skill_activation: owner,
    can_admin_agents: admin,
    can_manage_users: admin,
    can_access_admin_cockpit: admin,
    can_manage_admins: owner,
    can_manage_owners: false,
  };
}

function sessionFromPrincipal(principal, mapping = null) {
  const principalId = String(principal.userId || principal.userDetails || "").trim();
  const principalEmail = String(principal.userDetails || principal.userId || "").trim();
  const userId = mapping?.user_id || principalId;
  const email = mapping?.email || principalEmail;
  const allowedTwinIds = mapping
    ? (mapping.allowed_twin_ids || [])
    : csvSetting("MEIDS_AUTH_ALLOWED_TWIN_IDS", process.env.MEIDS_ACTIVE_TWIN || "florian");
  const roles = [...new Set([
    ...(mapping?.roles || []),
    ...meidsRolesFromPrincipal(principal),
  ])];
  const tenantId = mapping?.tenant_id || process.env.MEIDS_TENANT_ID || "eraneos";
  const activeTwinId = allowedTwinIds.includes(mapping?.active_twin_id)
    ? mapping.active_twin_id
    : allowedTwinIds[0] || "";
  const accessClaims = {
    tenant_id: tenantId,
    user_id: userId,
    active_twin_id: activeTwinId,
    allowed_twin_ids: allowedTwinIds,
    group_ids: mapping?.group_ids || csvSetting("MEIDS_AUTH_GROUP_IDS"),
    roles,
    visibility_scopes: ["private", "twin_shared", "team_shared", "org_shared"],
    knowledge_scope: "active_twin",
  };
  const accessTokenTtlSeconds = Math.max(300, Math.min(Number(process.env.MEIDS_KNOWLEDGE_ACCESS_TOKEN_TTL_SECONDS || 3600), 28_800));
  const knowledgeAccessToken = signKnowledgeAccessToken(accessClaims, { ttlSeconds: accessTokenTtlSeconds });
  return {
    status: "authenticated",
    provider: "microsoft_entra_id",
    external_users_allowed: true,
    user: {
      id: userId,
      email,
      name: mapping?.display_name || email,
      identity_provider: principal.identityProvider || "aad",
    },
    tenant: {
      id: tenantId,
      name: mapping?.tenant_name || process.env.MEIDS_TENANT_NAME || "Eraneos",
    },
    roles,
    active_twin_id: activeTwinId,
    allowed_twin_ids: allowedTwinIds,
    knowledge_access_contract: "meids.knowledge-access.v1",
    knowledge_access_token: knowledgeAccessToken,
    knowledge_access_expires_at: knowledgeAccessToken
      ? new Date(Date.now() + accessTokenTtlSeconds * 1000).toISOString()
      : "",
    permissions: permissionsFromRoles(roles),
    auth_context: {
      tenant_id: tenantId,
      user_id: userId,
      user_email: email,
      active_twin_id: activeTwinId,
      roles,
      allowed_twin_ids: allowedTwinIds,
      group_ids: accessClaims.group_ids,
      allowed_scopes: accessClaims.visibility_scopes,
      knowledge_scope: "active_twin",
      mapping_source: mapping ? "postgres" : "environment_bootstrap",
    },
  };
}

function databaseAuthorizationEnabled() {
  return ["true", "1", "on", "enabled"].includes(String(process.env.MEIDS_AUTHZ_DATABASE_ENABLED || "false").toLowerCase());
}

function jitAuthorizationEnabled() {
  return ["true", "1", "on", "enabled"].includes(String(process.env.MEIDS_AUTHZ_JIT_ENABLED || "false").toLowerCase());
}

function jitAuthorizationEntitlements(principal = {}) {
  const rawRoles = rawMeidsRolesFromPrincipal(principal);
  const explicitRoles = explicitMeidsRolesFromPrincipal(principal);
  const identityEmail = principalIdentityEmail(principal);
  const trustedApplicationUser = trustedApplicationPrincipal(principal);
  const employee = trustedApplicationUser && identityEmail.endsWith("@eraneos.com");
  const groupClaims = principalClaimValues(principal, [
    "groups",
    "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups",
  ]).map((value) => value.toLowerCase());
  const usersGroupId = String(process.env.MEIDS_AUTHZ_USER_GROUP_ID || "").trim().toLowerCase();
  const ownersGroupId = String(process.env.MEIDS_AUTHZ_OWNER_GROUP_ID || "").trim().toLowerCase();
  const ownerUserIds = csvSetting("MEIDS_AUTHZ_OWNER_USER_IDS").map((value) => value.toLowerCase());
  const principalId = String(principal.userId || "").trim().toLowerCase();
  const user = trustedApplicationUser
    || employee
    || rawRoles.includes("user")
    || explicitRoles.includes("owner")
    || Boolean(usersGroupId && groupClaims.includes(usersGroupId))
    || Boolean(ownersGroupId && groupClaims.includes(ownersGroupId));
  const owner = explicitRoles.includes("owner")
    || ownerUserIds.includes(principalId)
    || Boolean(ownersGroupId && groupClaims.includes(ownersGroupId));
  return { user, owner, employee, trustedApplicationUser, usersGroupId, ownersGroupId };
}

function jitUserId(principal = {}) {
  const objectId = String(principal.userId || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `entra-${objectId.slice(0, 24)}`;
}

async function ensureJitAuthorizationMapping(pool, principal) {
  if (!jitAuthorizationEnabled()) return false;
  const entitlement = jitAuthorizationEntitlements(principal);
  if (!entitlement.user) return false;
  const entraObjectId = String(principal.userId || "").trim().toLowerCase();
  const email = principalIdentityEmail(principal);
  if (!entraObjectId || !email) return false;
  const tenantId = String(process.env.MEIDS_TENANT_ID || "eraneos").trim().toLowerCase();
  const tenantName = String(process.env.MEIDS_TENANT_NAME || "Eraneos").trim();
  const displayName = principalClaimValues(principal, ["name", "displayname"])[0] || email;
  const userId = jitUserId(principal);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO identity.tenant (tenant_id, display_name, status)
      VALUES ($1, $2, 'active')
      ON CONFLICT (tenant_id) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'active'
    `, [tenantId, tenantName]);
    await client.query(`
      INSERT INTO identity.app_user
        (user_id, tenant_id, entra_object_id, email, display_name, status, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'active', now())
      ON CONFLICT (tenant_id, entra_object_id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        status = 'active',
        updated_at = now()
    `, [userId, tenantId, entraObjectId, email, displayName]);
    const resolvedUser = await client.query(`
      SELECT user_id FROM identity.app_user
      WHERE tenant_id = $1 AND lower(entra_object_id) = lower($2)
    `, [tenantId, entraObjectId]);
    const resolvedUserId = resolvedUser.rows[0]?.user_id;
    await client.query(`
      INSERT INTO identity.user_application_role (tenant_id, user_id, role, granted_by)
      VALUES ($1, $2, 'user', $2)
      ON CONFLICT (tenant_id, user_id, role) DO NOTHING
    `, [tenantId, resolvedUserId]);
    if (entitlement.owner) {
      await client.query(`
        INSERT INTO identity.user_application_role (tenant_id, user_id, role, granted_by)
        VALUES ($1, $2, 'owner', 'bootstrap-owner')
        ON CONFLICT (tenant_id, user_id, role) DO NOTHING
      `, [tenantId, resolvedUserId]);
    } else {
      await client.query(`
        DELETE FROM identity.user_application_role
        WHERE tenant_id = $1 AND user_id = $2 AND role = 'owner'
      `, [tenantId, resolvedUserId]);
    }
    const groupMappings = [
      entitlement.usersGroupId && { groupId: "meids-users", entraGroupId: entitlement.usersGroupId, displayName: "Me.IDs Users" },
      entitlement.owner && entitlement.ownersGroupId
        ? { groupId: "meids-owners", entraGroupId: entitlement.ownersGroupId, displayName: "Me.IDs Owners" }
        : null,
    ].filter(Boolean);
    for (const group of groupMappings) {
      await client.query(`
        INSERT INTO identity.security_group (group_id, tenant_id, display_name, entra_group_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (group_id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          entra_group_id = EXCLUDED.entra_group_id
      `, [group.groupId, tenantId, group.displayName, group.entraGroupId]);
      await client.query(`
        INSERT INTO identity.user_group (tenant_id, user_id, group_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (tenant_id, user_id, group_id) DO NOTHING
      `, [tenantId, resolvedUserId, group.groupId]);
    }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function resolveAuthorizationMapping(principal) {
  if (!databaseAuthorizationEnabled()) return null;
  const pool = await getPgPool();
  if (!pool) {
    const error = new Error("Database authorization is enabled but PostgreSQL is unavailable.");
    error.statusCode = 503;
    throw error;
  }
  const principalId = String(principal.userId || "").trim();
  const principalEmail = String(principal.userDetails || "").trim();
  await ensureJitAuthorizationMapping(pool, principal);
  const result = await pool.query(`
    SELECT
      u.user_id,
      u.email,
      u.display_name,
      u.tenant_id,
      u.active_twin_id,
      tenant.display_name AS tenant_name,
      COALESCE((
        SELECT array_agg(DISTINCT access.twin_id ORDER BY access.twin_id)
        FROM twin.user_twin_access access
        WHERE access.tenant_id = u.tenant_id AND access.user_id = u.user_id
      ), ARRAY[]::text[]) AS allowed_twin_ids,
      COALESCE((
        SELECT array_agg(DISTINCT app_role.role ORDER BY app_role.role)
        FROM identity.user_application_role app_role
        WHERE app_role.tenant_id = u.tenant_id AND app_role.user_id = u.user_id
      ), ARRAY['user']::text[]) AS roles
    FROM identity.app_user u
    JOIN identity.tenant tenant ON tenant.tenant_id = u.tenant_id
    WHERE u.status = 'active'
      AND (lower(u.entra_object_id) = lower($1) OR lower(u.email) = lower($2))
  `, [principalId, principalEmail]);
  const user = result.rows[0];
  if (!user) {
    const error = new Error("The signed-in identity has no active Me.IDs production mapping.");
    error.statusCode = 403;
    throw error;
  }
  const groups = await pool.query(`
    SELECT group_id FROM identity.user_group
    WHERE tenant_id = $1 AND user_id = $2
    ORDER BY group_id
  `, [user.tenant_id, user.user_id]);
  return {
    ...user,
    allowed_twin_ids: user.allowed_twin_ids || [],
    roles: user.roles || [],
    group_ids: groups.rows.map((row) => row.group_id),
  };
}

const TWIN_PROFILE_FIELDS = [
  "organization",
  "default_language",
  "role_context",
  "tone",
  "workstreams",
  "stakeholders",
  "risk_posture",
  "purpose",
  "decision_principles",
  "escalation_boundaries",
  "success_metrics",
  "source_intake_notes",
  "voice_provider",
  "voice_id",
  "voice_label",
  "voice_instructions",
  "voice_consent_ref",
  "picture_path",
  "picture_uploaded_at",
  "picture_focus_x",
  "picture_focus_y",
];

function cleanTwinId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function twinProfileFromBody(body = {}, existing = {}) {
  const profile = { ...(existing && typeof existing === "object" ? existing : {}) };
  for (const field of TWIN_PROFILE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    if (["picture_focus_x", "picture_focus_y"].includes(field)) {
      const number = Number(body[field]);
      profile[field] = Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 50;
    } else {
      profile[field] = String(body[field] || "").trim().slice(0, 10_000);
    }
  }
  profile.default_language = profile.default_language || "en";
  profile.risk_posture = profile.risk_posture || "balanced";
  return profile;
}

function twinResponseRow(row = {}) {
  const profile = row.profile && typeof row.profile === "object" ? row.profile : {};
  const completenessFields = [
    "organization",
    "role_context",
    "tone",
    "purpose",
    "decision_principles",
    "escalation_boundaries",
    "success_metrics",
    "source_intake_notes",
  ];
  const completedFields = completenessFields.filter((field) => String(profile[field] || "").trim()).length;
  return {
    ...profile,
    twin_id: row.twin_id,
    tenant_id: row.tenant_id,
    owner_user_id: row.owner_user_id,
    display_name: row.display_name,
    status: row.status,
    access_role: row.access_role,
    created_at: row.created_at,
    updated_at: row.updated_at,
    profile_completeness: completedFields / completenessFields.length,
  };
}

async function requireTwinRequestMapping(req) {
  if (!databaseAuthorizationEnabled()) {
    const error = new Error("Twin persistence requires database-backed authorization.");
    error.statusCode = 503;
    throw error;
  }
  const principal = parseAzureClientPrincipal(req);
  if (!principal) {
    const error = new Error("Microsoft Entra authentication is required.");
    error.statusCode = 401;
    throw error;
  }
  return resolveAuthorizationMapping(principal);
}

async function requireKnowledgeRequestMapping(req, body = {}) {
  const principal = parseAzureClientPrincipal(req);
  if (principal) return resolveAuthorizationMapping(principal);
  const access = knowledgeAccessContextFromRequest(req, body);
  if (access?.tenant_id && access?.user_id && access?.allowed_twin_ids?.length) {
    return {
      tenant_id: access.tenant_id,
      user_id: access.user_id,
      active_twin_id: access.active_twin_id,
      allowed_twin_ids: access.allowed_twin_ids,
      group_ids: access.group_ids || [],
      roles: access.roles || [],
    };
  }
  const error = new Error("Microsoft Entra authentication or a signed knowledge access token is required.");
  error.statusCode = 401;
  error.code = "blocked_auth_context";
  throw error;
}

async function handleKnowledgeStage(req, res) {
  if (!postgresEnabled()) {
    const error = new Error("Knowledge persistence requires PostgreSQL storage mode.");
    error.statusCode = 503;
    throw error;
  }
  const body = await readBody(req);
  const mapping = await requireKnowledgeRequestMapping(req, body);
  jsonResponse(res, 201, await stageKnowledge(await getPgPool(), mapping, body));
}

async function handleLearningIncrement(req, res) {
  if (!postgresEnabled()) {
    const error = new Error("Learning persistence requires PostgreSQL storage mode.");
    error.statusCode = 503;
    throw error;
  }
  const body = await readBody(req);
  const mapping = await requireKnowledgeRequestMapping(req, body);
  jsonResponse(res, 201, await stageLearning(await getPgPool(), mapping, body));
}

async function handleKnowledgePromote(req, res) {
  if (!postgresEnabled()) {
    const error = new Error("Knowledge promotion requires PostgreSQL storage mode.");
    error.statusCode = 503;
    throw error;
  }
  const body = await readBody(req);
  const mapping = await requireKnowledgeRequestMapping(req, body);
  if (String(body.decision || "approve").toLowerCase() === "reject") {
    jsonResponse(res, 200, await rejectKnowledge(await getPgPool(), mapping, body));
    return;
  }
  jsonResponse(res, 200, await promoteKnowledge(await getPgPool(), mapping, body));
}

async function handleKnowledgeReject(req, res) {
  if (!postgresEnabled()) {
    const error = new Error("Knowledge rejection requires PostgreSQL storage mode.");
    error.statusCode = 503;
    throw error;
  }
  const body = await readBody(req);
  if (String(body.decision || "reject").toLowerCase() !== "reject") {
    const error = new Error("The knowledge review endpoint currently supports decision=reject only.");
    error.statusCode = 400;
    throw error;
  }
  const mapping = await requireKnowledgeRequestMapping(req, body);
  jsonResponse(res, 200, await rejectKnowledge(await getPgPool(), mapping, body));
}

async function handleKnowledgeBackfill(req, res) {
  if (!postgresEnabled()) {
    const error = new Error("Knowledge backfill requires PostgreSQL storage mode.");
    error.statusCode = 503;
    throw error;
  }
  const body = await readBody(req);
  const mapping = await requireKnowledgeRequestMapping(req, body);
  jsonResponse(res, 200, await backfillKnowledgeSearch(await getPgPool(), mapping, body));
}

const APPLICATION_ROLES = new Set(["user", "editor", "admin", "owner"]);

async function requireApplicationManager(req) {
  const mapping = await requireTwinRequestMapping(req);
  const roles = new Set((mapping.roles || []).map((role) => String(role).toLowerCase()));
  if (!roles.has("owner") && !roles.has("admin")) {
    const error = new Error("Owner or admin authorization is required.");
    error.statusCode = 403;
    throw error;
  }
  return mapping;
}

async function handleAdminUsersList(req, res) {
  const mapping = await requireApplicationManager(req);
  const result = await (await getPgPool()).query(`
    SELECT
      app_user.user_id,
      app_user.email,
      app_user.display_name,
      app_user.status,
      app_user.active_twin_id,
      app_user.created_at,
      app_user.updated_at AS last_seen_at,
      COALESCE((
        SELECT array_agg(role_row.role ORDER BY role_row.role)
        FROM identity.user_application_role role_row
        WHERE role_row.tenant_id = app_user.tenant_id AND role_row.user_id = app_user.user_id
      ), ARRAY['user']::text[]) AS roles,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'twin_id', twin_access.twin_id,
          'display_name', twin_row.display_name,
          'status', twin_row.status,
          'access_role', twin_access.access_role
        ) ORDER BY twin_row.display_name, twin_access.twin_id)
        FROM twin.user_twin_access twin_access
        JOIN twin.twin twin_row
          ON twin_row.tenant_id = twin_access.tenant_id
          AND twin_row.twin_id = twin_access.twin_id
        WHERE twin_access.tenant_id = app_user.tenant_id
          AND twin_access.user_id = app_user.user_id
      ), '[]'::jsonb) AS twins
    FROM identity.app_user app_user
    WHERE app_user.tenant_id = $1
    ORDER BY app_user.display_name, app_user.email
  `, [mapping.tenant_id]);
  const users = result.rows.map((user) => ({
    ...user,
    identity_type: String(user.email || "").toLowerCase().endsWith("@eraneos.com") ? "employee" : "guest",
    twin_count: Array.isArray(user.twins) ? user.twins.length : 0,
    authorization_status: user.status !== "active"
      ? "disabled"
      : Array.isArray(user.twins) && user.twins.length
        ? "provisioned"
        : "onboarding",
    owner_managed_in_entra: Array.isArray(user.roles) && user.roles.includes("owner"),
  }));
  jsonResponse(res, 200, { users, role_policy: adminRolePolicy(mapping) });
}

function adminRolePolicy(mapping = {}) {
  const actorRoles = new Set((mapping.roles || []).map((role) => String(role).toLowerCase()));
  return {
    assignable_roles: actorRoles.has("owner") ? ["user", "editor", "admin"] : ["user", "editor"],
    owner_role_source: "microsoft_entra",
    owner_role_mutable: false,
  };
}

async function withAdminContext(mapping, callback) {
  const client = await (await getPgPool()).connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [mapping.tenant_id]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [mapping.user_id]);
    await client.query("SELECT set_config('app.allowed_twin_ids', $1, true)", [(mapping.allowed_twin_ids || []).join(",")]);
    await client.query("SELECT set_config('app.group_ids', $1, true)", [(mapping.group_ids || []).join(",")]);
    await client.query("SELECT set_config('app.roles', $1, true)", [(mapping.roles || []).join(",")]);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function handleAdminOverview(req, res) {
  const mapping = await requireApplicationManager(req);
  const metrics = await withAdminContext(mapping, async (client) => {
    const [users, twins, knowledge, learning, outbox, traces, approvals] = await Promise.all([
      client.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status = 'active')::int AS active,
        count(*) FILTER (WHERE updated_at >= now() - interval '30 days')::int AS active_30d
        FROM identity.app_user WHERE tenant_id = $1`, [mapping.tenant_id]),
      client.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status = 'active')::int AS active,
        count(*) FILTER (WHERE status = 'draft')::int AS draft,
        count(*) FILTER (WHERE status = 'archived')::int AS archived
        FROM twin.twin WHERE tenant_id = $1`, [mapping.tenant_id]),
      client.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE review_state IN ('review_needed', 'updated'))::int AS review_needed,
        count(*) FILTER (WHERE review_state = 'approved')::int AS approved,
        count(*) FILTER (WHERE review_state = 'rejected')::int AS rejected
        FROM knowledge.concept WHERE tenant_id = $1`, [mapping.tenant_id]),
      client.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE review_state IN ('review_needed', 'updated'))::int AS review_needed
        FROM learning.increment WHERE tenant_id = $1`, [mapping.tenant_id]),
      client.query(`SELECT count(*) FILTER (WHERE status IN ('pending', 'processing'))::int AS pending,
        count(*) FILTER (WHERE status IN ('failed', 'dead_letter'))::int AS failed,
        COALESCE(max(EXTRACT(EPOCH FROM (now() - created_at))) FILTER (WHERE status IN ('pending', 'processing')), 0)::int AS oldest_pending_seconds
        FROM runtime.outbox_event WHERE tenant_id = $1`, [mapping.tenant_id]),
      client.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS last_24h,
        count(*) FILTER (WHERE created_at >= now() - interval '24 hours' AND lower(status) IN ('failed', 'error'))::int AS failed_24h,
        count(DISTINCT agent_id) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS agents_24h
        FROM public.agent_traces`),
      client.query(`SELECT count(*) FILTER (WHERE status = 'pending_human_approval')::int AS pending
        FROM public.agent_approval_queue`),
    ]);
    return {
      users: users.rows[0],
      twins: twins.rows[0],
      knowledge: knowledge.rows[0],
      learning: learning.rows[0],
      outbox: outbox.rows[0],
      traces: traces.rows[0],
      approvals: approvals.rows[0],
    };
  });
  const health = await backendReadinessPayload();
  jsonResponse(res, 200, {
    status: "ok",
    generated_at: new Date().toISOString(),
    metrics,
    health,
    usage_coverage: {
      source: "backend_agent_traces",
      level: "partial",
      note: "Embedded n8n chat token totals require normalized post-turn telemetry and are not inferred from prompt content.",
    },
    access_requests: {
      source: "microsoft_entra_entitlement_management",
      embedded: false,
      note: "Pre-admission requests remain governed in Microsoft Entra My Access.",
    },
  });
}

async function handleAdminAudit(req, res, url) {
  const mapping = await requireApplicationManager(req);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 100), 250));
  const result = await withAdminContext(mapping, (client) => client.query(`
    SELECT event_id, actor_user_id, action, resource_type, resource_id, details, created_at
    FROM audit.event
    WHERE tenant_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [mapping.tenant_id, limit]));
  jsonResponse(res, 200, { events: result.rows });
}

async function handleAdminUserRoles(req, res) {
  const mapping = await requireApplicationManager(req);
  const body = await readBody(req);
  const targetUserId = String(body.user_id || "").trim().toLowerCase();
  const requestedRoles = [...new Set((Array.isArray(body.roles) ? body.roles : [])
    .map((role) => String(role).trim().toLowerCase())
    .filter(Boolean))];
  if (!targetUserId || requestedRoles.some((role) => !APPLICATION_ROLES.has(role))) {
    const error = new Error("A valid user_id and roles from user, editor, admin, owner are required.");
    error.statusCode = 400;
    throw error;
  }
  if (!requestedRoles.includes("user")) requestedRoles.unshift("user");
  const actorRoles = new Set((mapping.roles || []).map((role) => String(role).toLowerCase()));
  const pool = await getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const target = await client.query(`
      SELECT user_id FROM identity.app_user
      WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'
      FOR UPDATE
    `, [mapping.tenant_id, targetUserId]);
    if (!target.rowCount) {
      const error = new Error("The target user is not an active Me.IDs user.");
      error.statusCode = 404;
      throw error;
    }
    const existing = await client.query(`
      SELECT role FROM identity.user_application_role
      WHERE tenant_id = $1 AND user_id = $2
    `, [mapping.tenant_id, targetUserId]);
    const existingRoles = existing.rows.map((row) => row.role);
    const targetIsOwner = existingRoles.includes("owner");
    if (requestedRoles.includes("owner") && !targetIsOwner) {
      const error = new Error("The owner role is governed in Microsoft Entra and cannot be changed in the Admin Cockpit.");
      error.statusCode = 403;
      throw error;
    }
    const changesAdmin = existingRoles.includes("admin") !== requestedRoles.includes("admin");
    if (changesAdmin && !actorRoles.has("owner")) {
      const error = new Error("Only an owner can grant or revoke the admin role.");
      error.statusCode = 403;
      throw error;
    }
    const nextRoles = requestedRoles.filter((role) => role !== "owner");
    if (targetIsOwner) nextRoles.push("owner");
    await client.query(`
      DELETE FROM identity.user_application_role
      WHERE tenant_id = $1 AND user_id = $2
    `, [mapping.tenant_id, targetUserId]);
    for (const role of nextRoles) {
      await client.query(`
        INSERT INTO identity.user_application_role (tenant_id, user_id, role, granted_by)
        VALUES ($1, $2, $3, $4)
      `, [mapping.tenant_id, targetUserId, role, mapping.user_id]);
    }
    await client.query(`
      INSERT INTO audit.event (tenant_id, actor_user_id, action, resource_type, resource_id, details)
      VALUES ($1, $2, 'application_roles_updated', 'app_user', $3, $4::jsonb)
    `, [mapping.tenant_id, mapping.user_id, targetUserId, JSON.stringify({ before: existingRoles, after: nextRoles, owner_source: targetIsOwner ? "microsoft_entra" : null })]);
    await client.query("COMMIT");
    jsonResponse(res, 200, { status: "updated", user_id: targetUserId, roles: nextRoles });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ownedTwin(pool, mapping, twinId, roles = ["owner", "editor"]) {
  const result = await pool.query(`
    SELECT twin_row.*, access.access_role
    FROM twin.twin twin_row
    JOIN twin.user_twin_access access
      ON access.tenant_id = twin_row.tenant_id
      AND access.twin_id = twin_row.twin_id
    WHERE twin_row.tenant_id = $1
      AND access.user_id = $2
      AND twin_row.twin_id = $3
      AND access.access_role = ANY($4::text[])
  `, [mapping.tenant_id, mapping.user_id, twinId, roles]);
  if (!result.rows[0]) {
    const error = new Error("Twin not found or the signed-in user cannot modify it.");
    error.statusCode = 404;
    throw error;
  }
  return result.rows[0];
}

async function handleTwinsList(req, res, url) {
  const mapping = await requireTwinRequestMapping(req);
  const pool = await getPgPool();
  const includeArchived = String(url.searchParams.get("include_archived") || "").toLowerCase() === "true";
  const result = await pool.query(`
    SELECT twin_row.*, access.access_role
    FROM twin.twin twin_row
    JOIN twin.user_twin_access access
      ON access.tenant_id = twin_row.tenant_id
      AND access.twin_id = twin_row.twin_id
    WHERE twin_row.tenant_id = $1
      AND access.user_id = $2
      AND ($3::boolean OR twin_row.status <> 'archived')
    ORDER BY twin_row.updated_at DESC, twin_row.display_name ASC
  `, [mapping.tenant_id, mapping.user_id, includeArchived]);
  const twins = result.rows.map(twinResponseRow);
  const activeTwin = twins.some((twin) => twin.twin_id === mapping.active_twin_id && twin.status === "active")
    ? mapping.active_twin_id
    : twins.find((twin) => twin.status === "active")?.twin_id || "";
  jsonResponse(res, 200, { twins, active_twin: activeTwin, activity: [] });
}

async function handleTwinCreate(req, res) {
  const mapping = await requireTwinRequestMapping(req);
  const body = await readBody(req);
  const displayName = String(body.display_name || "").trim().slice(0, 200);
  if (!displayName) {
    const error = new Error("Twin display name is required.");
    error.statusCode = 400;
    throw error;
  }
  const pool = await getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const baseId = cleanTwinId(displayName) || `twin-${Date.now().toString(36)}`;
    let twinId = baseId;
    for (let suffix = 2; suffix < 100; suffix += 1) {
      const duplicate = await client.query("SELECT 1 FROM twin.twin WHERE twin_id = $1", [twinId]);
      if (!duplicate.rowCount) break;
      twinId = `${baseId.slice(0, 58)}-${suffix}`;
    }
    const created = await client.query(`
      INSERT INTO twin.twin (twin_id, tenant_id, owner_user_id, display_name, status, profile)
      VALUES ($1, $2, $3, $4, 'active', $5::jsonb)
      RETURNING *
    `, [twinId, mapping.tenant_id, mapping.user_id, displayName, JSON.stringify(twinProfileFromBody(body))]);
    await client.query(`
      INSERT INTO twin.user_twin_access (tenant_id, user_id, twin_id, access_role, granted_by)
      VALUES ($1, $2, $3, 'owner', $2)
    `, [mapping.tenant_id, mapping.user_id, twinId]);
    await client.query(`
      UPDATE identity.app_user
      SET active_twin_id = COALESCE(active_twin_id, $3), updated_at = now()
      WHERE tenant_id = $1 AND user_id = $2
    `, [mapping.tenant_id, mapping.user_id, twinId]);
    await client.query("COMMIT");
    jsonResponse(res, 201, {
      status: "created",
      twin: twinResponseRow({ ...created.rows[0], access_role: "owner" }),
      active_twin: mapping.active_twin_id || twinId,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function handleTwinUpdate(req, res) {
  const mapping = await requireTwinRequestMapping(req);
  const body = await readBody(req);
  const twinId = cleanTwinId(body.twin_id);
  const pool = await getPgPool();
  const current = await ownedTwin(pool, mapping, twinId);
  const displayName = String(body.display_name || current.display_name).trim().slice(0, 200);
  if (!displayName) {
    const error = new Error("Twin display name is required.");
    error.statusCode = 400;
    throw error;
  }
  const result = await pool.query(`
    UPDATE twin.twin
    SET display_name = $4, profile = $5::jsonb, updated_at = now()
    WHERE tenant_id = $1 AND owner_user_id = $2 AND twin_id = $3
    RETURNING *
  `, [mapping.tenant_id, current.owner_user_id, twinId, displayName, JSON.stringify(twinProfileFromBody(body, current.profile))]);
  jsonResponse(res, 200, { status: "updated", twin: twinResponseRow({ ...result.rows[0], access_role: current.access_role }) });
}

async function handleTwinStatus(req, res, status) {
  const mapping = await requireTwinRequestMapping(req);
  const body = await readBody(req);
  const twinId = cleanTwinId(body.twin_id);
  const pool = await getPgPool();
  const current = await ownedTwin(pool, mapping, twinId, ["owner"]);
  const result = await pool.query(`
    UPDATE twin.twin SET status = $4, updated_at = now()
    WHERE tenant_id = $1 AND owner_user_id = $2 AND twin_id = $3
    RETURNING *
  `, [mapping.tenant_id, current.owner_user_id, twinId, status]);
  if (status === "archived" && mapping.active_twin_id === twinId) {
    const fallback = await pool.query(`
      SELECT twin_row.twin_id
      FROM twin.twin twin_row
      JOIN twin.user_twin_access access ON access.tenant_id = twin_row.tenant_id AND access.twin_id = twin_row.twin_id
      WHERE twin_row.tenant_id = $1 AND access.user_id = $2 AND twin_row.status = 'active'
      ORDER BY twin_row.updated_at DESC LIMIT 1
    `, [mapping.tenant_id, mapping.user_id]);
    await pool.query(`UPDATE identity.app_user SET active_twin_id = $3, updated_at = now() WHERE tenant_id = $1 AND user_id = $2`, [mapping.tenant_id, mapping.user_id, fallback.rows[0]?.twin_id || null]);
  }
  jsonResponse(res, 200, {
    status: status === "archived" ? "archived" : "restored",
    twin: twinResponseRow({ ...result.rows[0], access_role: current.access_role }),
  });
}

async function handleTwinActivate(req, res) {
  const mapping = await requireTwinRequestMapping(req);
  const body = await readBody(req);
  const twinId = cleanTwinId(body.twin_id);
  const pool = await getPgPool();
  const current = await ownedTwin(pool, mapping, twinId, ["owner", "editor", "reviewer", "viewer"]);
  if (current.status !== "active") {
    const error = new Error("Only active twins can be selected.");
    error.statusCode = 409;
    throw error;
  }
  await pool.query(`
    UPDATE identity.app_user SET active_twin_id = $3, updated_at = now()
    WHERE tenant_id = $1 AND user_id = $2
  `, [mapping.tenant_id, mapping.user_id, twinId]);
  jsonResponse(res, 200, { status: "activated", active_twin: twinId });
}

function knowledgeAuthEnforced() {
  return ["true", "1", "on", "enabled"].includes(String(process.env.MEIDS_ENFORCE_KNOWLEDGE_AUTH || "false").toLowerCase());
}

function knowledgeAccessContextFromRequest(req, body = {}) {
  const authorization = String(req.headers.authorization || "");
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const token = bearer
    || body.knowledge_access_token
    || body.auth_context?.knowledge_access_token
    || body.metadata?.authorization?.knowledgeAccessToken
    || "";
  if (token) {
    const verified = verifyKnowledgeAccessToken(token);
    return {
      ...verified,
      knowledge_scope: body.knowledge_scope === "all_assigned_twins"
        ? "all_assigned_twins"
        : verified.knowledge_scope,
    };
  }
  if (knowledgeAuthEnforced()) {
    const error = new Error("A signed knowledge access token is required.");
    error.statusCode = signingKeyFromEnv() ? 401 : 503;
    error.code = signingKeyFromEnv() ? "blocked_auth_context" : "auth_configuration_error";
    throw error;
  }
  return null;
}

async function handleSession(req, res) {
  if (knowledgeAuthEnforced() && !signingKeyFromEnv()) {
    jsonResponse(res, 503, {
      status: "blocked",
      error: "Knowledge authorization is enabled but its signing key is unavailable.",
    });
    return;
  }
  const principal = parseAzureClientPrincipal(req);
  if (!principal) {
    const devEmail = String(process.env.MEIDS_AUTH_DEV_USER_EMAIL || "").trim();
    if (devEmail) {
      jsonResponse(res, 200, sessionFromPrincipal({
        identityProvider: "local-dev",
        userId: devEmail,
        userDetails: devEmail,
        userRoles: csvSetting("MEIDS_AUTH_DEFAULT_ROLES", "owner,reviewer"),
      }));
      return;
    }
    jsonResponse(res, 401, {
      status: "unauthenticated",
      provider: "microsoft_entra_id",
      login_url: "/.auth/login/eraneos",
      external_users_allowed: true,
    });
    return;
  }
  const mapping = await resolveAuthorizationMapping(principal);
  jsonResponse(res, 200, sessionFromPrincipal(principal, mapping));
}

const handleWorkspaceApi = createWorkspaceApi({
  getPgPool,
  requireTwinRequestMapping,
  requireKnowledgeRequestMapping,
  readBody,
  readMultipartForm,
  jsonResponse,
  stageKnowledge,
  promoteKnowledge,
  rejectKnowledge,
  proxyToN8n,
  transcribeAudio: transcribeAudioWithOpenAiCompatibleGateway,
  transcriptionConfig: openAiTranscriptionConfig,
  issueKnowledgeAccessToken(mapping, twinId) {
    return signKnowledgeAccessToken({
      tenant_id: mapping.tenant_id,
      user_id: mapping.user_id,
      active_twin_id: twinId,
      allowed_twin_ids: mapping.allowed_twin_ids || [],
      group_ids: mapping.group_ids || [],
      roles: mapping.roles || [],
      visibility_scopes: ["private", "twin_shared", "team_shared", "org_shared"],
      knowledge_scope: "active_twin",
    }, { ttlSeconds: Math.max(300, Math.min(Number(process.env.MEIDS_KNOWLEDGE_ACCESS_TOKEN_TTL_SECONDS || 3600), 28_800)) });
  },
});

async function routeRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  const requestId = String(req.headers["x-correlation-id"] || req.headers["x-request-id"] || crypto.randomUUID());
  req.meidsRequestId = requestId;
  res.setHeader("X-Correlation-ID", requestId);
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  try {
    if (req.method === "GET" && url.pathname === "/api/build-info") {
      const build = readBuildInfo();
      jsonResponse(res, build.available ? 200 : 503, build, { "Cache-Control": "no-store" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      const health = await backendReadinessPayload();
      jsonResponse(res, health.status === "ok" ? 200 : 503, health);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/status") {
      jsonResponse(res, 200, frontendStatusPayload());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/session") {
      await handleSession(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/admin/n8n/status") {
      await handleN8nAdminStatus(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/admin/users") {
      await handleAdminUsersList(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/admin/overview") {
      await handleAdminOverview(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/admin/audit") {
      await handleAdminAudit(req, res, url);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/admin/users/roles") {
      await handleAdminUserRoles(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/twins") {
      await handleTwinsList(req, res, url);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/twins") {
      await handleTwinCreate(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/twins/update") {
      await handleTwinUpdate(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/twins/active") {
      await handleTwinActivate(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/twins/archive") {
      await handleTwinStatus(req, res, "archived");
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/twins/restore") {
      await handleTwinStatus(req, res, "active");
      return;
    }
    if (req.method === "POST" && PATH_TO_AGENT[url.pathname]) {
      await handleAgentProxy(req, res, PATH_TO_AGENT[url.pathname]);
      return;
    }
    if (req.method === "GET" && ["/api/agents/traces", "/api/traces"].includes(url.pathname)) {
      jsonResponse(res, 200, { traces: await readTraces(Number(url.searchParams.get("limit") || 100)) });
      return;
    }
    if (req.method === "POST" && ["/api/agents/traces", "/api/traces"].includes(url.pathname)) {
      await handleManualTrace(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/agents/post-answer") {
      await handlePostAnswerTrace(req, res);
      return;
    }
    if (req.method === "GET" && ["/api/agents/approvals", "/api/approvals"].includes(url.pathname)) {
      jsonResponse(res, 200, { approvals: await readApprovals() });
      return;
    }
    if (req.method === "POST" && ["/api/agents/approvals", "/api/approvals"].includes(url.pathname)) {
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
    if (req.method === "POST" && url.pathname === "/api/knowledge/duplicate-check") {
      await handleKnowledgeDuplicateCheck(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/knowledge/stage") {
      await handleKnowledgeStage(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/knowledge/promote") {
      await handleKnowledgePromote(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/knowledge/reject") {
      await handleKnowledgeReject(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/knowledge/review") {
      await handleKnowledgeReject(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/knowledge/rebuild-search") {
      await handleKnowledgeBackfill(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/learning/increments") {
      await handleLearningIncrement(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/learning/post-turn") {
      await handlePostTurnLearning(req, res);
      return;
    }
    if (await handleWorkspaceApi(req, res, url)) return;
    const resumeMatch = url.pathname.match(/^\/api\/(?:agents\/)?approvals\/([^/]+)\/resume$/);
    if (req.method === "POST" && resumeMatch) {
      await handleResumeApproval(req, res, decodeURIComponent(resumeMatch[1]));
      return;
    }
    jsonResponse(res, 404, { status: "failed", error: "Not found" });
  } catch (error) {
    console.error(JSON.stringify({
      event: "request_failed",
      request_id: requestId,
      method: req.method,
      path: url.pathname,
      status_code: error.statusCode || 500,
      error: error.message || "Unhandled backend proxy error",
    }));
    jsonResponse(res, error.statusCode || 500, {
      status: "failed",
      ...(error.code ? { code: error.code } : {}),
      error: error.message || "Unhandled backend proxy error",
      correlation_id: requestId,
    });
  }
}

async function writeMigrationStatus(status) {
  const statusPath = path.join(process.env.TEMP || "/tmp", "meids-migration-status.json");
  await fs.writeFile(statusPath, JSON.stringify({ ...status, checked_at: new Date().toISOString() }));
}

function scheduleDatabaseMigrations() {
  if (String(process.env.MEIDS_AUTO_MIGRATE || "").toLowerCase() !== "true") {
    writeMigrationStatus({ status: "disabled" }).catch(() => {});
    return;
  }

  setTimeout(() => {
    const migration = spawn(process.execPath, [path.join(process.cwd(), "scripts", "run-postgres-migrations.cjs")], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk) => { output = (output + chunk.toString()).slice(-4_000); };
    migration.stdout.on("data", collect);
    migration.stderr.on("data", collect);
    const timeout = setTimeout(() => migration.kill("SIGTERM"), 120_000);
    timeout.unref();
    migration.on("error", (error) => {
      clearTimeout(timeout);
      writeMigrationStatus({ status: "failed", error: error.message }).catch(() => {});
      console.error(JSON.stringify({ event: "database_migration", status: "failed", error: error.message }));
    });
    migration.on("close", (code, signal) => {
      clearTimeout(timeout);
      const status = code === 0 ? "applied" : signal ? "timed_out" : "failed";
      writeMigrationStatus({ status, exit_code: code, signal }).catch(() => {});
      console[code === 0 ? "log" : "error"](JSON.stringify({
        event: "database_migration",
        status,
        exit_code: code,
        signal,
        output,
      }));
    });
  }, 5_000).unref();
}

if (require.main === module) {
  http.createServer(routeRequest).listen(PORT, () => {
    console.log(`MeIDs agent backend proxy listening on ${PORT}`);
    scheduleDatabaseMigrations();
    if (String(process.env.AZURE_SEARCH_STARTUP_PROBE || "").toLowerCase() === "true") {
      const config = azureSearchConfigFromEnv();
      getIndexReadiness(config)
        .then((indexReadiness) => {
          console.log(JSON.stringify({
            event: "azure_search_startup_probe",
            status: Object.values(indexReadiness).every((item) => item.status === "ready") ? "ready" : "blocked",
            authentication: config.authMode,
            indexes: indexReadiness,
          }));
        })
        .catch((error) => {
          console.error(JSON.stringify({
            event: "azure_search_startup_probe",
            status: "failed",
            authentication: config.authMode,
            status_code: error.statusCode || 500,
            error: error.message || "Azure AI Search startup probe failed",
          }));
        });
    }
    if (["true", "1", "on", "enabled"].includes(String(process.env.MEIDS_OUTBOX_PROJECTOR_ENABLED || "false").toLowerCase())) {
      let workerRunning = false;
      const intervalMs = Math.max(5_000, Number(process.env.MEIDS_OUTBOX_INTERVAL_MS || 15_000));
      const runWorker = async () => {
        if (workerRunning || !postgresEnabled()) return;
        workerRunning = true;
        try {
          const result = await processOutboxBatch(await getPgPool());
          if (result.claimed) console.log(JSON.stringify({ event: "outbox_projection", ...result }));
        } catch (error) {
          console.error(JSON.stringify({ event: "outbox_projection", status: "failed", error: error.message || String(error) }));
        } finally {
          workerRunning = false;
        }
      };
      setTimeout(runWorker, 3_000);
      setInterval(runWorker, intervalMs).unref();
    }
    if (!["false", "0", "off", "disabled"].includes(String(process.env.MEIDS_RUNTIME_JOB_WORKER_ENABLED || "true").toLowerCase())) {
      let runtimeWorkerRunning = false;
      const runtimeIntervalMs = Math.max(2_000, Number(process.env.MEIDS_RUNTIME_JOB_INTERVAL_MS || 5_000));
      const runRuntimeWorker = async () => {
        if (runtimeWorkerRunning || !postgresEnabled()) return;
        runtimeWorkerRunning = true;
        try {
          const result = await handleWorkspaceApi.processRuntimeJobs();
          if (result.claimed) console.log(JSON.stringify({ event: "runtime_background_jobs", ...result }));
        } catch (error) {
          console.error(JSON.stringify({ event: "runtime_background_jobs", status: "failed", error: error.message || String(error) }));
        } finally {
          runtimeWorkerRunning = false;
        }
      };
      setTimeout(runRuntimeWorker, 2_000);
      setInterval(runRuntimeWorker, runtimeIntervalMs).unref();
    }
  });
}

module.exports = {
  AGENTS,
  classifyDuplicateCandidate,
  summarizeDuplicateHit,
  normalizeAgentResponse,
  buildTraceRecord,
  buildApprovalRecord,
  routeRequest,
  decodeMultipartFilename,
};
