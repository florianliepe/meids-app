#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outRoot = path.join(root, "exports", "n8n-live-backups");

const workflows = [
  {
    id: process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || "eKI3qM7nyCNn9r1q",
    label: "actor-twin",
    agentNames: ["Actor Twin AI Agent1", "Actor Twin AI Agent"],
    marker: "Next Refinement Guardrail: Actor Twin post-turn learning",
    patch: [
      "Next Refinement Guardrail: Actor Twin post-turn learning",
      "For routine trace learning, do not call Learning Agent inline when the user-facing answer can be completed without it. Return the answer first and include trace_learning_recommended with source trace refs so a detached/post-turn workflow can run Learning Agent later. Call Learning Agent inline only when the user explicitly asks for learning synthesis now or the learning result is required to answer.",
      "",
      "Nested workflow timeout rule: when a workflow tool call is slow, unavailable, or returns an incomplete payload, return a concise fallback summary with status, likely missing dependency, and next recovery step. Do not leave the chat without a final answer or bounded failure summary.",
    ].join("\n"),
    toolPatches: [
      {
        names: ["Learning Agent"],
        marker: "Post-turn preferred",
        description: [
          "Call this internal workflow tool only when learning synthesis is explicitly needed inline or required to complete the current answer. Post-turn preferred: for routine trace learning, emit trace_learning_recommended and let a detached workflow run Learning Agent after Actor Twin has answered.",
          "",
          "The Learning Agent creates reviewable learning documents, concept deltas, decision-pattern summaries, failure-mode notes, and future-behavior-change candidates. Outputs must be staged through Knowledge Fabric as review_needed or updated_review_needed, not treated as approved truth.",
          "",
          "Do not call it for real-time answering, fresh tacit-knowledge interviews, direct OKF/vector/graph retrieval, skill execution, approvals, or external side effects.",
        ].join("\n"),
      },
    ],
  },
  {
    id: process.env.N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID || "oPs77Qzrg9Repzgp",
    label: "knowledge-fabric",
    agentNames: ["Knowledge Fabric AI Agent"],
    marker: "Next Refinement Guardrail: score-backed duplicate merge",
    patch: [
      "Next Refinement Guardrail: score-backed duplicate merge",
      "Before creating a new OKF concept, perform duplicate/merge detection using actual available retrieval evidence: vector similarity, graph proximity/neighborhood, alias/title overlap, source-evidence overlap, and scope/purpose overlap. If vector/graph retrieval is unavailable, mark duplicate_check.status as insufficient_evidence and hold the candidate as evidence_pending instead of claiming no duplicate.",
      "",
      "Classification: strong_duplicate means vector >= 0.88 or exact alias/title match plus compatible scope; near_match means vector 0.72-0.87 or shared graph neighborhood with overlapping purpose; related_only means vector 0.55-0.71 or graph proximity without scope overlap; insufficient_evidence means no real retrieval evidence. Never auto-merge trusted knowledge; stage merge deltas as updated_review_needed.",
      "",
      "Nested workflow timeout rule: when vector, graph, Critical Faculty, or Learning Agent calls fail or time out, return a bounded fallback with evidence status and recovery action.",
    ].join("\n"),
  },
  {
    id: process.env.N8N_AGENTIC_BUTLER_WORKFLOW_ID || "KZOqZRUAnVfFEAYJ",
    label: "agentic-butler",
    agentNames: ["Agentic Butler AI Agent"],
    marker: "Next Refinement Guardrail: Butler nested fallback",
    patch: [
      "Next Refinement Guardrail: Butler nested fallback",
      "For normal skill execution and no-write work artifacts, avoid approval gates. If Skill Orchestrator, Task Agent, Knowledge Retrieval Interviewer, or Critical Faculty is slow or unavailable, return a concise fallback summary: what was completed, what was not completed, why, and the next recovery step. Do not leave Actor Twin waiting without a usable result.",
      "",
      "Use Skill Orchestrator only for multi-step execution. Use one Task Agent by default and stop after the configured budget.",
    ].join("\n"),
    toolPatches: [
      {
        names: ["Skill Orchestrator"],
        marker: "Timeout/fallback requirement",
        description: [
          "Call this tool for approved multi-step skill execution or bounded work artifacts that require task decomposition. Timeout/fallback requirement: if it cannot complete promptly, return partial result, failed step, missing dependency, and next recovery action. Do not request approval for no-write drafts.",
        ].join("\n"),
      },
    ],
  },
  {
    id: process.env.N8N_SKILL_ORCHESTRATOR_WORKFLOW_ID || "8ER9laJuKS6UrQJF",
    label: "skill-orchestrator",
    agentNames: ["Skill Orchestrator"],
    marker: "Next Refinement Guardrail: Skill Orchestrator timeout",
    patch: [
      "Next Refinement Guardrail: Skill Orchestrator timeout",
      "Keep the execution plan shallow. Default to one Task Agent call. If Task Agent fails, times out, or returns an incomplete result, synthesize a bounded fallback with completed steps, missing output, risk, and recovery action. Do not recursively call more agents to hide the failure.",
    ].join("\n"),
    toolPatches: [
      {
        names: ["Task Agent"],
        marker: "Bounded worker fallback",
        description: "Call this tool for exactly one bounded execution step. Bounded worker fallback: if the task cannot be completed, return the missing input, failed check, partial result if useful, and next step. Do not expand scope or perform external side effects.",
      },
    ],
  },
  {
    id: process.env.N8N_TASK_AGENT_WORKFLOW_ID || "YXcl8Wb68Oup3Z8n",
    label: "task-agent",
    agentNames: ["Task Agent", "AI Agent"],
    marker: "Next Refinement Guardrail: Task Agent bounded failure",
    patch: [
      "Next Refinement Guardrail: Task Agent bounded failure",
      "If the task cannot be completed within the provided context and budget, return status needs_clarification or failed with partial_result, missing_inputs, quality_checks, and next_step. Do not broaden the task, call unrelated tools, or create external side effects.",
    ].join("\n"),
  },
  {
    id: process.env.N8N_LEARNING_AGENT_WORKFLOW_ID || "zX0s3hOByJ4HWQye",
    label: "learning-agent",
    agentNames: ["Learning Agent"],
    marker: "Next Refinement Guardrail: Learning post-turn execution",
    patch: [
      "Next Refinement Guardrail: Learning post-turn execution",
      "Default assumption: this workflow is called after Actor Twin has already answered the user. Keep output compact and stage only reusable lessons. If called inline, produce only a compact handoff summary and avoid deep chained synthesis.",
    ].join("\n"),
  },
];

