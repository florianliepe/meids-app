const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "contracts", "n8n", "agent-config-public-export.json");
const expectedAgents = ["actor_twin", "knowledge_fabric_agent", "agentic_butler"];

function fail(message) {
  throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const manifest = readJson(manifestPath);

if (manifest.visibility !== "public-safe") fail("manifest.visibility must be public-safe");
if (manifest.target_repository?.recommended_visibility !== "private") {
  fail("target repository must be marked private");
}

const agents = Array.isArray(manifest.top_level_agents) ? manifest.top_level_agents : [];
const seen = new Set(agents.map((agent) => agent.agent_id));
for (const agentId of expectedAgents) {
  if (!seen.has(agentId)) fail(`missing top-level agent ${agentId}`);
}

for (const agent of agents) {
  if (!expectedAgents.includes(agent.agent_id)) fail(`unexpected agent ${agent.agent_id}`);
  if (!agent.fixture_source) fail(`${agent.agent_id}: fixture_source missing`);
  const fixturePath = path.join(root, agent.fixture_source);
  if (!fs.existsSync(fixturePath)) fail(`${agent.agent_id}: fixture missing at ${agent.fixture_source}`);
  const fixture = readJson(fixturePath);
  if (fixture.agent_id !== agent.agent_id) fail(`${agent.agent_id}: fixture agent_id mismatch`);
  if (!agent.target_contract_path?.startsWith("contracts/n8n/")) {
    fail(`${agent.agent_id}: target_contract_path must be under contracts/n8n`);
  }
  if (!agent.target_workflow_path?.startsWith("workflows/n8n/")) {
    fail(`${agent.agent_id}: target_workflow_path must be under workflows/n8n`);
  }
  if (!Array.isArray(agent.target_prompt_paths) || !agent.target_prompt_paths.length) {
    fail(`${agent.agent_id}: target_prompt_paths missing`);
  }
  if (!agent.github_pages_secret?.startsWith("GH_PAGES_N8N_")) {
    fail(`${agent.agent_id}: github_pages_secret must use GH_PAGES_N8N_ prefix`);
  }
  if (!agent.production_secret?.startsWith("N8N_")) {
    fail(`${agent.agent_id}: production_secret must use N8N_ prefix`);
  }
  if (!agent.approval_boundary) fail(`${agent.agent_id}: approval_boundary missing`);
}

const serialized = JSON.stringify(manifest);
const forbidden = [
  "github_pat_",
  "sk-",
  "Bearer ",
  "AZURE_VECTOR_DB_KEY=",
  "PASTE_PUBLIC_UAT_WEBHOOK_URL_HERE",
  "https://eraneos-agentic-platform.azurewebsites.net",
];
for (const token of forbidden) {
  if (serialized.includes(token)) fail(`manifest contains forbidden token: ${token}`);
}

console.log(`Agent config export validation passed: ${agents.length} top-level agents`);
