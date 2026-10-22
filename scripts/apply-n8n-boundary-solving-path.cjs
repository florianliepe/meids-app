#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outRoot = path.join(root, "exports", "n8n-live-backups");

const defaults = {
  learningAgent: "zX0s3hOByJ4HWQye",
  knowledgeFabric: "oPs77Qzrg9Repzgp",
};

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function requireEnv(name) {
  const value = env(name);
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
}

function backendBaseUrl() {
  return env("MEIDS_BACKEND_URL")
    || env("AGENT_BACKEND_BASE_URL")
    || env("GH_PAGES_API_BASE_URL");
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function n8nJson(method, endpoint, body) {
  const baseUrl = requireEnv("N8N_API_BASE_URL").replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.N8N_API_TIMEOUT_MS || 30000));
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-N8N-API-KEY": requireEnv("N8N_API_KEY"),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal,
  });
  try {
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = text;
    }
    if (!response.ok) {
      const detail = typeof data === "string" ? data.slice(0, 800) : JSON.stringify(data).slice(0, 800);
      throw new Error(`${method} ${endpoint} returned ${response.status}: ${detail}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function findAgentNode(workflow, names) {
  return (workflow.nodes || []).find((node) => names.includes(node.name))
    || (workflow.nodes || []).find((node) => node.type === "@n8n/n8n-nodes-langchain.agent");
}

function appendOnce(text, addition, marker) {
  const current = String(text || "");
  if (current.includes(marker)) return { text: current, applied: false };
  return { text: `${current.trim()}\n\n${addition}`.trim(), applied: true };
}

function addConnection(workflow, source, target, type = "main") {
  workflow.connections = workflow.connections || {};
  workflow.connections[source] = workflow.connections[source] || {};
  workflow.connections[source][type] = workflow.connections[source][type] || [[]];
  const lane = workflow.connections[source][type][0] || [];
  if (!lane.some((item) => item.node === target && item.type === type && item.index === 0)) {
    lane.push({ node: target, type, index: 0 });
  }
  workflow.connections[source][type][0] = lane;
}

function removeConnectionTarget(workflow, source, target, type = "main") {
  const lanes = workflow.connections?.[source]?.[type];
  if (!Array.isArray(lanes)) return false;
  let changed = false;
  for (const lane of lanes) {
    if (!Array.isArray(lane)) continue;
    const next = lane.filter((item) => !(item.node === target && item.type === type));
    if (next.length !== lane.length) {
      lane.length = 0;
      lane.push(...next);
      changed = true;
    }
  }
  return changed;
}

function ensureNode(workflow, node) {
  const existing = (workflow.nodes || []).find((item) => item.name === node.name);
  if (existing) return { node: existing, applied: false };
  workflow.nodes = workflow.nodes || [];
  workflow.nodes.push(node);
  return { node, applied: true };
}

function upsertNodeDefinition(workflow, node) {
  const existing = (workflow.nodes || []).find((item) => item.name === node.name);
  if (!existing) {
    workflow.nodes = workflow.nodes || [];
    workflow.nodes.push(node);
    return { node, applied: true, updated: false };
  }
  existing.type = node.type;
  existing.typeVersion = node.typeVersion;
  existing.parameters = node.parameters;
  existing.position = node.position;
  existing.notes = node.notes;
  return { node: existing, applied: false, updated: true };
}

function ensureLearningDispatchWebhook(workflow, learningAgentName) {
  const name = "Receive post-turn learning dispatch";
  const result = ensureNode(workflow, {
      id: crypto.randomUUID(),
      name,
      type: "n8n-nodes-base.webhook",
      typeVersion: 2.1,
      position: [-40, 260],
      parameters: {
        httpMethod: "POST",
        path: "meids/learning/dispatch",
        responseMode: "onReceived",
        options: {
          responseCode: 202,
          responseData: "firstEntryJson",
        },
      },
      notes: "Post-turn entrypoint. Use for detached Learning Agent dispatch after Actor Twin has already answered.",
  });
  const node = result.node;
  addConnection(workflow, node.name, learningAgentName);
  return result.applied;
}

function ensureKnowledgeDuplicateScoring(workflow, agentName) {
  const backendUrl = backendBaseUrl().replace(/\/+$/, "");
  const scoreNode = upsertNodeDefinition(workflow, backendUrl ? {
    id: crypto.randomUUID(),
    name: "Score duplicate and merge evidence",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [240, 0],
    parameters: {
      method: "POST",
      url: `${backendUrl}/api/knowledge/duplicate-check`,
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "Content-Type", value: "application/json" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ (() => { const envelope = $json.body || $json; const context = envelope.context || {}; const input = envelope.input || envelope.candidate || envelope.concept || envelope; const candidate = { ...input, twin_id: input.twin_id || context.twin_id || envelope.twin_id || envelope.twin || '', organization_id: input.organization_id || context.organization_id || envelope.organization_id || 'default' }; return JSON.stringify({ candidate, twin_id: candidate.twin_id, organization_id: candidate.organization_id, source_policy: envelope.source_policy || context.source_policy || input.source_policy || 'selected_pending', top: envelope.top || context.top || input.top || 8 }); })() }}",
      options: {
        timeout: 12000,
      },
    },
    notes: "Runs before Knowledge Fabric AI Agent. Backend owns Azure/vector/graph scoring. URL is materialized at publish time because this n8n instance blocks $env access in node expressions.",
  } : {
    id: crypto.randomUUID(),
    name: "Score duplicate and merge evidence",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [240, 0],
    parameters: {
      jsCode: "const original = $json.body ?? $json;\nreturn [{ json: {\n  status: 'completed',\n  provider: 'fallback_no_backend_url',\n  duplicate_check: {\n    status: 'insufficient_evidence',\n    reason: 'Hosted backend URL was not configured when this workflow was published. Set MEIDS_BACKEND_URL locally and rerun npm run n8n:boundaries:apply to enable real score-backed duplicate checks.'\n  },\n  merge_candidates: [],\n  recommended_action: 'hold_evidence_pending',\n  original_request: original\n} }];",
    },
    notes: "Fallback scoring node. It keeps Knowledge Fabric usable but does not provide real duplicate/merge scores. Republish with MEIDS_BACKEND_URL to enable the HTTP backend scoring node.",
  });
  const attachNode = ensureNode(workflow, {
    id: crypto.randomUUID(),
    name: "Attach duplicate score evidence",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [480, 0],
    parameters: {
      jsCode: "function getTriggerInput() {\n  try { return $('Receive workflow call').first().json; } catch (error) {}\n  try { return $('Receive request').first().json; } catch (error) {}\n  return {};\n}\nconst original = getTriggerInput();\nconst input = original.body ?? original;\nreturn [{ json: {\n  ...input,\n  duplicate_score_evidence: $json,\n  duplicate_check_boundary: {\n    status: $json.duplicate_check?.status || 'insufficient_evidence',\n    source: 'backend_duplicate_check',\n    endpoint: '/api/knowledge/duplicate-check'\n  }\n} }];",
    },
    notes: "Restores the original Knowledge Fabric request and attaches duplicate_score_evidence before the AI Agent.",
  });
  const triggerNames = ["Receive request", "Receive workflow call"];
  let rerouted = false;
  for (const triggerName of triggerNames) {
    rerouted = removeConnectionTarget(workflow, triggerName, agentName) || rerouted;
    addConnection(workflow, triggerName, scoreNode.node.name);
  }
  removeConnectionTarget(workflow, scoreNode.node.name, agentName);
  addConnection(workflow, scoreNode.node.name, attachNode.node.name);
  removeConnectionTarget(workflow, attachNode.node.name, "Contract response normalizer");
  addConnection(workflow, attachNode.node.name, agentName);
  return {
    duplicate_scoring_node_applied: scoreNode.applied,
    duplicate_attach_node_applied: attachNode.applied,
    duplicate_scoring_rerouted: rerouted,
  };
}

function patchLearningWorkflow(workflow) {
  const agent = findAgentNode(workflow, ["Learning Agent"]);
  if (!agent) throw new Error(`No Learning Agent node found in ${workflow.name}`);
  agent.parameters = agent.parameters || {};
  agent.parameters.options = agent.parameters.options || {};
  const marker = "Boundary Solving Path: post-turn dispatch entrypoint";
  const patch = [
    marker,
    "This workflow may be invoked by a webhook dispatch after Actor Twin has already returned the user-facing answer. Treat dispatch_type=post_turn_learning as non-interactive background work. Keep output compact, stage only reusable learning through Knowledge Fabric, and do not ask the user follow-up questions from this background path.",
  ].join("\n");
  const systemPatch = appendOnce(agent.parameters.options.systemMessage || "", patch, marker);
  agent.parameters.options.systemMessage = systemPatch.text;
  const webhookApplied = ensureLearningDispatchWebhook(workflow, agent.name);
  return { system_patch_applied: systemPatch.applied, webhook_applied: webhookApplied };
}

function patchKnowledgeWorkflow(workflow) {
  const agent = findAgentNode(workflow, ["Knowledge Fabric AI Agent"]);
  if (!agent) throw new Error(`No Knowledge Fabric AI Agent node found in ${workflow.name}`);
  agent.parameters = agent.parameters || {};
  agent.parameters.options = agent.parameters.options || {};
  const marker = "Boundary Solving Path: duplicate score input contract";
  const patch = [
    marker,
    "Before concept creation, expect duplicate_score_evidence from the backend duplicate-check endpoint /api/knowledge/duplicate-check when available. Use vector_similarity, lexical_overlap, graph_proximity, scope_compatible, and merge_candidates from that evidence. If duplicate_score_evidence is missing, call the configured retrieval/graph scoring step first or return evidence_pending with duplicate_check.status=insufficient_evidence.",
    "",
    "Do not create a confident merge decision without scores. Strong duplicate, near-match, related-only, and insufficient-evidence classifications must be traceable to score evidence.",
  ].join("\n");
  const systemPatch = appendOnce(agent.parameters.options.systemMessage || "", patch, marker);
  agent.parameters.options.systemMessage = systemPatch.text;
  const scoring = ensureKnowledgeDuplicateScoring(workflow, agent.name);
  return { system_patch_applied: systemPatch.applied, ...scoring };
}

async function updateWorkflow(workflowId, label, patcher, outDir) {
  const workflow = await n8nJson("GET", `/api/v1/workflows/${workflowId}`);
  writeJson(path.join(outDir, `${label}.live-before.json`), workflow);
  const patchResult = patcher(workflow);
  const payload = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections || {},
    settings: workflow.settings || { executionOrder: "v1" },
    staticData: workflow.staticData ?? null,
  };
  writeJson(path.join(outDir, `${label}.update-payload.json`), payload);
  const updated = await n8nJson("PUT", `/api/v1/workflows/${workflow.id}`, payload);
  writeJson(path.join(outDir, `${label}.live-after.json`), updated);
  return {
    id: updated.id,
    name: updated.name,
    active: Boolean(updated.active),
    ...patchResult,
  };
}

async function main() {
  const outDir = path.join(outRoot, `${timestamp()}-boundary-solving-path`);
  const localOnly = process.argv.includes("--local-only");
  const localLearning = path.join(root, "workflows", "n8n", "learning-agent.workflow.json");
  if (fs.existsSync(localLearning)) {
    const local = JSON.parse(fs.readFileSync(localLearning, "utf8"));
    patchLearningWorkflow(local);
    writeJson(localLearning, local);
  }
  const localKnowledge = path.join(root, "workflows", "n8n", "knowledge-fabric-agent.workflow.json");
  if (fs.existsSync(localKnowledge)) {
    const local = JSON.parse(fs.readFileSync(localKnowledge, "utf8"));
    patchKnowledgeWorkflow(local);
    writeJson(localKnowledge, local);
  }
  if (localOnly) {
    console.log(JSON.stringify({
      status: "local_applied",
      learning_workflow: path.relative(root, localLearning).replaceAll("\\", "/"),
      knowledge_workflow: path.relative(root, localKnowledge).replaceAll("\\", "/"),
      publish_time_backend_url: backendBaseUrl() || "",
      duplicate_scoring_mode: backendBaseUrl() ? "backend_http" : "fallback_insufficient_evidence",
    }, null, 2));
    return;
  }
  const learning = await updateWorkflow(
    env("N8N_LEARNING_AGENT_WORKFLOW_ID", defaults.learningAgent),
    "learning-agent",
    patchLearningWorkflow,
    outDir,
  );
  const knowledge = await updateWorkflow(
    env("N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID", defaults.knowledgeFabric),
    "knowledge-fabric",
    patchKnowledgeWorkflow,
    outDir,
  );
  const summary = {
    status: "applied",
    backup: path.relative(root, outDir).replaceAll("\\", "/"),
    learning_dispatch: {
      workflow: learning,
      webhook_path: "meids/learning/dispatch",
      backend_endpoint: "/api/learning/post-turn",
    },
    knowledge_duplicate_scores: {
      workflow: knowledge,
      backend_endpoint: "/api/knowledge/duplicate-check",
      publish_time_backend_url: backendBaseUrl() || "",
      backend_url_env: "MEIDS_BACKEND_URL, AGENT_BACKEND_BASE_URL, or GH_PAGES_API_BASE_URL",
      runtime_wiring: "Receive request/workflow call -> Score duplicate and merge evidence -> Attach duplicate score evidence -> Knowledge Fabric AI Agent.",
    },
  };
  writeJson(path.join(outDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
