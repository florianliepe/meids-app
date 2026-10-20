#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const backendUrl = String(process.env.MEIDS_BACKEND_URL || "https://meids-prod-backend-1853a19b.azurewebsites.net").replace(/\/+$/, "");
const workflowId = String(process.env.N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID || "7Ci86PxXipwvYpKv");
const applyLive = process.argv.includes("--apply");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function triggerExpression() {
  return "(() => { let root = {}; try { root = $('Receive workflow call').first().json; } catch (error) { try { root = $('Receive request').first().json; } catch (ignored) {} } return root.body || root; })()";
}

function patchWorkflow(workflow) {
  const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
  const prepareNode = {
    id: "prepare-production-duplicate-request",
    name: "Prepare duplicate request",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [160, 0],
    parameters: {
      jsCode: "const envelope = $json.body || $json; const context = envelope.context || {}; const input = envelope.input || envelope.candidate || envelope.concept || envelope; const candidate = { ...input, twin_id: input.twin_id || context.twin_id || envelope.twin_id || envelope.twin || '', organization_id: input.organization_id || context.organization_id || envelope.organization_id || 'default', query_vector: input.query_vector || input.content_vector || envelope.query_vector || envelope.content_vector }; const token = envelope.metadata?.authorization?.knowledgeAccessToken || envelope.authorization?.knowledgeAccessToken || envelope.knowledge_access_token || ''; return [{ json: { candidate, twin_id: candidate.twin_id, organization_id: candidate.organization_id, source_policy: envelope.source_policy || context.source_policy || input.source_policy || 'selected_pending', top: envelope.top || context.top || input.top || 8, knowledge_access_token: token, _auth_diagnostic: { present: Boolean(token), length: token.length, segments: token ? token.split('.').length : 0 } } }];",
    },
  };
  workflow.nodes = workflow.nodes.filter((node) => node.name !== prepareNode.name);
  workflow.nodes.push(prepareNode);
  const duplicate = byName.get("Score duplicate and merge evidence");
  if (!duplicate) throw new Error("Knowledge Fabric workflow is missing 'Score duplicate and merge evidence'.");
  duplicate.parameters.url = `${backendUrl}/api/knowledge/duplicate-check`;
  duplicate.parameters.sendHeaders = true;
  duplicate.parameters.headerParameters ||= { parameters: [] };
  duplicate.parameters.headerParameters.parameters ||= [];
  duplicate.parameters.headerParameters.parameters = duplicate.parameters.headerParameters.parameters
    .filter((item) => String(item.name).toLowerCase() !== "authorization");
  duplicate.parameters.jsonBody = "={{ JSON.stringify($json) }}";

  const attachDuplicate = byName.get("Attach duplicate score evidence");
  attachDuplicate.parameters.jsCode = `function getTriggerInput() {
  try { return $('Receive workflow call').first().json; } catch (error) {}
  try { return $('Receive request').first().json; } catch (error) {}
  return {};
}
const original = getTriggerInput();
const input = original.body ?? original;
const { authorization, knowledge_access_token, ...safeInput } = input;
const safeMetadata = { ...(safeInput.metadata || {}) };
delete safeMetadata.authorization;
const safeNestedInput = safeInput.input && typeof safeInput.input === 'object' ? { ...safeInput.input } : safeInput.input;
if (safeNestedInput && typeof safeNestedInput === 'object') {
  delete safeNestedInput.content_vector;
  delete safeNestedInput.query_vector;
}
return [{ json: {
  ...safeInput,
  input: safeNestedInput,
  metadata: safeMetadata,
  duplicate_score_evidence: $json,
  duplicate_check_boundary: {
    status: $json.duplicate_check?.status || 'insufficient_evidence',
    source: 'backend_duplicate_check',
    endpoint: '/api/knowledge/duplicate-check'
  }
} }];`;

  const agent = byName.get("Knowledge Fabric AI Agent");
  if (!agent.parameters.options.systemMessage.includes("Production persistence contract")) {
    agent.parameters.options.systemMessage = `${agent.parameters.options.systemMessage}\n\nProduction persistence contract\nReturn a JSON object without markdown fences. Include concept.title, concept.topic, concept.purpose, concept.wider_context, concept.how_to_apply, concept.what_else_to_know, concept.implications_and_results, concept.summary, concept.tags, concept.visibility_scope, evidence, and change_reason. Keep new or changed knowledge in review_needed or updated review state. Never include authorization tokens in model output.`;
  }
  agent.parameters.text = "=Request envelope with duplicate evidence:\n{{ JSON.stringify($json) }}\n\nReturn the production persistence contract as JSON without markdown fences.";

  const normalizer = byName.get("Contract response normalizer");
  normalizer.position = [700, 0];
  normalizer.parameters.jsCode = `function getTriggerInput() {
  try { return $('Receive workflow call').first().json; } catch (error) {}
  try { return $('Receive request').first().json; } catch (error) {}
  return {};
}
const inputRoot = getTriggerInput();
const input = inputRoot.body ?? inputRoot;
const sourceInput = input.input && typeof input.input === 'object' ? input.input : (input.concept || input.candidate || input);
const ai = $json;
const executionId = typeof $execution !== 'undefined' && $execution.id ? $execution.id : Date.now();
const requestId = input.request_id || input.live_probe?.request_id || \`req_\${executionId}\`;
const aiText = ai.output || ai.text || ai.response || ai.message || '';
const knowledgeAccessToken = input.metadata?.authorization?.knowledgeAccessToken || input.authorization?.knowledgeAccessToken || input.knowledge_access_token || '';
let parsed = {};
if (aiText && typeof aiText === 'object') parsed = aiText;
if (typeof aiText === 'string') {
  const cleaned = aiText.trim().replace(/^\x60\x60\x60(?:json)?/i, '').replace(/\x60\x60\x60$/, '').trim();
  try { parsed = JSON.parse(cleaned); } catch (error) { parsed = {}; }
}
const proposed = parsed.concept && typeof parsed.concept === 'object' ? parsed.concept : parsed;
const fallbackTitle = String(sourceInput.title || sourceInput.topic || sourceInput.name || input.title || input.topic || aiText || \`Knowledge increment \${requestId}\`).trim().slice(0, 300);
const concept = {
  twin_id: proposed.twin_id || sourceInput.twin_id || input.context?.twin_id || input.twin_id || input.twin || '',
  title: proposed.title || fallbackTitle,
  topic: proposed.topic || proposed.title || fallbackTitle,
  purpose: proposed.purpose || sourceInput.purpose || '',
  wider_context: proposed.wider_context || proposed.context || sourceInput.wider_context || sourceInput.context || '',
  how_to_apply: proposed.how_to_apply || proposed.application || sourceInput.how_to_apply || '',
  what_else_to_know: proposed.what_else_to_know || proposed.notes || sourceInput.what_else_to_know || '',
  implications_and_results: proposed.implications_and_results || proposed.what_then || sourceInput.implications_and_results || '',
  summary: proposed.summary || (typeof aiText === 'string' ? aiText : JSON.stringify(aiText)).slice(0, 10000),
  tags: Array.isArray(proposed.tags) ? proposed.tags : [],
  relations: Array.isArray(proposed.relations) ? proposed.relations : [],
  visibility_scope: proposed.visibility_scope || sourceInput.visibility_scope || 'private',
  content_vector: Array.isArray(proposed.content_vector) ? proposed.content_vector : (Array.isArray(sourceInput.content_vector) ? sourceInput.content_vector : undefined),
  change_reason: parsed.change_reason || proposed.change_reason || 'Knowledge Fabric agent staging'
};
const evidence = Array.isArray(parsed.evidence) ? parsed.evidence : (Array.isArray(input.evidence) ? input.evidence : []);
const response = {
  _knowledge_access_token: knowledgeAccessToken,
  envelope_version: input.envelope_version || '0.1.0',
  request_id: requestId,
  agent_id: 'knowledge_fabric_agent',
  status: 'completed',
  output: {
    summary: concept.summary || 'Knowledge Fabric AI Agent completed.',
    created_candidates: [concept],
    review_state: 'review_needed',
    graph_curator_trigger: 'candidate_edges_pending_review',
    vector_refresh: 'transactional_outbox_after_staging',
    contract_stage: 'production_persistence_candidate',
    persistence_candidate: concept,
    persistence_evidence: evidence,
    ai_agent: { integrated: true, node: 'Knowledge Fabric AI Agent' }
  },
  trace: { stored: true, trace_id: \`n8n_exec_\${executionId}\`, used_agents: ['knowledge_fabric_agent_ai_agent'], target_agent: 'knowledge_fabric_agent', route_decision: 'update_knowledge', handoff_status: 'handoff_completed', ai_agent_integrated: true }
};
return [{ json: response }];`;

  const stageNode = {
    id: "stage-production-knowledge",
    name: "Stage review-needed knowledge",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [940, 0],
    parameters: {
      method: "POST",
      url: `${backendUrl}/api/knowledge/stage`,
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: "Content-Type", value: "application/json" },
      ] },
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify({ concept: $json.output.persistence_candidate, source: { type: 'n8n_knowledge_fabric', repository_ref: $json.trace.trace_id }, evidence: $json.output.persistence_evidence || [], change_reason: $json.output.persistence_candidate.change_reason, knowledge_access_token: $json._knowledge_access_token }) }}`,
      options: { timeout: 15000 },
    },
  };
  const attachNode = {
    id: "attach-production-persistence",
    name: "Attach persistence result",
    notes: "Attaches the persistence receipt and removes internal vectors and authorization material from the frontend response.",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1180, 0],
    parameters: {
      jsCode: "const internal = $('Contract response normalizer').first().json; const { _knowledge_access_token, ...response } = internal; const sanitizeConcept = (value) => { if (!value || typeof value !== 'object') return value; const { content_vector, query_vector, ...safe } = value; return safe; }; const output = { ...response.output, created_candidates: (response.output.created_candidates || []).map(sanitizeConcept), persistence_candidate: sanitizeConcept(response.output.persistence_candidate), persistence: $json, review_state: $json.review_state || response.output.review_state }; return [{ json: { ...response, output, trace: { ...response.trace, persistence_status: $json.status || 'staged' } } }];",
    },
  };
  workflow.nodes = workflow.nodes.filter((node) => ![stageNode.name, attachNode.name].includes(node.name));
  workflow.nodes.push(stageNode, attachNode);
  const returnNode = byName.get("Return JSON");
  returnNode.position = [1420, 0];
  workflow.connections["Contract response normalizer"] = { main: [[{ node: stageNode.name, type: "main", index: 0 }]] };
  workflow.connections[stageNode.name] = { main: [[{ node: attachNode.name, type: "main", index: 0 }]] };
  workflow.connections[attachNode.name] = { main: [[{ node: "Return JSON", type: "main", index: 0 }]] };
  workflow.connections["Receive request"] = { main: [[{ node: prepareNode.name, type: "main", index: 0 }]] };
  workflow.connections["Receive workflow call"] = { main: [[{ node: prepareNode.name, type: "main", index: 0 }]] };
  workflow.connections[prepareNode.name] = { main: [[{ node: "Score duplicate and merge evidence", type: "main", index: 0 }]] };
  return workflow;
}

async function n8n(method, endpoint, body) {
  const base = String(process.env.N8N_API_BASE_URL || "").replace(/\/+$/, "");
  const key = String(process.env.N8N_API_KEY || "");
  if (!base || !key) throw new Error("N8N_API_BASE_URL and N8N_API_KEY are required for --apply.");
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers: { "Content-Type": "application/json", "X-N8N-API-KEY": key },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${method} ${endpoint} returned ${response.status}: ${text.slice(0, 500)}`);
  return data;
}

