#!/usr/bin/env node

function env(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
}

const baseUrl = env("N8N_API_BASE_URL").replace(/\/+$/, "");
const apiKey = env("N8N_API_KEY");
const workflowId = env("N8N_AGENTIC_BUTLER_WORKFLOW_ID");

async function n8nJson(method, endpoint, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-N8N-API-KEY": apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${endpoint} returned ${response.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}

function patchCode(code) {
  let next = code;
  if (!next.includes("result.result?.next_question")) {
    next = next.replace(
      "const result = { ...output };",
      [
        "const result = { ...output };",
        "  if (!result.next_question && result.result?.next_question) result.next_question = result.result.next_question;",
        "  if (!result.question_type && result.result?.question_type) result.question_type = result.result.question_type;",
        "  if (!result.gap_being_closed && result.result?.gap_being_closed) result.gap_being_closed = result.result.gap_being_closed;",
      ].join("\n"),
    );
  }
  next = next.replace(
    "if (!result.summary) result.summary = text || 'Agentic Butler completed autonomous skill orchestration under Actor Twin steering.';",
    [
      "if (!result.next_question && result.result?.next_question) result.next_question = result.result.next_question;",
      "  if (!result.question_type && result.result?.question_type) result.question_type = result.result.question_type;",
      "  if (!result.gap_being_closed && result.result?.gap_being_closed) result.gap_being_closed = result.result.gap_being_closed;",
      "if (!result.summary && result.next_question) result.summary = result.next_question;",
      "  if (!result.summary && result.skill_invoked) result.summary = String(result.skill_invoked) + ' completed.';",
      "  if (!result.summary) result.summary = text || 'Agentic Butler completed autonomous skill orchestration under Actor Twin steering.';",
      "  if (result.summary === text && (result.next_question || result.skill_invoked || result.okf_candidate || result.result?.next_question)) {",
      "    result.summary = result.next_question || (String(result.skill_invoked) + ' completed.');",
      "  }",
    ].join("\n"),
  );
  if (!next.includes("Skill orchestration completed.")) {
    next = next.replace(
      "if (result.summary === text && (result.next_question || result.skill_invoked || result.okf_candidate || result.result?.next_question)) {",
      [
        "if (typeof result.summary === 'string' && /^```|^\\s*\\{/.test(result.summary) && (result.artifact || result.task_trace || result.execution_plan)) {",
        "    result.summary = result.artifact?.title || result.result?.title || 'Skill orchestration completed.';",
        "  }",
        "  if (result.summary === text && (result.next_question || result.skill_invoked || result.okf_candidate || result.result?.next_question)) {",
      ].join("\n"),
    );
  }
  next = next.replace(
    "used_agents: ['agentic_butler_ai_agent', 'skill_orchestrator_internal_component', 'actor_twin_checkpoint_boundary']",
    "used_agents: Array.from(new Set(['agentic_butler_ai_agent', 'skill_orchestrator_internal_component', 'actor_twin_checkpoint_boundary'].concat(parsed?.trace?.used_agents || aiOutput.trace?.used_agents || [])))",
  );
  next = next.replace(
    "used_agents: Array.from(new Set(['agentic_butler_ai_agent', 'skill_orchestrator_internal_component', 'actor_twin_checkpoint_boundary'].concat(parsed?.trace?.used_agents || aiOutput.trace?.used_agents || [])))",
    "used_agents: Array.from(new Set(['agentic_butler_ai_agent', 'skill_orchestrator_internal_component', 'actor_twin_checkpoint_boundary'].concat(parsed?.trace?.used_agents || aiOutput.trace?.used_agents || []).concat((aiOutput.next_question || aiOutput.result?.mode === 'tacit_knowledge_elicitation' || aiOutput.skill_invoked === 'Knowledge Retrieval Interviewer') ? ['knowledge_retrieval_interviewer'] : [])))",
  );
  next = next.replace(
    "used_agents: Array.from(new Set(['agentic_butler_ai_agent', 'skill_orchestrator_internal_component', 'actor_twin_checkpoint_boundary'].concat(parsed?.trace?.used_agents || aiOutput.trace?.used_agents || []).concat((aiOutput.next_question || aiOutput.result?.mode === 'tacit_knowledge_elicitation' || aiOutput.skill_invoked === 'Knowledge Retrieval Interviewer') ? ['knowledge_retrieval_interviewer'] : [])))",
    "used_agents: Array.from(new Set(['agentic_butler_ai_agent', 'skill_orchestrator_internal_component', 'actor_twin_checkpoint_boundary'].concat(parsed?.trace?.used_agents || aiOutput.trace?.used_agents || []).concat((aiOutput.next_question || aiOutput.result?.mode === 'tacit_knowledge_elicitation' || aiOutput.skill_invoked === 'Knowledge Retrieval Interviewer') ? ['knowledge_retrieval_interviewer'] : []).concat((aiOutput.task_trace || aiOutput.execution_plan || aiOutput.artifact) ? ['skill_orchestrator', 'task_agent'] : [])))",
  );
  next = next.replace(
    "if (result.summary === text && (result.next_question || result.skill_invoked || result.okf_candidate)) {",
    "if (result.summary === text && (result.next_question || result.skill_invoked || result.okf_candidate || result.result?.next_question)) {",
  );
  return next;
}

async function main() {
  const workflow = await n8nJson("GET", `/api/v1/workflows/${workflowId}`);
  const node = workflow.nodes.find((item) => item.name === "Contract response normalizer");
  if (!node) throw new Error("Contract response normalizer node not found");
  const before = node.parameters.jsCode;
  node.parameters.jsCode = patchCode(before);
  if (node.parameters.jsCode === before) {
    console.log(JSON.stringify({ status: "unchanged", workflow_id: workflow.id }, null, 2));
    return;
  }
  const payload = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings || { executionOrder: "v1" },
    staticData: workflow.staticData ?? null,
  };
  const updated = await n8nJson("PUT", `/api/v1/workflows/${workflowId}`, payload);
  console.log(JSON.stringify({ status: "patched_normalizer", workflow_id: updated.id }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
