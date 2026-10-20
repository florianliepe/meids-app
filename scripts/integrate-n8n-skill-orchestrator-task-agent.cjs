#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outRoot = path.join(root, "exports", "n8n-live-backups");

const defaults = {
  butler: "KZOqZRUAnVfFEAYJ",
  skillOrchestrator: "8ER9laJuKS6UrQJF",
  taskAgent: "YXcl8Wb68Oup3Z8n",
};

const skillOrchestratorDescription = [
  "Call this tool when Agentic Butler needs to execute an approved skill, coordinate a multi-step no-write work artifact, decompose an approved generated capability into execution steps, or delegate bounded work to task agents.",
  "",
  "The Skill Orchestrator turns one approved skill objective into a concise execution plan, calls the minimum necessary Task Agent steps, validates their outputs, and returns one coherent result to Agentic Butler with assumptions, task trace, risks, and approval boundaries.",
  "",
  "Do not call this tool for simple one-step drafting that Agentic Butler can complete directly. Do not call it for tacit knowledge interviews; use Knowledge Retrieval Interviewer for that. Do not use it for direct OKF/vector/graph retrieval; use Knowledge Fabric Agent. Human approval is required only before external side effects or activation of newly generated capabilities.",
].join("\n");

const taskAgentDescription = [
  "Call this tool for exactly one bounded execution step from a Skill Orchestrator plan, such as extracting facts, drafting one section, comparing options, formatting content, validating completeness, or summarizing provided material.",
  "",
  "Provide the task objective, relevant context, expected output format, constraints, non-goals, and approval boundary. The Task Agent must not redefine the skill objective, choose tools outside scope, approve anything, persist knowledge directly, or perform external write/send/schedule/publish/delete/commit actions without explicit approval in the task input.",
  "",
  "Use the fewest Task Agent calls necessary and validate every result before synthesis.",
].join("\n");

const butlerSkillOrchestratorRule = [
  "",
  "Tool: Skill Orchestrator",
  skillOrchestratorDescription,
  "",
  "Hard routing rule for Skill Orchestrator: when an Actor Twin delegation requires approved skill execution, multi-step work-artifact production, task decomposition, or bounded execution workers, call Skill Orchestrator before returning the final result. Keep one-step drafts inside Agentic Butler when no decomposition is needed. Keep tacit knowledge elicitation with Knowledge Retrieval Interviewer.",
].join("\n");

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function requireEnv(name) {
  const value = env(name);
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
}

