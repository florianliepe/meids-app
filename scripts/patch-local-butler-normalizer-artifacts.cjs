#!/usr/bin/env node
const fs = require("node:fs");

const files = [
  "workflows/n8n/agentic-butler.workflow.json",
  "workflows/n8n/implementations/agentic-butler.ai-agent.workflow.json",
  "workflows/n8n/import-ready/agentic-butler.ai-agent.import.json",
];

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

for (const file of files) {
  const workflow = JSON.parse(fs.readFileSync(file, "utf8"));
  const node = workflow.nodes.find((item) => item.name === "Contract response normalizer");
  if (!node) continue;
  const before = node.parameters.jsCode;
  node.parameters.jsCode = patchCode(before);
  if (node.parameters.jsCode !== before) {
    fs.writeFileSync(file, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
    console.log(`patched ${file}`);
  } else {
    console.log(`unchanged ${file}`);
  }
}
