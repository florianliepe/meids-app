const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const check = args.has("--check");
const outputPath = path.join(root, "frontend", "assets", "azure-vector-readiness-status.json");

function rel(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function readJson(relativePath, fallback = {}) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function stable(artifact) {
  return { ...artifact, generated_at: "<ignored>" };
}

function buildArtifact() {
  const approvedSchema = "contracts/azure-search/meids-okf-approved-v1.index.json";
  const workingSchema = "contracts/azure-search/meids-okf-working-v1.index.json";
  const setupScript = "scripts/setup-azure-search-indexes.cjs";
  const upsertScript = "scripts/run-first-vector-upsert.cjs";
  const guide = "docs/azure-vector-search-integration.md";
  const approvedFixture = "contracts/okf/examples/vector/approved-only-upsert-request.json";
  const knowledgeFixture = readJson("contracts/n8n/fixtures/knowledge-fabric-agent.json", {});
  const vectorRefresh = knowledgeFixture.response?.output?.vector_refresh_request || {};
  const readyChecks = [
    { id: "approved_index_schema", ready: exists(approvedSchema), evidence: approvedSchema },
    { id: "working_index_schema", ready: exists(workingSchema), evidence: workingSchema },
    { id: "setup_script", ready: exists(setupScript), evidence: setupScript },
    { id: "first_upsert_runner", ready: exists(upsertScript), evidence: upsertScript },
    { id: "approved_fixture", ready: exists(approvedFixture), evidence: approvedFixture },
    { id: "knowledge_fabric_vector_refresh_contract", ready: vectorRefresh.target_endpoint === "/api/vector-index/rebuild", evidence: "contracts/n8n/fixtures/knowledge-fabric-agent.json" },
    { id: "operator_guide", ready: exists(guide), evidence: guide },
  ];
  const readyCount = readyChecks.filter((item) => item.ready).length;
  return {
    schema_version: "0.1.0",
    generated_at: new Date().toISOString(),
    status: readyCount === readyChecks.length ? "ready_for_secret_activation" : "blocked",
    boundary: "Public-safe Azure vector readiness artifact. It contains no Azure keys and does not call Azure.",
    architecture_decision: {
      service_model: "single_azure_ai_search_service_shared_indexes",
      approved_index: "meids-okf-approved-v1",
      working_index: "meids-okf-working-v1",
      isolation: "organization_id + twin_id + visibility_scope filters",
      sharing_policy: "approved org/team shared knowledge only",
    },
    summary: {
      ready_check_count: readyCount,
      check_count: readyChecks.length,
      requires_backend_secret_activation: true,
      requires_index_setup_execution: true,
      requires_first_live_upsert: true,
    },
    checks: readyChecks,
    backend_secret_slots: [
      "AZURE_SEARCH_ENDPOINT",
      "AZURE_SEARCH_API_KEY",
      "AZURE_SEARCH_APPROVED_INDEX",
      "AZURE_SEARCH_WORKING_INDEX",
      "AZURE_SEARCH_API_VERSION",
      "AZURE_OPENAI_ENDPOINT",
      "AZURE_OPENAI_API_KEY",
      "AZURE_OPENAI_EMBEDDING_DEPLOYMENT",
      "AZURE_OPENAI_API_VERSION",
      "AZURE_OPENAI_EMBEDDING_DIMENSIONS"
    ],
    commands: {
      dry_run_index_setup: "npm run setup:azure-search -- --dry-run",
      live_index_setup: "npm run setup:azure-search",
      dry_run_first_upsert: "node scripts/run-first-vector-upsert.cjs --dry-run --backend-url https://YOUR-BACKEND-HOST",
      live_first_upsert: "node scripts/run-first-vector-upsert.cjs --backend-url https://YOUR-BACKEND-HOST"
    },
    next_actions: [
      "Configure backend App Service settings or Key Vault references for Azure Search and Azure OpenAI embeddings.",
      "Run setup:azure-search from a trusted operator machine or deployment job.",
      "Run first approved OKF upsert against the hosted backend.",
      "Run Actor Twin UAT and verify vector_retrieval is attached to the route envelope.",
      "Update Knowledge Fabric n8n workflow to call the backend vector refresh endpoint after approved OKF promotion."
    ],
  };
}

function main() {
  const artifact = buildArtifact();
  if (write) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  }
  if (check) {
    if (!fs.existsSync(outputPath)) {
      console.error(`Azure vector readiness artifact missing: ${rel(outputPath)}`);
      process.exit(1);
    }
    const current = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    if (JSON.stringify(stable(current), null, 2) !== JSON.stringify(stable(artifact), null, 2)) {
      console.error(`Azure vector readiness artifact is stale: ${rel(outputPath)}`);
      process.exit(1);
    }
  }
  console.log(JSON.stringify({
    status: artifact.status,
    output: rel(outputPath),
    ready: artifact.summary.ready_check_count,
    total: artifact.summary.check_count,
  }, null, 2));
}

main();