function read(filePath) {
  return fs.readFileSync(path.join(root, filePath), "utf8").trim();
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
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
  if (!response.ok) throw new Error(`${method} ${endpoint} returned ${response.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}

async function saveWorkflow(workflow, outDir, label) {
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
  return updated;
}

function findAgentNode(workflow, preferredNames) {
  return workflow.nodes.find((node) => preferredNames.includes(node.name))
    || workflow.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.agent");
}

function setSystemMessage(workflow, preferredNames, systemMessage) {
  const agent = findAgentNode(workflow, preferredNames);
  if (!agent) throw new Error(`No AI Agent found in ${workflow.name}`);
  agent.parameters = agent.parameters || {};
  agent.parameters.promptType = "define";
  agent.parameters.text = "=Workflow-tool input from caller:\n{{ $json.query || $json.chatInput || $json.input?.query || JSON.stringify($json) }}";
  agent.parameters.options = agent.parameters.options || {};
  agent.parameters.options.systemMessage = systemMessage;
  return agent;
}

function upsertToolWorkflow(workflow, toolNode) {
  const existing = workflow.nodes.find((node) => node.name === toolNode.name);
  if (existing) {
    existing.parameters = toolNode.parameters;
    existing.type = toolNode.type;
    existing.typeVersion = toolNode.typeVersion;
    existing.position = existing.position || toolNode.position;
    return existing;
  }
  workflow.nodes.push(toolNode);
  return toolNode;
}

function appendOnce(text, addition, marker) {
  if (text.includes(marker)) return text;
  return `${text.trim()}\n${addition}`.trim();
}

async function main() {
  const outDir = path.join(outRoot, `${timestamp()}-skill-orchestrator-task-agent-integration`);
  const butlerId = env("N8N_AGENTIC_BUTLER_WORKFLOW_ID", defaults.butler);
  const skillOrchestratorId = env("N8N_SKILL_ORCHESTRATOR_WORKFLOW_ID", defaults.skillOrchestrator);
  const taskAgentId = env("N8N_TASK_AGENT_WORKFLOW_ID", defaults.taskAgent);

  const skillPrompt = read("prompts/skill-orchestrator/system.md");
  const taskPrompt = read("prompts/task-agent/system.md");

  const task = await n8nJson("GET", `/api/v1/workflows/${taskAgentId}`);
  writeJson(path.join(outDir, "task-agent.live-before.json"), task);
  setSystemMessage(task, ["AI Agent", "Task Agent"], taskPrompt);
  const updatedTask = await saveWorkflow(task, outDir, "task-agent");

  const skill = await n8nJson("GET", `/api/v1/workflows/${skillOrchestratorId}`);
  writeJson(path.join(outDir, "skill-orchestrator.live-before.json"), skill);
  const skillAgent = setSystemMessage(skill, ["Skill Orchestrator"], skillPrompt);
  upsertToolWorkflow(skill, {
    id: "meids-skill-orchestrator-task-agent-tool",
    name: "Task Agent",
    type: "@n8n/n8n-nodes-langchain.toolWorkflow",
    typeVersion: 2.2,
    position: [656, 192],
    parameters: {
      description: taskAgentDescription,
      workflowId: {
        __rl: true,
        value: taskAgentId,
        mode: "list",
        cachedResultUrl: `/workflow/${taskAgentId}`,
        cachedResultName: updatedTask.name || "MeIDs Task Agent",
      },
      workflowInputs: {
        mappingMode: "defineBelow",
        value: {},
        matchingColumns: [],
        schema: [],
        attemptToConvertTypes: false,
        convertFieldsToString: false,
      },
    },
  });
  delete skill.connections["Call 'MeIDs Task Agent'"];
  skill.connections["When Executed by Another Workflow"] = {
    main: [[{ node: skillAgent.name, type: "main", index: 0 }]],
  };
  delete skill.connections["Get a file"];
  delete skill.connections["Edit an issue in GitHub"];
  skill.connections["Task Agent"] = {
    ai_tool: [[{ node: skillAgent.name, type: "ai_tool", index: 0 }]],
  };
  const updatedSkill = await saveWorkflow(skill, outDir, "skill-orchestrator");

  const butler = await n8nJson("GET", `/api/v1/workflows/${butlerId}`);
  writeJson(path.join(outDir, "agentic-butler.live-before.json"), butler);
  const butlerAgent = findAgentNode(butler, ["Agentic Butler AI Agent"]);
  if (!butlerAgent) throw new Error("Agentic Butler AI Agent not found");
  butlerAgent.parameters = butlerAgent.parameters || {};
  butlerAgent.parameters.options = butlerAgent.parameters.options || {};
  butlerAgent.parameters.options.systemMessage = appendOnce(
    String(butlerAgent.parameters.options.systemMessage || ""),
    butlerSkillOrchestratorRule,
    "Tool: Skill Orchestrator",
  );
  upsertToolWorkflow(butler, {
    id: "meids-agentic-butler-skill-orchestrator-tool",
    name: "Skill Orchestrator",
    type: "@n8n/n8n-nodes-langchain.toolWorkflow",
    typeVersion: 2.2,
    position: [704, 240],
    parameters: {
      description: skillOrchestratorDescription,
      workflowId: {
        __rl: true,
        value: skillOrchestratorId,
        mode: "list",
        cachedResultUrl: `/workflow/${skillOrchestratorId}`,
        cachedResultName: updatedSkill.name || "MeIDs Skill Orchestrator Agent",
      },
      workflowInputs: {
        mappingMode: "defineBelow",
        value: {},
        matchingColumns: [],
        schema: [],
        attemptToConvertTypes: false,
        convertFieldsToString: false,
      },
    },
  });
  butler.connections["Skill Orchestrator"] = {
    ai_tool: [[{ node: butlerAgent.name, type: "ai_tool", index: 0 }]],
  };
  const updatedButler = await saveWorkflow(butler, outDir, "agentic-butler");

  const summary = {
    status: "applied",
    skill_orchestrator: {
      id: updatedSkill.id,
      name: updatedSkill.name,
      active: Boolean(updatedSkill.active),
      task_agent_tool_connected: Boolean(updatedSkill.connections?.["Task Agent"]?.ai_tool),
    },
    task_agent: {
      id: updatedTask.id,
      name: updatedTask.name,
      active: Boolean(updatedTask.active),
      system_prompt_updated: true,
    },
    agentic_butler: {
      id: updatedButler.id,
      name: updatedButler.name,
      active: Boolean(updatedButler.active),
      skill_orchestrator_tool_connected: Boolean(updatedButler.connections?.["Skill Orchestrator"]?.ai_tool),
    },
    backup: path.relative(root, outDir).replace(/\\/g, "/"),
  };
  writeJson(path.join(outDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
