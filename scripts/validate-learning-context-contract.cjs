const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const actor = JSON.parse(fs.readFileSync(path.join(root, "workflows", "n8n", "actor-twin.workflow.json"), "utf8"));
const learning = JSON.parse(fs.readFileSync(path.join(root, "workflows", "n8n", "learning-agent.workflow.json"), "utf8"));
const frontend = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");
const backend = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function nodeByName(workflow, name) {
  return workflow.nodes.find((node) => node.name === name);
}

function hasMainPath(workflow, from, to) {
  return (workflow.connections?.[from]?.main || []).some((group) =>
    Array.isArray(group) && group.some((connection) => connection.node === to),
  );
}

const actorTool = nodeByName(actor, "Learning Agent");
const mapped = actorTool?.parameters?.workflowInputs?.value || {};
const schema = (actorTool?.parameters?.workflowInputs?.schema || []).map((entry) => entry.id);
for (const field of ["query", "knowledge_access_token", "tenant_id", "user_id", "twin_id", "organization_id"]) {
  if (!(field in mapped) || !schema.includes(field)) {
    fail(`Actor Twin Learning Agent tool must map ${field}.`);
  }
}

const executeTrigger = learning.nodes.find((node) => node.type === "n8n-nodes-base.executeWorkflowTrigger");
const webhook = nodeByName(learning, "Receive post-turn learning dispatch");
const normalizer = nodeByName(learning, "Normalize learning context");
const knowledgeTool = nodeByName(learning, "Knowledge Fabric Agent");
if (!executeTrigger || !webhook || !normalizer || !knowledgeTool) {
  fail("Learning Agent must contain both triggers, the context normalizer, and the Knowledge Fabric tool.");
}

const knowledge = JSON.parse(fs.readFileSync(path.join(root, "workflows", "n8n", "knowledge-fabric-agent.workflow.json"), "utf8"));
const scoreNode = nodeByName(knowledge, "Score duplicate and merge evidence");
if (scoreNode?.type !== "n8n-nodes-base.httpRequest") {
  fail("Knowledge Fabric duplicate scoring must use the authenticated hosted backend path.");
}
const scoreBody = scoreNode.parameters?.jsonBody || "";
for (const marker of ["candidate", "twin_id", "organization_id", "knowledge_access_token"]) {
  if (!scoreBody.includes(marker)) fail(`Knowledge scoring request is missing ${marker}.`);
}
if (scoreNode.onError !== "continueRegularOutput") {
  fail("Knowledge scoring must retain the explicit guarded fallback on backend failure.");
}
if (!hasMainPath(learning, executeTrigger.name, normalizer.name)
  || !hasMainPath(learning, webhook.name, normalizer.name)
  || !hasMainPath(learning, normalizer.name, "Learning Agent")) {
  fail("Both Learning Agent entrypoints must pass through Normalize learning context.");
}
const code = normalizer.parameters?.jsCode || "";
for (const marker of ["knowledge_access_token", "trace.twin_id", "post_turn_learning", "identity.activeTwinId"]) {
  if (!code.includes(marker)) fail(`Learning context normalizer is missing ${marker}.`);
}
for (const marker of [
  "source_interaction_summary",
  "_learning_context: learningContext",
  "knowledge_access_token: learningContext.knowledge_access_token",
  "input_summary: inputSummary",
  "output_summary: outputSummary",
]) {
  if (!backend.includes(marker)) fail(`Post-turn backend dispatch is missing ${marker}.`);
}
for (const field of ["knowledge_access_token", "tenant_id", "user_id", "twin_id", "organization_id"]) {
  const expression = knowledgeTool.parameters?.workflowInputs?.value?.[field] || "";
  if (!expression.includes("Normalize learning context")) {
    fail(`Learning Agent Knowledge Fabric tool must read normalized ${field}.`);
  }
}

const switchStart = frontend.indexOf("function bindTwinSwitch()");
const switchEnd = frontend.indexOf("function bindTwins()", switchStart);
const activateStart = frontend.indexOf("async function activateSelectedTwin()");
const activateEnd = frontend.indexOf("async function archiveSelectedTwin()", activateStart);
const switchBlock = switchStart >= 0 && switchEnd > switchStart ? frontend.slice(switchStart, switchEnd) : "";
const activateBlock = activateStart >= 0 && activateEnd > activateStart ? frontend.slice(activateStart, activateEnd) : "";
if (!switchBlock.includes("reloadN8nChatContext();")) {
  fail("Twin selector changes must recreate n8n chat with the new twin metadata.");
}
if ((activateBlock.match(/reloadN8nChatContext\(\);/g) || []).length < 2) {
  fail("Static and backend twin activation must recreate n8n chat with the new twin metadata.");
}
for (const marker of ["installN8nChatBusyGuard", ".chat-message-typing", "input.disabled = busy"]) {
  if (!frontend.includes(marker)) fail(`Embedded n8n chat busy guard is missing ${marker}.`);
}
const actorTraceBody = nodeByName(actor, "Persist post-answer trace")?.parameters?.jsonBody || "";
if (!actorTraceBody.includes("learningSignal") || !actorTraceBody.includes("trace_learning_recommended: learningSignal")) {
  fail("Actor Twin must queue detached learning only for reusable-event signals.");
}

console.log(JSON.stringify({
  status: "passed",
  checks: [
    "actor_learning_tool_propagates_identity_context",
    "inline_and_post_turn_inputs_are_normalized",
    "post_turn_dispatch_contains_trace_content_and_transient_auth",
    "learning_to_knowledge_fabric_preserves_auth_and_twin_scope",
    "duplicate_scoring_uses_user_scoped_backend_auth_with_guarded_fallback",
    "twin_switch_recreates_embedded_chat_context",
    "chat_busy_guard_prevents_dropped_concurrent_turns",
    "post_turn_learning_is_filtered_to_reusable_events",
  ],
}, null, 2));
