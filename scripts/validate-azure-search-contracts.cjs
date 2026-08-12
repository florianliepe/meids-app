const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const schemaDir = path.join(root, "contracts", "azure-search");
const setupScript = path.join(root, "scripts", "setup-azure-search-indexes.cjs");
const firstUpsertScript = path.join(root, "scripts", "run-first-vector-upsert.cjs");
const readinessScript = path.join(root, "scripts", "write-azure-vector-readiness-status.cjs");
const liveActivationScript = path.join(root, "scripts", "write-azure-vector-live-activation-status.cjs");
const readinessAsset = path.join(root, "frontend", "assets", "azure-vector-readiness-status.json");
const liveActivationAsset = path.join(root, "frontend", "assets", "azure-vector-live-activation-status.json");
const n8nVectorRefreshNode = path.join(root, "workflows", "n8n", "implementations", "knowledge-fabric-vector-refresh-http-node.json");
const requiredSchemas = ["meids-okf-approved-v1.index.json", "meids-okf-working-v1.index.json"];
const requiredFields = [
  "id",
  "organization_id",
  "user_id",
  "twin_id",
  "visibility_scope",
  "knowledge_state",
  "okf_concept_id",
  "okf_type",
  "title",
  "summary",
  "chunk_id",
  "chunk_text",
  "repo_path",
  "evidence_id",
  "graph_node_id",
  "graph_cluster_id",
  "tags",
  "permission_tags",
  "content_vector",
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Invalid JSON ${path.relative(root, file)}: ${error.message}`);
  }
}

if (!fs.existsSync(setupScript)) fail("Missing Azure Search setup script: scripts/setup-azure-search-indexes.cjs");
if (!fs.existsSync(firstUpsertScript)) fail("Missing first vector upsert runner: scripts/run-first-vector-upsert.cjs");
if (!fs.existsSync(readinessScript)) fail("Missing Azure vector readiness writer: scripts/write-azure-vector-readiness-status.cjs");
if (!fs.existsSync(liveActivationScript)) fail("Missing Azure vector live activation writer: scripts/write-azure-vector-live-activation-status.cjs");
if (!fs.existsSync(readinessAsset)) fail("Missing Azure vector readiness asset: frontend/assets/azure-vector-readiness-status.json");
if (!fs.existsSync(liveActivationAsset)) fail("Missing Azure vector live activation asset: frontend/assets/azure-vector-live-activation-status.json");
if (!fs.existsSync(n8nVectorRefreshNode)) fail("Missing Knowledge Fabric vector refresh n8n node blueprint");

for (const fileName of requiredSchemas) {
  const file = path.join(schemaDir, fileName);
  if (!fs.existsSync(file)) fail(`Missing Azure Search index schema: ${path.relative(root, file)}`);
  const schema = readJson(file);
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  const byName = new Map(fields.map((field) => [field.name, field]));
  for (const field of requiredFields) {
    if (!byName.has(field)) fail(`${fileName}: missing field ${field}`);
  }
  for (const field of ["organization_id", "twin_id", "visibility_scope", "knowledge_state", "permission_tags"]) {
    if (byName.get(field)?.filterable !== true) fail(`${fileName}: ${field} must be filterable for security trimming`);
  }
  const vector = byName.get("content_vector");
  if (vector.type !== "Collection(Edm.Single)") fail(`${fileName}: content_vector must be Collection(Edm.Single)`);
  if (Number(vector.dimensions) !== 1536) fail(`${fileName}: content_vector dimensions must be 1536 until embedding model changes`);
  if (!vector.vectorSearchProfile) fail(`${fileName}: content_vector must declare vectorSearchProfile`);
  if (!schema.vectorSearch?.profiles?.length) fail(`${fileName}: vectorSearch.profiles missing`);
  if (!schema.semantic?.configurations?.length) fail(`${fileName}: semantic configuration missing`);
}

const adapter = require("../backend/azureSearch");
const filter = adapter.buildActorTwinFilter({ organizationId: "org", twinId: "florian", includeShared: true });
for (const literal of ["organization_id eq 'org'", "knowledge_state eq 'approved'", "twin_id eq 'florian'", "visibility_scope eq 'org_shared'"]) {
  if (!filter.includes(literal)) fail(`Actor Twin filter missing ${literal}`);
}
const doc = adapter.vectorDocumentFromOkf({
  concept_id: "cpt_test",
  repo_path: "concepts/florian/test.md",
  review_state: "approved",
  text: "Test concept text.",
  metadata: { type: "Decision Principle", cluster: "client-delivery", evidence_refs: [], evidence_review_states: [] },
}, { organization_id: "org", twin_id: "florian" });
if (doc.organization_id !== "org" || doc.twin_id !== "florian") fail("Vector document tenant/twin mapping failed");
if (!Array.isArray(doc.content_vector) || doc.content_vector.length !== 1536) fail("Vector document fallback vector dimensions failed");
const status = adapter.statusFromConfig({
  configured: true,
  embeddingConfigured: true,
  endpoint: "https://example.search.windows.net",
  apiKey: "configured",
  approvedIndex: "approved",
  workingIndex: "working",
  apiVersion: "2025-09-01",
  embeddingEndpoint: "https://example.openai.azure.com",
  embeddingApiKey: "configured",
  embeddingDeployment: "text-embedding-3-small",
  embeddingApiVersion: "2024-02-01",
  embeddingDimensions: 1536,
  missing: [],
  embeddingMissing: [],
});
if (status.embedding.status !== "configured") fail("Embedding status mapping failed");
const readiness = readJson(readinessAsset);
if (readiness.status !== "ready_for_secret_activation") fail("Azure vector readiness asset must be ready_for_secret_activation");
const liveActivation = readJson(liveActivationAsset);
if (liveActivation.status !== "blocked_until_backend_and_embedding_secrets") fail("Azure vector live activation asset must reflect current live blockers");
if (liveActivation.portal_observation?.search_endpoint !== "https://srch-intellectual-twin.search.windows.net") {
  fail("Azure vector live activation asset must reference srch-intellectual-twin endpoint");
}
if (liveActivation.readiness?.azure_search_service_ready !== true) fail("Azure Search service must be marked ready in live activation asset");
if (liveActivation.readiness?.azure_search_indexes_ready !== false) fail("Azure Search indexes must remain blocked until live setup executes");
const n8nNode = readJson(n8nVectorRefreshNode);
if (n8nNode.node?.parameters?.url !== "={{ $env.MEIDS_BACKEND_URL }}/api/vector-index/rebuild") {
  fail("Knowledge Fabric vector refresh node must call backend /api/vector-index/rebuild");
}

console.log("Azure Search contracts validation passed");
