#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const apply = process.argv.includes("--apply");
const actorId = String(process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || "eKI3qM7nyCNn9r1q").trim();
const learningId = String(process.env.N8N_LEARNING_AGENT_WORKFLOW_ID || "zX0s3hOByJ4HWQye").trim();
const knowledgeToolName = "Knowledge Fabric Agent";
const marker = "Learning document normalization contract";

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function n8nJson(method, endpoint, body) {
  const baseUrl = requiredEnv("N8N_API_BASE_URL").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-N8N-API-KEY": requiredEnv("N8N_API_KEY"),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${endpoint} returned ${response.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}

function workflowPayload(workflow) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings || { executionOrder: "v1" },
    staticData: workflow.staticData ?? null,
  };
}

function patchKnowledgeWorkflow(workflow) {
  const agent = workflow.nodes.find((node) => node.name === "Knowledge Fabric AI Agent");
  const normalizer = workflow.nodes.find((node) => node.name === "Contract response normalizer");
  if (!agent || !normalizer) throw new Error(`${workflow.name}: Knowledge Fabric agent or normalizer missing`);

  agent.parameters ||= {};
  agent.parameters.options ||= {};
  const existingPrompt = String(agent.parameters.options.systemMessage || "");
  if (!existingPrompt.includes(marker)) {
    agent.parameters.options.systemMessage = `${existingPrompt}\n\n${marker}\nWhen the input contains learning_document and concept_deltas, synthesize exactly one reviewable knowledge concept. Return one valid JSON object shaped as {"concept": {...}, "evidence": [...], "change_reason": "..."}. Use the learning-document title and summary, preserve source trace references as evidence, and summarize concept deltas in what_else_to_know. Do not return a top-level concepts array. Never wrap JSON in markdown fences.`;
  }

  const code = String(normalizer.parameters?.jsCode || "");
  if (code.includes("function extractKeyedObject") && code.includes("const learningConcept")) {
    return workflow;
  }
  const start = code.indexOf("let parsed = {};");
  const end = code.indexOf("const fallbackTitle", start);
  if (start < 0 || end < 0) throw new Error(`${workflow.name}: normalizer parse block not found`);
  const replacement = `function parseJsonValue(value) {
  if (value && typeof value === 'object') return value;
  const text = String(value || '').trim().replace(/^\`\`\`(?:json)?/i, '').replace(/\`\`\`$/, '').trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch (error) { return {}; }
}
function extractKeyedObject(value, key) {
  const text = String(value || '');
  const keyIndex = text.indexOf('"' + key + '"');
  if (keyIndex < 0) return {};
  const objectStart = text.indexOf('{', keyIndex);
  if (objectStart < 0) return {};
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = objectStart; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) {
      try { return JSON.parse(text.slice(objectStart, index + 1)); } catch (error) { return {}; }
    }
  }
  return {};
}
const parsed = parseJsonValue(aiText);
const sourcePackage = parseJsonValue(sourceInput.query || input.query || '');
const parsedConcept = parsed.concept && typeof parsed.concept === 'object' ? parsed.concept : null;
const arrayConcept = Array.isArray(parsed.concepts) && parsed.concepts.length
  ? (parsed.concepts[0]?.concept || parsed.concepts[0])
  : null;
const extractedConcept = Object.keys(parsed).length ? null : extractKeyedObject(aiText, 'concept');
const learningDocument = parsed.learning_document || sourcePackage.learning_document || null;
const learningConcept = learningDocument ? {
  title: learningDocument.title,
  topic: learningDocument.title,
  purpose: learningDocument.lesson || learningDocument.summary,
  wider_context: learningDocument.why_it_happened || learningDocument.what_happened || '',
  how_to_apply: learningDocument.repeat_change_avoid || '',
  what_else_to_know: JSON.stringify(sourcePackage.concept_deltas || parsed.concept_deltas || []),
  implications_and_results: learningDocument.future_behavior_change || learningDocument.lesson || '',
  summary: learningDocument.summary || learningDocument.lesson || '',
  tags: ['learning_increment'],
  visibility_scope: 'private'
} : null;
const proposed = parsedConcept || arrayConcept || (Object.keys(extractedConcept).length ? extractedConcept : null) || learningConcept || parsed;
const sourceTraceRefs = learningDocument?.source_trace_refs || sourcePackage.trace?.source_trace_refs || [];
const parsedEvidence = Array.isArray(parsed.evidence) ? parsed.evidence : [];
const sourceEvidence = Array.isArray(sourceTraceRefs)
  ? sourceTraceRefs.map((reference) => ({ type: 'agent_trace', reference: String(reference) }))
  : [];
`;
  normalizer.parameters.jsCode = `${code.slice(0, start)}${replacement}${code.slice(end)}`
    .replace(
      "const evidence = Array.isArray(parsed.evidence) ? parsed.evidence : (Array.isArray(input.evidence) ? input.evidence : []);",
      "const evidence = parsedEvidence.length ? parsedEvidence : (sourceEvidence.length ? sourceEvidence : (Array.isArray(input.evidence) ? input.evidence : []));",
    );
  return workflow;
}

