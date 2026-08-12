const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const currentPath = path.join(root, "workflows", "n8n", "actor-twin.workflow.json");
const blueprintPath = path.join(root, "workflows", "n8n", "implementations", "actor-twin-direct-orchestrator.workflow.json");
const outDir = path.join(root, "exports", "n8n-live-backups", "20260812-direct-orchestration");
const repoOutPath = path.join(root, "workflows", "n8n", "implementations", "actor-twin-direct-orchestrator.uat-live-urls.workflow.json");

const knowledgeUrl = "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/knowledge-fabric/ingest";
const butlerUrl = "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/agentic-butler/run";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Missing node: ${name}`);
  return clone(node);
}

const current = readJson(currentPath);
const blueprint = readJson(blueprintPath);

const receive = requireNode(current, "Receive request");
const actorAgent = requireNode(current, "Actor Twin AI Agent");
const chatModel = requireNode(current, "Actor Twin Chat Model");
const returnJson = requireNode(current, "Return JSON");

const blueprintActorAgent = requireNode(blueprint, "Actor Twin AI Agent");
const normalizeRoute = requireNode(blueprint, "Normalize route decision");
const switchByRoute = requireNode(blueprint, "Switch by route");
const callKnowledge = requireNode(blueprint, "Call Knowledge Fabric Agent");
const callButler = requireNode(blueprint, "Call Agentic Butler");
const finalizeResponse = requireNode(blueprint, "Finalize Actor Twin response");

receive.position = [0, 0];
actorAgent.position = [280, 0];
chatModel.position = [280, 240];
normalizeRoute.position = [560, 0];
switchByRoute.position = [820, 0];
callKnowledge.position = [1080, -120];
callButler.position = [1080, 120];
finalizeResponse.position = [1360, 0];
returnJson.position = [1600, 0];

actorAgent.parameters = {
  promptType: "define",
  text: "=Request envelope:\n{{ JSON.stringify($json.body || $json) }}\n\nReturn ONLY valid JSON with this shape:\n{\n  \"answer\": \"short user-facing answer candidate\",\n  \"route_decision\": {\n    \"decision\": \"answer_direct|retrieve_knowledge|ingest_or_stage_knowledge|activate_skill|create_skill|request_human_clarification\",\n    \"target_agent\": \"actor_twin|knowledge_fabric_agent|agentic_butler|human\",\n    \"intent\": \"answer_question|retrieve_context|ingest_concept|activate_skill|create_skill|clarify\",\n    \"visible_state\": \"answering|using_knowledge|capturing_knowledge|activating_skill|approval_required\",\n    \"approval_required\": false,\n    \"handoff_required\": false,\n    \"reason\": \"why this route was selected\"\n  }\n}",
  options: {
    systemMessage: "You are the MeIDs Actor Twin. You are the decision authority and orchestrator, not the worker. Interpret the user request, apply persona/risk/OKF context, and choose exactly one route_decision. Use answer_direct only when no downstream agent is needed. Use retrieve_knowledge or ingest_or_stage_knowledge for Knowledge Fabric Agent. Use activate_skill or create_skill for Agentic Butler. Never auto-approve generated skills or risky external actions. Return only valid JSON; no markdown fences.",
  },
};
actorAgent.notes = "MeIDs Actor Twin AI Agent. Decides route_decision; direct execution stays delegated to Knowledge Fabric Agent or Agentic Butler.";
normalizeRoute.parameters.jsCode = `const inputRoot = $('Receive request').first().json;
const input = inputRoot.body ?? inputRoot;
const ai = $json;
const executionId = typeof $execution !== 'undefined' && $execution.id ? $execution.id : Date.now();
const requestId = input.request_id || \`req_\${executionId}\`;
const aiText = ai.output || ai.text || ai.response || ai.message || '';

function safeJson(value) {
  if (value && typeof value === 'object') return value;
  const text = String(value || '').trim();
  if (!text) return null;
  const fenced = text.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  try { return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)); } catch { return null; }
}

function normalizeDecision(raw, embedded) {
  const value = raw ?? embedded?.route_decision ?? embedded?.output?.route_decision ?? null;
  if (typeof value === 'string') return { decision: value };
  if (value && typeof value === 'object') return value;
  return {};
}

function inferDecision(inputValue, embedded) {
  const query = JSON.stringify(inputValue?.input || inputValue || {}).toLowerCase();
  const embeddedText = JSON.stringify(embedded || {}).toLowerCase();
  const combined = \`\${query} \${embeddedText}\`;
  if (combined.includes('create skill') || combined.includes('new skill')) return 'create_skill';
  if (combined.includes('activate_skill') || combined.includes('skill') || combined.includes('day plan') || combined.includes('project-management-support')) return 'activate_skill';
  if (combined.includes('ingest') || combined.includes('upload') || combined.includes('transcript') || combined.includes('capture knowledge')) return 'ingest_or_stage_knowledge';
  if (combined.includes('retrieve') || combined.includes('knowledge') || combined.includes('context')) return 'retrieve_knowledge';
  return 'answer_direct';
}

const embedded = safeJson(ai) || safeJson(aiText) || {};
const explicit = input.context?.route_decision || normalizeDecision(null, embedded);
const decision = explicit.decision || inferDecision(input, embedded);
const delegationTarget = embedded.delegation?.target || embedded.delegate?.target_agent || null;
const targetAgent = explicit.target_agent || delegationTarget || (['retrieve_knowledge','ingest_or_stage_knowledge'].includes(decision) ? 'knowledge_fabric_agent' : ['activate_skill','create_skill'].includes(decision) ? 'agentic_butler' : decision === 'request_human_clarification' ? 'human' : 'actor_twin');
const intent = explicit.intent || input.intent || (decision === 'activate_skill' ? 'activate_skill' : decision === 'create_skill' ? 'create_skill' : decision === 'ingest_or_stage_knowledge' ? 'ingest_concept' : decision === 'retrieve_knowledge' ? 'retrieve_context' : decision === 'request_human_clarification' ? 'clarify' : 'answer_question');

const routeDecision = {
  decision,
  target_agent: targetAgent,
  intent,
  visible_state: explicit.visible_state || (decision === 'answer_direct' ? 'answering' : targetAgent === 'knowledge_fabric_agent' ? (decision === 'retrieve_knowledge' ? 'using_knowledge' : 'capturing_knowledge') : targetAgent === 'agentic_butler' ? 'activating_skill' : 'approval_required'),
  approval_required: Boolean(explicit.approval_required || decision === 'create_skill' || decision === 'request_human_clarification'),
  handoff_required: Boolean(explicit.handoff_required ?? (targetAgent !== 'actor_twin' && targetAgent !== 'human')),
  reason: explicit.reason || embedded.notes || 'Actor Twin route decision normalized for direct n8n orchestration.'
};

const delegateEnvelope = {
  envelope_version: input.envelope_version || '0.1.0',
  request_id: \`\${requestId}_\${routeDecision.target_agent}\`,
  timestamp: new Date().toISOString(),
  agent_id: routeDecision.target_agent,
  intent: routeDecision.intent,
  principal: input.principal || { twin_id: input.twin_id || input.input?.twin_id || 'florian', display_name: input.display_name || 'Florian' },
  input: {
    ...(input.input || {}),
    query: input.input?.query || input.input?.message || input.chatInput || input.message || '',
    skill_id: input.input?.skill_id || embedded.skill?.name || embedded.skill_id || undefined,
    actor_answer_candidate: embedded.output?.answer || embedded.answer || aiText
  },
  context: { ...(input.context || {}), called_by: 'actor_twin', route_decision: routeDecision, orchestration_model: 'uat_n8n_direct' },
  approval: input.approval || { required: false, reason: 'Delegated by Actor Twin route decision.' }
};

return [{ json: {
  input,
  ai_text: aiText,
  request_id: requestId,
  route_decision: routeDecision,
  delegate_envelope: delegateEnvelope,
  actor_answer_candidate: embedded.output?.answer || embedded.answer || aiText
} }];`;
callKnowledge.parameters.url = knowledgeUrl;
callKnowledge.notes = "UAT direct call to published Knowledge Fabric Agent. Replace with env var or backend proxy for production hardening.";
callButler.parameters.url = butlerUrl;
callButler.notes = "UAT direct call to published Agentic Butler. Replace with env var or backend proxy for production hardening.";

