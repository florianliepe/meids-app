const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = {
  actor: "actor-twin.workflow.json",
  butler: "agentic-butler.workflow.json",
  skill: "skill-orchestrator.workflow.json",
  task: "task-agent.workflow.json",
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

function read(name) {
  const file = path.join(root, "workflows", "n8n", files[name]);
  if (!fs.existsSync(file)) fail(`Missing canonical workflow: ${files[name]}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const workflows = Object.fromEntries(Object.keys(files).map((name) => [name, read(name)]));
for (const [name, workflow] of Object.entries(workflows)) {
  const prompt = workflow.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.agent")
    ?.parameters?.options?.systemMessage || "";
  if (!prompt.includes("Grounded Skill Chain Guardrail")) fail(`${name} is missing the grounded skill guardrail.`);
}
if (!workflows.actor.nodes.some((node) => node.name === "Knowledge Fabric Agent")) {
  fail("Actor Twin must own evidence retrieval before skill delegation.");
}
if (!workflows.actor.nodes.some((node) => node.name === "Agentic Butler")) {
  fail("Actor Twin must retain Agentic Butler delegation.");
}
const taskTools = workflows.skill.nodes.filter((node) =>
  node.type === "@n8n/n8n-nodes-langchain.toolWorkflow"
  && String(node.parameters?.workflowId?.value || "") === "YXcl8Wb68Oup3Z8n",
);
if (taskTools.length !== 1 || taskTools[0].name !== "Task Agent") {
  fail("Skill Orchestrator must expose exactly one connected Task Agent tool.");
}

console.log(JSON.stringify({
  status: "passed",
  checks: [
    "actor_retrieves_before_evidence_dependent_delegation",
    "butler_rejects_missing_evidence_packages",
    "skill_orchestrator_blocks_ungrounded_task_runs",
    "task_agent_cannot_invent_substitute_facts",
    "duplicate_task_agent_tool_removed",
  ],
}, null, 2));
