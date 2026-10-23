const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const baseUrl = String(process.env.N8N_API_BASE_URL || "").replace(/\/+$/, "");
const apiKey = String(process.env.N8N_API_KEY || "");
const workflowId = String(process.env.N8N_ACTOR_TWIN_WORKFLOW_ID || "eKI3qM7nyCNn9r1q");
const backendUrl = String(process.env.MEIDS_BACKEND_URL || "https://meids-prod-backend-1853a19b.azurewebsites.net").replace(/\/+$/, "");
const apply = process.argv.includes("--apply");

if (!baseUrl || !apiKey) throw new Error("N8N_API_BASE_URL and N8N_API_KEY are required.");

const systemMessage = `You are the Me.IDs Actor Twin, the only user-facing conversational routing authority.

Evidence-first rule
- Direct answers are allowed only for greetings, navigation help, capability explanations, and clearly generic knowledge.
- Before making any claim about the active twin or its person, identity, biography, role, expertise, experience, preferences, decisions, processes, relationships, organization, or prior work, call Knowledge Fabric Agent with operation=retrieve.
- Use reviewed/approved knowledge as evidence. Candidate, review_needed, updated_review_needed, stale, or contradictory material may be mentioned only as unverified context and never as established fact.
- Never fill evidence gaps with plausible biography or model knowledge. If reviewed evidence is absent, say so plainly, identify what is missing, and ask one targeted follow-up or suggest Source Upload/Voice Capture.
- Separate supported facts from inferences. Do not claim a source was used unless the tool returned it.

Grounding response contract
- Classify the answer internally as grounded, partial, or not_found.
- grounded: answer from reviewed evidence and name the supporting concept/source titles or IDs.
- partial: answer only the supported portion, label the inference/unknowns, and ask one precise follow-up.
- not_found: do not speculate; state that reviewed knowledge is unavailable and offer the shortest next capture step.

Tool: Knowledge Fabric Agent
Call for read-only OKF/vector/graph/evidence retrieval and explicit knowledge staging. Set operation=retrieve for lookup, inspection, self-description, personal or organizational claims, and every evidence-first check. Set operation=stage only for explicit remember/save/ingest/create/update/attach requests. New or changed knowledge stays review_needed or updated_review_needed.

Tool: Agentic Butler
Call for drafting, planning, synthesis, approved skill execution, work artifacts, new capability proposals, and all tacit-knowledge elicitation. The Butler owns the Knowledge Retrieval Interviewer for circular questions, decision criteria, best practices, lessons learned, process insight, and stakeholder dynamics.

Tool: Critical Faculty Agent
Call for ambiguity, contradictory or weak evidence, high-impact recommendations, hidden assumptions, approval-boundary uncertainty, or generated capability proposals. It critiques but cannot approve or execute.

Learning Agent is post-turn by default. Do not call it inline for routine answers. The deterministic post-answer trace branch will queue reusable learning after the user receives the answer.

Execution rules
- Call the minimum required workflow tools immediately; do not merely announce delegation.
- Normal read-only work and approved skill execution need no approval. Approval is required before activating a generated capability or performing a real external side effect.
- If a nested tool times out or returns an incomplete contract, give a bounded failure summary and a recovery step.
- Return a concise user-facing answer. Do not expose raw JSON or credentials.`;

