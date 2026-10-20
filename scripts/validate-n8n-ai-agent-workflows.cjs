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
  {
    agent_id: "knowledge_retrieval_interviewer",
    workflow: "knowledge-retrieval-interviewer.workflow.json",
    implementation: "knowledge-retrieval-interviewer.ai-agent.workflow.json",
    aiNode: "Knowledge Retrieval Interviewer AI Agent",
    modelNode: "Knowledge Retrieval Interviewer Chat Model",
    responseNode: "Contract response normalizer",
    promptRefs: ["prompts/knowledge-retrieval-interviewer/system.md"],
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

function hasKnowledgeFabricScoringPath(workflow, fromNode, aiNode) {
  const reachesScore = hasMainPath(workflow, fromNode, "Score duplicate and merge evidence")
    || (hasMainPath(workflow, fromNode, "Prepare duplicate request")
      && hasMainPath(workflow, "Prepare duplicate request", "Score duplicate and merge evidence"));
  return reachesScore
    && hasMainPath(workflow, "Score duplicate and merge evidence", "Attach duplicate score evidence")
    && hasMainPath(workflow, "Attach duplicate score evidence", aiNode);
}

function hasAcceptedResponsePath(workflow, agent) {
  if (hasMainPath(workflow, agent.responseNode, "Return JSON")) return true;
  if (agent.agent_id === "knowledge_fabric_agent") {
    return hasMainPath(workflow, agent.responseNode, "Stage review-needed knowledge")
      && hasMainPath(workflow, "Stage review-needed knowledge", "Attach persistence result")
      && hasMainPath(workflow, "Attach persistence result", "Return JSON");
  }
  return false;
}

function hasAcceptedInputPath(workflow, agent, fromNode) {
  if (hasMainPath(workflow, fromNode, agent.aiNode)) return true;
  if (agent.agent_id === "knowledge_fabric_agent") {
    return hasKnowledgeFabricScoringPath(workflow, fromNode, agent.aiNode);
  }
  return false;
}

function hasAiModelConnection(workflow, modelNode, aiNode) {
  const connections = workflow.connections?.[modelNode]?.ai_languageModel || [];
  return connections.some((group) =>
    Array.isArray(group) && group.some((connection) => connection.node === aiNode),
  );
}

function validateEmbeddedActor(workflow, workflowPath) {
  const chat = (workflow.nodes || []).find((node) => node.type === "@n8n/n8n-nodes-langchain.chatTrigger");
  const ai = (workflow.nodes || []).find((node) => String(node.type || "").includes("langchain.agent"));
  const model = (workflow.nodes || []).find((node) => String(node.type || "").includes("lmChat"));
  if (!chat) fail(`${rel(workflowPath)} missing embedded Chat Trigger`);
  if (!ai) fail(`${rel(workflowPath)} missing Actor Twin AI Agent`);
  if (!model) fail(`${rel(workflowPath)} missing Actor Twin Chat Model`);
  if (!hasMainPath(workflow, chat.name, ai.name)) {
    fail(`${rel(workflowPath)} must route the embedded Chat Trigger to ${ai.name}`);
  }
  if (!hasAiModelConnection(workflow, model.name, ai.name)) {
    fail(`${rel(workflowPath)} must connect ${model.name} as language model to ${ai.name}`);
  }
  const requiredInputs = [
    "query",
    "knowledge_access_token",
    "tenant_id",
    "user_id",
    "twin_id",
    "organization_id",
  ];
  for (const toolName of ["Knowledge Fabric Agent", "Agentic Butler"]) {
    const tool = nodeByName(workflow, toolName);
    if (!tool || tool.type !== "@n8n/n8n-nodes-langchain.toolWorkflow") {
      fail(`${rel(workflowPath)} missing ${toolName} workflow tool`);
    }
    const mapped = Object.keys(tool.parameters?.workflowInputs?.value || {});
    const schema = (tool.parameters?.workflowInputs?.schema || []).map((entry) => entry.id);
    for (const input of requiredInputs) {
      if (!mapped.includes(input) || !schema.includes(input)) {
        fail(`${rel(workflowPath)} ${toolName} must map typed input ${input}`);
      }
    }
  }
  const systemMessage = ai.parameters?.options?.systemMessage || "";
  if (systemMessage.length < 80) fail(`${rel(workflowPath)} Actor Twin system prompt is too thin`);
}

function validateWorkflow(agent, workflow, workflowPath) {
  if (!workflow.name) fail(`${rel(workflowPath)} missing workflow name`);
  if (agent.agent_id === "actor_twin"
    && (workflow.nodes || []).some((node) => node.type === "@n8n/n8n-nodes-langchain.chatTrigger")) {
    validateEmbeddedActor(workflow, workflowPath);
    return;
  }
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length < 5) {
    fail(`${rel(workflowPath)} must include webhook, AI Agent, model, adapter, and response nodes`);
  }

  const receive = nodeByName(workflow, "Receive request");
  const workflowCall = nodeByName(workflow, "Receive workflow call");
  const ai = nodeByName(workflow, agent.aiNode);
  const model = nodeByName(workflow, agent.modelNode);
  const response = nodeByName(workflow, agent.responseNode);
  const returnJson = nodeByName(workflow, "Return JSON");

  if (!receive || receive.type !== "n8n-nodes-base.webhook") fail(`${rel(workflowPath)} missing Receive request webhook`);
  if (agent.agent_id !== "actor_twin") {
    if (!workflowCall || workflowCall.type !== "n8n-nodes-base.executeWorkflowTrigger") {
      fail(`${rel(workflowPath)} missing Receive workflow call Execute Workflow Trigger`);
    }
  }
  if (!ai || !String(ai.type || "").includes("langchain.agent")) fail(`${rel(workflowPath)} missing ${agent.aiNode}`);
  if (!model || !String(model.type || "").includes("lmChat")) fail(`${rel(workflowPath)} missing ${agent.modelNode}`);
  if (!response || response.type !== "n8n-nodes-base.code") fail(`${rel(workflowPath)} missing response adapter code node`);
  if (!returnJson || returnJson.type !== "n8n-nodes-base.respondToWebhook") fail(`${rel(workflowPath)} missing Return JSON node`);

  if (!hasAcceptedInputPath(workflow, agent, "Receive request")) {
    fail(`${rel(workflowPath)} must route Receive request to ${agent.aiNode}`);
  }
  if (agent.agent_id !== "actor_twin" && !hasAcceptedInputPath(workflow, agent, "Receive workflow call")) {
    fail(`${rel(workflowPath)} must route Receive workflow call to ${agent.aiNode}`);
  }
  if (!hasMainPath(workflow, agent.aiNode, agent.responseNode)) {
    fail(`${rel(workflowPath)} must route ${agent.aiNode} to ${agent.responseNode}`);
  }
  if (!hasAcceptedResponsePath(workflow, agent)) {
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