const workflow = {
  name: current.name || "MeIDs Actor Twin - staging",
  nodes: [
    receive,
    actorAgent,
    normalizeRoute,
    switchByRoute,
    callKnowledge,
    callButler,
    finalizeResponse,
    returnJson,
    chatModel,
  ],
  connections: {
    "Receive request": { main: [[{ node: "Actor Twin AI Agent", type: "main", index: 0 }]] },
    "Actor Twin AI Agent": { main: [[{ node: "Normalize route decision", type: "main", index: 0 }]] },
    "Normalize route decision": { main: [[{ node: "Switch by route", type: "main", index: 0 }]] },
    "Switch by route": {
      main: [
        [{ node: "Finalize Actor Twin response", type: "main", index: 0 }],
        [{ node: "Call Knowledge Fabric Agent", type: "main", index: 0 }],
        [{ node: "Call Agentic Butler", type: "main", index: 0 }],
        [{ node: "Finalize Actor Twin response", type: "main", index: 0 }],
        [{ node: "Finalize Actor Twin response", type: "main", index: 0 }],
      ],
    },
    "Call Knowledge Fabric Agent": { main: [[{ node: "Finalize Actor Twin response", type: "main", index: 0 }]] },
    "Call Agentic Butler": { main: [[{ node: "Finalize Actor Twin response", type: "main", index: 0 }]] },
    "Finalize Actor Twin response": { main: [[{ node: "Return JSON", type: "main", index: 0 }]] },
    "Actor Twin Chat Model": { ai_languageModel: [[{ node: "Actor Twin AI Agent", type: "ai_languageModel", index: 0 }]] },
  },
  settings: current.settings || { executionOrder: "v1" },
  staticData: null,
};

const wrapped = {
  schema_version: "0.1.0",
  exported_at: new Date().toISOString(),
  source: "MeIDs apply-ready Actor Twin direct orchestrator for UAT live URLs",
  workflow_id: current.workflow_id || "fDn8yXo3W41hh3yR",
  boundary: "UAT workflow uses direct public webhook URLs. Move to env vars or backend proxy for production hardening.",
  target_implementation_steps: blueprint.target_implementation_steps,
  workflow,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "actor-twin.direct-orchestrator.importable.json"), JSON.stringify(workflow, null, 2));
fs.writeFileSync(path.join(outDir, "actor-twin.direct-orchestrator.wrapped.json"), JSON.stringify(wrapped, null, 2));
fs.writeFileSync(repoOutPath, JSON.stringify(wrapped, null, 2));

console.log(JSON.stringify({
  status: "created",
  importable: path.join(outDir, "actor-twin.direct-orchestrator.importable.json"),
  wrapped: path.join(outDir, "actor-twin.direct-orchestrator.wrapped.json"),
  repo_blueprint: repoOutPath,
}, null, 2));