async function n8n(method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      "X-N8N-API-KEY": apiKey,
      accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${method} ${route} failed ${response.status}: ${raw}`);
  return raw ? JSON.parse(raw) : {};
}

function apiPayload(workflow) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings || { executionOrder: "v1" },
    staticData: workflow.staticData ?? null,
  };
}

function patchWorkflow(workflow) {
  const agent = workflow.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.agent");
  const trigger = workflow.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.chatTrigger");
  const knowledge = workflow.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.toolWorkflow" && /Knowledge Fabric/i.test(node.name));
  if (!agent || !trigger || !knowledge) throw new Error("Actor workflow is missing its agent, Chat Trigger, or Knowledge Fabric tool.");

  agent.parameters ||= {};
  agent.parameters.options ||= {};
  agent.parameters.options.systemMessage = systemMessage;
  knowledge.parameters ||= {};
  knowledge.parameters.description = "Evidence-first retrieval and governed knowledge staging. Call with operation=retrieve before any claim about the active twin/person, biography, role, expertise, experience, preferences, decisions, processes, relationships, organization, or prior work. Retrieval must use reviewed/approved evidence and return grounding status plus source IDs/titles. Call with operation=stage only for explicit remember/save/ingest/create/update/attach intent; writes remain review_needed or updated_review_needed. Never substitute model speculation for missing evidence.";

  const traceNodeName = "Persist post-answer trace";
  const responseNodeName = "Preserve Actor answer";
  workflow.nodes = workflow.nodes.filter((node) => ![traceNodeName, responseNodeName].includes(node.name));
  workflow.nodes.push({
    id: "meids-actor-post-answer-trace",
    name: traceNodeName,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [agent.position[0] + 280, agent.position[1]],
    onError: "continueRegularOutput",
    parameters: {
      method: "POST",
      url: `${backendUrl}/api/agents/post-answer`,
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ knowledge_access_token: $('When chat message received').first().json.metadata?.authorization?.knowledgeAccessToken || '', trace: { trace_id: 'n8n_exec_' + $execution.id, trace_chain_id: 'n8n_exec_' + $execution.id, request_id: ($('When chat message received').first().json.sessionId || 'chat') + ':' + $execution.id, twin_id: $('When chat message received').first().json.metadata?.identity?.activeTwinId || '', input_summary: $('When chat message received').first().json.chatInput || '', output_summary: $('Actor Twin AI Agent1').first().json.output || $('Actor Twin AI Agent1').first().json.text || '', route_decision: 'answer_completed', grounding: { policy: 'reviewed_evidence_first' }, trace_learning_recommended: true } }) }}",
      options: { timeout: 5000 },
    },
  });
  workflow.nodes.push({
    id: "meids-actor-preserve-answer",
    name: responseNodeName,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [agent.position[0] + 560, agent.position[1]],
    parameters: {
      jsCode: "const answer = $('Actor Twin AI Agent1').first().json; const trace = $json || {}; return [{ json: { ...answer, trace_persistence: { status: trace.status || (trace.error ? 'degraded' : 'stored'), trace_id: trace.trace_id || '', post_turn_learning: trace.post_turn_learning || 'unknown' } } }];",
    },
  });
  workflow.connections[agent.name] = { main: [[{ node: traceNodeName, type: "main", index: 0 }]] };
  workflow.connections[traceNodeName] = { main: [[{ node: responseNodeName, type: "main", index: 0 }]] };
  delete workflow.connections[responseNodeName];
  return workflow;
}

(async () => {
  const live = await n8n("GET", `/api/v1/workflows/${workflowId}`);
  const patched = patchWorkflow(structuredClone(live));
  const backup = path.join(os.tmpdir(), `meids-actor-before-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(live, null, 2));
  const summary = {
    status: apply ? "ready_to_apply" : "prepared",
    workflow_id: workflowId,
    backup,
    evidence_first: true,
    post_answer_trace: true,
    nodes: patched.nodes.map((node) => node.name),
  };
  if (apply) {
    const updated = await n8n("PUT", `/api/v1/workflows/${workflowId}`, apiPayload(patched));
    const published = await n8n("POST", `/api/v1/workflows/${workflowId}/publish`, {});
    summary.status = "applied_and_published";
    summary.version_id = updated.versionId;
    summary.active_version_id = published.activeVersionId || published.versionId;
    const canonical = { ...apiPayload(patched), id: workflowId, active: true };
    fs.writeFileSync(path.join(__dirname, "..", "workflows", "n8n", "actor-twin.workflow.json"), JSON.stringify(canonical, null, 2));
  }
  console.log(JSON.stringify(summary, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