function patchLearningWorkflow(workflow) {
  const agent = workflow.nodes.find((node) => node.name === "Learning Agent");
  if (!agent) throw new Error(`${workflow.name}: Learning Agent node missing`);
  agent.parameters ||= {};
  agent.parameters.options ||= {};
  const learningMarker = "Trace-reference fidelity contract";
  const existing = String(agent.parameters.options.systemMessage || "");
  if (!existing.includes(learningMarker)) {
    agent.parameters.options.systemMessage = `${existing}\n\n${learningMarker}\nWhen trace_id or trace_chain_id is present in the input, copy it verbatim into learning_document.source_trace_refs and every concept_delta.evidence_refs. Never claim that no trace ID was supplied when either field is present.`;
  }
  agent.parameters.text = `=Normalized learning request (authorization credentials intentionally omitted):
{{ JSON.stringify({
  dispatch_type: $json.dispatch_type,
  source: $json.source,
  source_type: $json.source_type,
  source_agent_id: $json.source_agent_id,
  query: $json.query,
  source_interaction_summary: $json.source_interaction_summary,
  trace_id: $json.trace_id,
  trace_chain_id: $json.trace_chain_id,
  source_trace: $json.source_trace,
  trace_learning_recommended: $json.trace_learning_recommended,
  tenant_id: $json.tenant_id,
  user_id: $json.user_id,
  twin_id: $json.twin_id,
  organization_id: $json.organization_id,
  target_review_state: $json.target_review_state
}) }}`;
  return workflow;
}

async function publish(id, workflow) {
  if (!apply) return { workflow_id: id, applied: false };
  if (workflow.active) await n8nJson("POST", `/api/v1/workflows/${id}/deactivate`, {});
  await n8nJson("PUT", `/api/v1/workflows/${id}`, workflowPayload(workflow));
  const published = await n8nJson("POST", `/api/v1/workflows/${id}/publish`, {});
  return { workflow_id: id, applied: true, active: Boolean(published.active) };
}

function writeWorkflow(relativePath, workflow) {
  fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
  fs.writeFileSync(path.join(root, relativePath), `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
}

async function main() {
  const actor = await n8nJson("GET", `/api/v1/workflows/${actorId}`);
  const knowledgeTool = actor.nodes.find((node) => node.name === knowledgeToolName);
  const knowledgeId = String(knowledgeTool?.parameters?.workflowId?.value || "").trim();
  if (!knowledgeId) throw new Error("Actor Twin Knowledge Fabric workflow binding not found");
  const [knowledgeLive, learningLive] = await Promise.all([
    n8nJson("GET", `/api/v1/workflows/${knowledgeId}`),
    n8nJson("GET", `/api/v1/workflows/${learningId}`),
  ]);
  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  const backupDir = path.join(root, "exports", "n8n-live-backups", `${stamp}-knowledge-learning-contract`);
  fs.mkdirSync(backupDir, { recursive: true });
  writeWorkflow(path.relative(root, path.join(backupDir, "knowledge-fabric.workflow.json")), knowledgeLive);
  writeWorkflow(path.relative(root, path.join(backupDir, "learning-agent.workflow.json")), learningLive);

  const knowledge = patchKnowledgeWorkflow(knowledgeLive);
  const learning = patchLearningWorkflow(learningLive);
  const results = [];
  results.push(await publish(knowledgeId, knowledge));
  results.push(await publish(learningId, learning));
  results.push(await publish(actorId, actor));
  writeWorkflow("workflows/n8n/knowledge-fabric-agent.workflow.json", knowledge);
  writeWorkflow("workflows/n8n/import-ready/knowledge-fabric-agent.ai-agent.import.json", knowledge);
  writeWorkflow("workflows/n8n/learning-agent.workflow.json", learning);
  writeWorkflow("workflows/n8n/import-ready/learning-agent.ai-agent.import.json", learning);
  console.log(JSON.stringify({ status: apply ? "applied" : "prepared", knowledge_id: knowledgeId, learning_id: learningId, backup_dir: path.relative(root, backupDir), results }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