function env(name) {
  return String(process.env[name] || "").trim();
}

function requireEnv(name) {
  const value = env(name);
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
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
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-N8N-API-KEY": requireEnv("N8N_API_KEY"),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
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

function patchToolDescription(workflow, patch) {
  let applied = false;
  for (const node of workflow.nodes || []) {
    if (!patch.names.includes(node.name)) continue;
    node.parameters = node.parameters || {};
    const current = String(node.parameters.description || "");
    if (current.includes(patch.marker)) continue;
    node.parameters.description = patch.description;
    applied = true;
  }
  return applied;
}

async function main() {
  const outDir = path.join(outRoot, `${timestamp()}-next-refinement-guardrails`);
  const results = [];
  for (const item of workflows) {
    const workflow = await n8nJson("GET", `/api/v1/workflows/${item.id}`);
    writeJson(path.join(outDir, `${item.label}.live-before.json`), workflow);
    const agent = findAgentNode(workflow, item.agentNames);
    if (!agent) throw new Error(`No AI Agent found in ${workflow.name}`);
    agent.parameters = agent.parameters || {};
    agent.parameters.options = agent.parameters.options || {};
    const systemPatch = appendOnce(agent.parameters.options.systemMessage || "", item.patch, item.marker);
    agent.parameters.options.systemMessage = systemPatch.text;
    const toolPatches = (item.toolPatches || []).map((toolPatch) => ({
      names: toolPatch.names,
      applied: patchToolDescription(workflow, toolPatch),
    }));
    const payload = {
      name: workflow.name,
      nodes: workflow.nodes,
      connections: workflow.connections || {},
      settings: workflow.settings || { executionOrder: "v1" },
      staticData: workflow.staticData ?? null,
    };
    writeJson(path.join(outDir, `${item.label}.update-payload.json`), payload);
    const updated = await n8nJson("PUT", `/api/v1/workflows/${workflow.id}`, payload);
    writeJson(path.join(outDir, `${item.label}.live-after.json`), updated);
    results.push({
      id: updated.id,
      name: updated.name,
      active: Boolean(updated.active),
      system_patch_applied: systemPatch.applied,
      tool_patches: toolPatches,
    });
  }
  const summary = {
    status: "applied",
    backup: path.relative(root, outDir).replaceAll("\\", "/"),
    workflows: results,
    notes: [
      "True detached Learning Agent execution still requires an n8n branch or separate post-turn trigger. This script applies the routing guardrail and tool descriptions.",
      "Score-backed duplicate/merge detection is enforced at instruction level; real vector/graph nodes must provide the scores in the workflow input.",
    ],
  };
  writeJson(path.join(outDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
