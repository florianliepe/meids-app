const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const failures = [];

function read(rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    failures.push(`${rel} missing`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function requireText(label, text, needle) {
  if (!text.includes(needle)) failures.push(`${label} missing ${needle}`);
}

const backend = read("backend/server.js");
const docs = read("docs/production/agent-backend-proxy.md");
const readme = read("backend/README.md");

[
  "/api/agents/actor-twin/chat",
  "/api/agents/knowledge-fabric/ingest",
  "/api/agents/agentic-butler/run",
  "/api/agents/approvals",
  "/api/approvals",
  "/api/traces",
  "/api/admin/n8n/status",
  "/resume",
  "N8N_ACTOR_TWIN_WEBHOOK_URL",
  "N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL",
  "N8N_AGENTIC_BUTLER_WEBHOOK_URL",
  "DATABASE_URL",
  "MEIDS_SECRET_STORE_READY",
  "N8N_ADMIN_ENABLED",
  "normalizeAgentResponse",
  "buildApprovalRecord",
].forEach((needle) => requireText("backend/server.js", backend, needle));

[
  "approval resume",
  "trace-chain persistence",
  "Postgres",
  "Azure App Service",
  "n8n admin",
].forEach((needle) => requireText("docs/production/agent-backend-proxy.md", docs, needle));

[
  "Local Run",
  "agentBackendProxyEnabled",
  "Persistence Boundary",
  "Admin Boundary",
].forEach((needle) => requireText("backend/README.md", readme, needle));

try {
  require(path.join(root, "backend/server.js"));
} catch (error) {
  failures.push(`backend/server.js cannot be required: ${error.message}`);
}

if (failures.length) {
  console.error(JSON.stringify({ status: "failed", failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  status: "passed",
  checks: [
    "backend_proxy_endpoints",
    "approval_resume_endpoint",
    "trace_and_approval_persistence_boundary",
    "production_docs",
  ],
}, null, 2));
