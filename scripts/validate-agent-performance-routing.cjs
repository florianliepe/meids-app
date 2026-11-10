const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const actor = JSON.parse(fs.readFileSync(path.join(root, "workflows/n8n/actor-twin.workflow.json")));
const butler = JSON.parse(fs.readFileSync(path.join(root, "workflows/n8n/agentic-butler.workflow.json")));
const contract = JSON.parse(fs.readFileSync(path.join(root, "contracts/n8n/agent-routing-policy.v1.json")));

assert.equal(contract.contract, "meids.agent-routing.v1");
assert(actor.nodes.some((node) => node.name === "Classify interaction route"), "Actor must classify before reasoning");
assert(!actor.nodes.some((node) => node.name === "Learning Agent"), "Learning must not be an inline Actor tool");
assert.deepEqual(actor.connections["When chat message received"].main[0][0].node, "Classify interaction route");
assert.deepEqual(actor.connections["Classify interaction route"].main[0][0].node, "Actor Twin AI Agent1");

const actorAgent = actor.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.agent");
assert.match(actorAgent.parameters.options.systemMessage, /Deterministic Routing Contract v1/);
assert.match(actorAgent.parameters.options.systemMessage, /Never call Learning Agent inline/);

const butlerTool = actor.nodes.find((node) => node.name === "Agentic Butler");
assert(Object.hasOwn(butlerTool.parameters.workflowInputs.value, "routing_contract"));
const butlerTrigger = butler.nodes.find((node) => node.type === "n8n-nodes-base.executeWorkflowTrigger");
assert(butlerTrigger.parameters.workflowInputs.values.some((field) => field.name === "routing_contract"));
const butlerAgent = butler.nodes.find((node) => node.type === "@n8n/n8n-nodes-langchain.agent");
assert.match(butlerAgent.parameters.options.systemMessage, /gates\.skill_orchestrator=true/);

console.log("Agent performance routing validation passed");
