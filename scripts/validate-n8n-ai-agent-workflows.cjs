const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const agents = [
  {
    agent_id: "actor_twin",
    workflow: "actor-twin.workflow.json",
    implementation: "actor-twin.ai-agent.workflow.json",
    aiNode: "Actor Twin AI Agent",
    modelNode: "Actor Twin Chat Model",
    responseNode: "Contract response normalizer",
    promptRefs: ["prompts/actor-twin/system.md", "prompts/actor-twin/critic.md"],
  },
  {
    agent_id: "knowledge_fabric_agent",
    workflow: "knowledge-fabric-agent.workflow.json",
    implementation: "knowledge-fabric-agent.ai-agent.workflow.json",
    aiNode: "Knowledge Fabric AI Agent",
    modelNode: "Knowledge Fabric Chat Model",
    responseNode: "Contract response normalizer",
    promptRefs: [
      "prompts/knowledge-fabric-agent/system.md",
      "prompts/knowledge-fabric-agent/graph-curator.md",
      "prompts/knowledge-fabric-agent/vector-refresh.md",
    ],
  },
  {
    agent_id: "agentic_butler",
    workflow: "agentic-butler.workflow.json",
    implementation: "agentic-butler.ai-agent.workflow.json",
    aiNode: "Agentic Butler AI Agent",
    modelNode: "Agentic Butler Chat Model",
    responseNode: "Contract response normalizer",
    promptRefs: [
      "prompts/agentic-butler/system.md",
      "prompts/agentic-butler/skill-orchestrator.md",
      "prompts/agentic-butler/approval-gates.md",
    ],
  },
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function rel(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function readJson(file) {
  if (!fs.existsSync(file)) fail(`Missing file: ${rel(file)}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function nodeByName(workflow, name) {
  return (workflow.nodes || []).find((node) => node.name === name);
}

function hasMainPath(workflow, fromNode, toNode) {
  const connections = workflow.connections?.[fromNode]?.main || [];
  return connections.some((group) =>
    Array.isArray(group) && group.some((connection) => connection.node === toNode),
  );
}

function hasAiModelConnection(workflow, modelNode, aiNode) {
  const connections = workflow.connections?.[modelNode]?.ai_languageModel || [];
  return connections.some((group) =>
    Array.isArray(group) && group.some((connection) => connection.node === aiNode),
  );
}

function validateWorkflow(agent, workflow, workflowPath) {
  if (!workflow.name) fail(`${rel(workflowPath)} missing workflow name`);
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length < 5) {
    fail(`${rel(workflowPath)} must include webhook, AI Agent, model, adapter, and response nodes`);
  }

  const receive = nodeByName(workflow, "Receive request");
  const ai = nodeByName(workflow, agent.aiNode);
  const model = nodeByName(workflow, agent.modelNode);
  const response = nodeByName(workflow, agent.responseNode);
  const returnJson = nodeByName(workflow, "Return JSON");

  if (!receive || receive.type !== "n8n-nodes-base.webhook") fail(`${rel(workflowPath)} missing Receive request webhook`);
  if (!ai || !String(ai.type || "").includes("langchain.agent")) fail(`${rel(workflowPath)} missing ${agent.aiNode}`);
  if (!model || !String(model.type || "").includes("lmChat")) fail(`${rel(workflowPath)} missing ${agent.modelNode}`);
  if (!response || response.type !== "n8n-nodes-base.code") fail(`${rel(workflowPath)} missing response adapter code node`);
  if (!returnJson || returnJson.type !== "n8n-nodes-base.respondToWebhook") fail(`${rel(workflowPath)} missing Return JSON node`);

  if (!hasMainPath(workflow, "Receive request", agent.aiNode)) {
    fail(`${rel(workflowPath)} must route Receive request to ${agent.aiNode}`);
  }
  if (!hasMainPath(workflow, agent.aiNode, agent.responseNode)) {
    fail(`${rel(workflowPath)} must route ${agent.aiNode} to ${agent.responseNode}`);
  }
  if (!hasMainPath(workflow, agent.responseNode, "Return JSON")) {
    fail(`${rel(workflowPath)} must route ${agent.responseNode} to Return JSON`);
  }
  if (!hasAiModelConnection(workflow, agent.modelNode, agent.aiNode)) {
    fail(`${rel(workflowPath)} must connect ${agent.modelNode} as language model to ${agent.aiNode}`);
  }

  const systemMessage = ai.parameters?.options?.systemMessage || "";
  if (!systemMessage || systemMessage.length < 80) fail(`${rel(workflowPath)} ${agent.aiNode} system prompt is too thin`);
  if (!response.parameters?.jsCode?.includes("trace_id")) fail(`${rel(workflowPath)} response adapter must preserve trace_id`);
  if (!response.parameters?.jsCode?.includes("agent_id")) fail(`${rel(workflowPath)} response adapter must preserve agent_id`);
}

for (const agent of agents) {
  const workflowPath = path.join(root, "workflows", "n8n", agent.workflow);
  const implementationPath = path.join(root, "workflows", "n8n", "implementations", agent.implementation);
  const workflow = readJson(workflowPath);
  const implementation = readJson(implementationPath);

  validateWorkflow(agent, workflow, workflowPath);
  validateWorkflow(agent, implementation, implementationPath);

  for (const promptRef of agent.promptRefs) {
    const promptPath = path.join(root, promptRef);
    if (!fs.existsSync(promptPath)) fail(`${agent.agent_id} missing prompt ref: ${promptRef}`);
    const promptText = fs.readFileSync(promptPath, "utf8").trim();
    if (promptText.length < 200) fail(`${promptRef} is too short for an actionable agent instruction`);
  }
}

console.log(`n8n AI-agent workflow validation passed: ${agents.length} agents`);
