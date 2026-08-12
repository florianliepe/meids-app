const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(
  repoRoot,
  "exports",
  "n8n-live-backups",
  "20260812-ai-agent-activation"
);

const workflows = [
  {
    label: "Knowledge Fabric Agent",
    source: "workflows/n8n/implementations/knowledge-fabric-agent.ai-agent.workflow.json",
    importable: "knowledge-fabric-agent.ai-agent.importable.json",
    wrapped: "knowledge-fabric-agent.ai-agent.wrapped.json",
    requiredNodes: ["Receive request", "Knowledge Fabric AI Agent", "Knowledge Fabric Chat Model", "Contract response normalizer", "Return JSON"],
  },
  {
    label: "Agentic Butler",
    source: "workflows/n8n/implementations/agentic-butler.ai-agent.workflow.json",
    importable: "agentic-butler.ai-agent.importable.json",
    wrapped: "agentic-butler.ai-agent.wrapped.json",
    requiredNodes: ["Receive request", "Agentic Butler AI Agent", "Agentic Butler Chat Model", "Contract response normalizer", "Return JSON"],
  },
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function toImportable(source) {
  return {
    name: source.name,
    nodes: source.nodes,
    connections: source.connections,
    settings: source.settings || { executionOrder: "v1" },
    staticData: source.staticData || null,
  };
}

function validateWorkflow(label, workflow, requiredNodes) {
  const nodeNames = new Set((workflow.nodes || []).map((node) => node.name));
  const missing = requiredNodes.filter((name) => !nodeNames.has(name));
  if (missing.length) {
    throw new Error(`${label} is missing required node(s): ${missing.join(", ")}`);
  }

  const modelNode = workflow.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.lmChatOpenAi");
  if (!modelNode?.credentials?.openAiApi?.name) {
    throw new Error(`${label} chat model has no OpenAI-compatible credential reference.`);
  }

  const agentNode = workflow.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.agent");
  if (!agentNode) {
    throw new Error(`${label} has no n8n AI Agent node.`);
  }
}

fs.mkdirSync(outDir, { recursive: true });

const results = workflows.map((item) => {
  const source = readJson(item.source);
  const importable = toImportable(source);
  validateWorkflow(item.label, importable, item.requiredNodes);

  fs.writeFileSync(path.join(outDir, item.importable), JSON.stringify(importable, null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, item.wrapped), JSON.stringify(source, null, 2) + "\n");

  const model = importable.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.lmChatOpenAi");
  return {
    workflow: item.label,
    importable: path.relative(repoRoot, path.join(outDir, item.importable)).replaceAll("\\", "/"),
    credential: model.credentials.openAiApi.name,
    credential_id: model.credentials.openAiApi.id,
    node_count: importable.nodes.length,
  };
});

console.log(JSON.stringify({ status: "created", results }, null, 2));
