const workflowId = process.env.N8N_AGENTIC_BUTLER_WORKFLOW_ID || "elbiGicaFmQQW4w8";
const baseUrl = String(process.env.N8N_API_BASE_URL || "").replace(/\/+$/, "");
const apiKey = process.env.N8N_API_KEY;
const apply = process.argv.includes("--apply");

if (!baseUrl || !apiKey) throw new Error("N8N_API_BASE_URL and N8N_API_KEY are required.");

async function n8n(method, path, body) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : {};
}

function patchWorkflow(workflow) {
  const node = workflow.nodes.find((item) => item.name === "Contract response normalizer");
  if (!node) throw new Error("Contract response normalizer node not found.");
  const replacementNodeId = "5c34292a-933f-4ca8-9e74-1afcc0ea836f";
  const triggerLookupLegacy = "function getTriggerInput() {\n  try { return $('Receive workflow call').first().json; } catch (error) {}\n  try { return $('Receive request').first().json; } catch (error) {}\n  return $json;\n}";
  const triggerLookupRobust = "function getTriggerInput() {\n  try { const items = $items('Receive workflow call', 0, 0); if (items?.[0]?.json) return items[0].json; } catch (error) {}\n  try { return $('Receive workflow call').first().json; } catch (error) {}\n  try { const items = $items('Receive request', 0, 0); if (items?.[0]?.json) return items[0].json; } catch (error) {}\n  try { return $('Receive request').first().json; } catch (error) {}\n  return $json;\n}";
  let changed = false;
  if (!node.parameters.jsCode.includes(triggerLookupRobust)) {
    if (!node.parameters.jsCode.includes(triggerLookupLegacy)) throw new Error("Expected Butler trigger lookup was not found; refusing an ambiguous patch.");
    node.parameters.jsCode = node.parameters.jsCode.replace(triggerLookupLegacy, triggerLookupRobust);
    changed = true;
  }
  const legacy = "const explicitCreation = explicitSkillCreationIntent(query);\nconst isCreateSkill = explicitCreation || (input.intent === 'create_skill' && routeDecision.decision === 'create_skill');";
  const structuredOnly = "const approvedSkillExecution = input.intent === 'execute_approved_skill' || Boolean(input.input?.skill_id && input.input?.skill_spec);\nconst explicitCreation = !approvedSkillExecution && explicitSkillCreationIntent(query);\nconst isCreateSkill = !approvedSkillExecution && (explicitCreation || (input.intent === 'create_skill' && routeDecision.decision === 'create_skill'));";
  const regexOnly = "const approvedSkillExecution = input.intent === 'execute_approved_skill'\n  || Boolean(input.input?.skill_id && input.input?.skill_spec)\n  || /\\b(execute|apply|run|invoke)\\b[\\s\\S]{0,48}\\bapproved\\s+skill\\b/i.test(query);\nconst explicitCreation = !approvedSkillExecution && explicitSkillCreationIntent(query);\nconst isCreateSkill = !approvedSkillExecution && (explicitCreation || (input.intent === 'create_skill' && routeDecision.decision === 'create_skill'));";
  const markerOnly = "const approvedSkillExecution = input.intent === 'execute_approved_skill'\n  || Boolean(input.input?.skill_id && input.input?.skill_spec)\n  || query.includes('execute approved skill')\n  || query.includes('approved-skill execution')\n  || /\\b(apply|run|invoke)\\b[\\s\\S]{0,48}\\bapproved\\s+skill\\b/i.test(query);\nconst explicitCreation = !approvedSkillExecution && explicitSkillCreationIntent(query);\nconst isCreateSkill = !approvedSkillExecution && (explicitCreation || (input.intent === 'create_skill' && routeDecision.decision === 'create_skill'));";
  const resultOnly = "const completedSkillRun = parsed?.status === 'completed'\n  && Boolean(parsed.skill || parsed.skill_run || parsed.task_agent || parsed.execution_plan || parsed.task_agent_calls)\n  && !parsed.approval_request;\nconst approvedSkillExecution = input.intent === 'execute_approved_skill'\n  || Boolean(input.input?.skill_id && input.input?.skill_spec)\n  || query.includes('execute approved skill')\n  || query.includes('approved-skill execution')\n  || /\\b(apply|run|invoke)\\b[\\s\\S]{0,48}\\bapproved\\s+skill\\b/i.test(query)\n  || completedSkillRun;\nconst explicitCreation = !approvedSkillExecution && explicitSkillCreationIntent(query);\nconst isCreateSkill = !approvedSkillExecution && (explicitCreation || (input.intent === 'create_skill' && routeDecision.decision === 'create_skill'));";
  const parsedResult = "const completedSkillRun = parsed?.status === 'completed'\n  && Boolean(parsed.skill || parsed.skill_executed || parsed.skill_marker || parsed.skill_run || parsed.task_agent || parsed.execution_plan || parsed.task_agent_calls || String(parsed.execution_mode || '').includes('approved-skill execution'))\n  && !parsed.approval_request\n  && !parsed.approval_required;\nconst approvedSkillExecution = input.intent === 'execute_approved_skill'\n  || Boolean(input.input?.skill_id && input.input?.skill_spec)\n  || query.includes('execute approved skill')\n  || query.includes('approved-skill execution')\n  || /\\b(apply|run|invoke)\\b[\\s\\S]{0,48}\\bapproved\\s+skill\\b/i.test(query)\n  || completedSkillRun;\nconst explicitCreation = !approvedSkillExecution && explicitSkillCreationIntent(query);\nconst isCreateSkill = !approvedSkillExecution && (explicitCreation || (input.intent === 'create_skill' && routeDecision.decision === 'create_skill'));";
  const robustLegacy = "const completedSkillRun = aiOutput?.status === 'completed'\n  && Boolean(aiOutput.skill || aiOutput.skill_executed || aiOutput.skill_marker || aiOutput.skill_run || aiOutput.task_agent || aiOutput.execution_plan || aiOutput.task_agent_calls || String(aiOutput.execution_mode || '').includes('approved-skill execution'))\n  && !aiOutput.approval_request\n  && !aiOutput.approval_required;\nconst approvedSkillExecution = input.intent === 'execute_approved_skill'\n  || Boolean(input.input?.skill_id && input.input?.skill_spec)\n  || query.includes('execute approved skill')\n  || query.includes('approved-skill execution')\n  || /\\b(apply|run|invoke)\\b[\\s\\S]{0,48}\\bapproved\\s+skill\\b/i.test(query)\n  || completedSkillRun;\nconst explicitCreation = !approvedSkillExecution && explicitSkillCreationIntent(query);\nconst isCreateSkill = !approvedSkillExecution && (explicitCreation || (input.intent === 'create_skill' && routeDecision.decision === 'create_skill'));";
  const robust = "const completedSkillRun = /^completed(?:_|$)/.test(String(aiOutput?.status || ''))\n  && Boolean(aiOutput.skill || aiOutput.skill_executed || aiOutput.skill_marker || aiOutput.skill_run || aiOutput.task_agent || aiOutput.execution_plan || aiOutput.task_agent_calls || String(aiOutput.execution_mode || '').includes('approved-skill execution'))\n  && !aiOutput.approval_request\n  && !aiOutput.approval_required;\nconst approvedSkillExecution = input.intent === 'execute_approved_skill'\n  || Boolean(input.input?.skill_id && input.input?.skill_spec)\n  || query.includes('execute approved skill')\n  || query.includes('approved-skill execution')\n  || /\\b(apply|run|invoke)\\b[\\s\\S]{0,48}\\bapproved\\s+skill\\b/i.test(query)\n  || completedSkillRun;\nconst explicitCreation = !approvedSkillExecution && explicitSkillCreationIntent(query);\nconst isCreateSkill = !approvedSkillExecution && (explicitCreation || (input.intent === 'create_skill' && routeDecision.decision === 'create_skill'));";
  if (!node.parameters.jsCode.includes(robust)) {
    if (node.parameters.jsCode.includes(robustLegacy)) {
      node.parameters.jsCode = node.parameters.jsCode.replace(robustLegacy, robust);
    } else if (node.parameters.jsCode.includes(parsedResult)) {
      node.parameters.jsCode = node.parameters.jsCode.replace(parsedResult, robust);
    } else if (node.parameters.jsCode.includes(resultOnly)) {
      node.parameters.jsCode = node.parameters.jsCode.replace(resultOnly, robust);
    } else if (node.parameters.jsCode.includes(markerOnly)) {
      node.parameters.jsCode = node.parameters.jsCode.replace(markerOnly, robust);
    } else if (node.parameters.jsCode.includes(regexOnly)) {
      node.parameters.jsCode = node.parameters.jsCode.replace(regexOnly, robust);
    } else if (node.parameters.jsCode.includes(structuredOnly)) {
      node.parameters.jsCode = node.parameters.jsCode.replace(structuredOnly, robust);
    } else if (node.parameters.jsCode.includes(legacy)) {
      node.parameters.jsCode = node.parameters.jsCode.replace(legacy, robust);
    } else {
      throw new Error("Expected Butler classifier source was not found; refusing an ambiguous patch.");
    }
    changed = true;
  }
  const traceNeedle = "trace: { stored: true, trace_id: 'n8n_exec_' + executionId,";
  const traceReplacement = "trace: { stored: true, classification: { completed_skill_run: completedSkillRun, approved_skill_execution: approvedSkillExecution, explicit_creation: explicitCreation }, trace_id: 'n8n_exec_' + executionId,";
  if (!node.parameters.jsCode.includes("classification: { completed_skill_run:")) {
    if (!node.parameters.jsCode.includes(traceNeedle)) throw new Error("Expected Butler trace source was not found; refusing an ambiguous patch.");
    node.parameters.jsCode = node.parameters.jsCode.replace(traceNeedle, traceReplacement);
    changed = true;
  }
  // n8n workers can retain compiled Code-node source after repeated in-place edits.
  // A stable replacement ID invalidates that cache without restarting the shared service.
  if (node.id !== replacementNodeId) {
    node.id = replacementNodeId;
    changed = true;
  }
  return { changed, workflow };
}

(async () => {
  const live = await n8n("GET", `/workflows/${workflowId}`);
  const patched = patchWorkflow(live);
  if (!apply) {
    console.log(JSON.stringify({ status: "prepared", workflow_id: workflowId, changed: patched.changed }, null, 2));
    return;
  }
  const payload = {
    name: live.name,
    nodes: patched.workflow.nodes,
    connections: live.connections,
    settings: live.settings || {},
    staticData: live.staticData || null,
  };
  const updated = patched.changed ? await n8n("PUT", `/workflows/${workflowId}`, payload) : live;
  const published = await n8n("POST", `/workflows/${workflowId}/activate`, {});
  if (!published.active || published.activeVersionId !== published.versionId) {
    throw new Error("Butler workflow was updated but the saved version is not active.");
  }
  console.log(JSON.stringify({
    status: "published",
    workflow_id: workflowId,
    changed: patched.changed,
    version_id: published.versionId,
    active_version_id: published.activeVersionId,
    updated_version_id: updated.versionId,
  }, null, 2));
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