async function main() {
  const canonicalPath = path.join(root, "workflows", "n8n", "knowledge-fabric-agent.workflow.json");
  const canonical = patchWorkflow(readJson(canonicalPath));
  writeJson(canonicalPath, canonical);
  const importPath = path.join(root, "workflows", "n8n", "import-ready", "knowledge-fabric-agent.ai-agent.import.json");
  if (fs.existsSync(importPath)) writeJson(importPath, canonical);
  const result = { status: "canonical_updated", workflow_id: workflowId, backend_url: backendUrl, live_applied: false };
  if (applyLive) {
    const live = await n8n("GET", `/api/v1/workflows/${workflowId}`);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    const backup = path.join(root, "exports", "n8n-live-backups", `${stamp}-production-knowledge-persistence`);
    writeJson(path.join(backup, "knowledge-fabric.live-before.json"), live);
    const patched = patchWorkflow(live);
    const payload = { name: patched.name, nodes: patched.nodes, connections: patched.connections, settings: patched.settings || { executionOrder: "v1" }, staticData: patched.staticData ?? null };
    const updated = await n8n("PUT", `/api/v1/workflows/${workflowId}`, payload);
    // n8n 2.x separates the autosaved draft from the published production
    // version. This host retains the old webhook snapshot if an active workflow
    // is overwritten through the public API, so cycle publication before
    // publishing the current draft. Run this only in an agreed maintenance
    // window because the webhook is briefly unavailable.
    if (live.active) await n8n("POST", `/api/v1/workflows/${workflowId}/deactivate`, {});
    const published = await n8n("POST", `/api/v1/workflows/${workflowId}/publish`, {});
    writeJson(path.join(backup, "knowledge-fabric.live-after.json"), published);
    result.live_applied = true;
    result.live_active = Boolean(published.active);
    result.live_version_id = published.activeVersionId || published.versionId || null;
    result.backup = path.relative(root, backup).replaceAll("\\", "/");
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
