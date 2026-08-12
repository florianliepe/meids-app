const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, "frontend", "assets", "azure-vector-live-activation-status.json");
const checkMode = process.argv.includes("--check");

const evidence = {
  schema_version: "0.1.0",
  generated_at: new Date().toISOString(),
  status: "blocked_until_backend_and_embedding_secrets",
  boundary: "Public-safe live activation status. No Azure keys, OpenAI keys, or backend secrets are stored here.",
  portal_observation: {
    observed_at: "2026-08-12",
    subscription_id: "25c9ce59-90a1-4e8a-a2d4-1853a19bce22",
    resource_group: "rg-ai-intellectual-twin",
    search_service: "srch-intellectual-twin",
    search_endpoint: "https://srch-intellectual-twin.search.windows.net",
    location: "West Europe",
    pricing_tier: "Basic",
    status: "Running",
    observed_indexes: [],
    resource_group_resources_observed: [
      {
        name: "srch-intellectual-twin",
        type: "Search service (Foundry IQ)",
        location: "West Europe"
      }
    ]
  },
  readiness: {
    azure_search_service_ready: true,
    azure_search_indexes_ready: false,
    backend_app_service_identified: false,
    backend_secret_slots_ready: false,
    azure_openai_embeddings_identified: false,
    first_live_upsert_completed: false,
    actor_twin_vector_uat_completed: false,
    knowledge_fabric_vector_refresh_wired: false
  },
  required_backend_settings: [
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
  required_hosted_backend: {
    purpose: "Secrets, Azure Search writes, embedding calls, vector retrieval, trace persistence, and n8n backend proxy calls must run server-side.",
    current_blocker: "No backend App Service resource was visible in rg-ai-intellectual-twin during portal inspection.",
    expected_endpoint_shape: "https://YOUR-BACKEND-HOST/api/vector-index/status"
  },
  commands_after_secret_activation: {
    index_setup_dry_run: "npm run setup:azure-search -- --dry-run",
    index_setup_live: "npm run setup:azure-search",
    hosted_status_probe: "Invoke-RestMethod -Uri \"https://YOUR-BACKEND-HOST/api/vector-index/status\" -Method Get",
    first_upsert_dry_run: "node scripts/run-first-vector-upsert.cjs --dry-run --backend-url https://YOUR-BACKEND-HOST",
    first_upsert_live: "node scripts/run-first-vector-upsert.cjs --backend-url https://YOUR-BACKEND-HOST",
    actor_twin_vector_probe: "Invoke-RestMethod -Uri \"https://YOUR-BACKEND-HOST/api/vector-index/search\" -Method Post -ContentType \"application/json\" -Body '{\"query\":\"client delivery steering\",\"twin_id\":\"florian\",\"organization_id\":\"default\",\"source_policy\":\"approved_only\",\"top\":5}'"
  },
  next_actions: [
    "Create or identify a hosted MeIDs backend App Service for backend/server.js.",
    "Create or identify an Azure OpenAI embedding resource/deployment with 1536 dimensions.",
    "Configure backend-only Azure Search and Azure OpenAI settings in App Service settings or Key Vault references.",
    "Run Azure Search index setup from a trusted backend/operator environment.",
    "Run the first approved OKF vector upsert against the hosted backend.",
    "Wire Knowledge Fabric n8n approval flow to call the hosted backend vector refresh endpoint."
  ]
};

function validate(data) {
  const errors = [];
  if (data.status !== "blocked_until_backend_and_embedding_secrets") errors.push("Unexpected live activation status.");
  if (data.portal_observation.search_endpoint !== "https://srch-intellectual-twin.search.windows.net") errors.push("Unexpected Azure Search endpoint.");
  if (!Array.isArray(data.portal_observation.observed_indexes)) errors.push("observed_indexes must be an array.");
  if (data.readiness.azure_search_service_ready !== true) errors.push("Azure Search service should be marked ready.");
  if (data.readiness.azure_search_indexes_ready !== false) errors.push("Azure Search indexes should remain false until setup executes.");
  if (data.required_backend_settings.length < 10) errors.push("Required backend settings list is incomplete.");
  if (!data.commands_after_secret_activation.index_setup_live.includes("setup:azure-search")) errors.push("Missing index setup command.");
  return errors;
}

if (checkMode) {
  const existing = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  const errors = validate(existing);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(JSON.stringify({
    status: existing.status,
    output: path.relative(root, outputPath).replace(/\\/g, "/"),
    search_service_ready: existing.readiness.azure_search_service_ready,
    indexes_ready: existing.readiness.azure_search_indexes_ready
  }, null, 2));
  process.exit(0);
}

const errors = validate(evidence);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({
  status: evidence.status,
  output: path.relative(root, outputPath).replace(/\\/g, "/"),
  search_service_ready: evidence.readiness.azure_search_service_ready,
  indexes_ready: evidence.readiness.azure_search_indexes_ready
}, null, 2));
