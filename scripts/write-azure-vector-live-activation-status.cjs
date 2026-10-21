const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, "frontend", "assets", "azure-vector-live-activation-status.json");
const checkMode = process.argv.includes("--check");

const evidence = {
  schema_version: "0.2.0",
  generated_at: new Date().toISOString(),
  status: "active_semantic_production",
  boundary: "Public-safe live activation status. No Azure keys, gateway keys, or backend secrets are stored here.",
  portal_observation: {
    observed_at: "2026-10-21",
    subscription_id: "25c9ce59-90a1-4e8a-a2d4-1853a19bce22",
    resource_group: "rg-ai-intellectual-twin",
    backend_app_service: "meids-prod-backend-1853a19b",
    search_service: "srch-meids-prod-1853a19b",
    search_endpoint: "https://srch-meids-prod-1853a19b.search.windows.net",
    location: "West Europe",
    pricing_tier: "Basic",
    status: "Running",
    observed_indexes: ["meids-okf-approved-v1", "meids-okf-working-v1"],
    resource_group_resources_observed: [
      { name: "srch-meids-prod-1853a19b", type: "Search service (Foundry IQ)", location: "West Europe" },
      { name: "meids-prod-backend-1853a19b", type: "App Service", location: "West Europe" }
    ]
  },
  readiness: {
    azure_search_service_ready: true,
    azure_search_indexes_ready: true,
    backend_app_service_identified: true,
    backend_secret_slots_ready: true,
    semantic_embeddings_identified: true,
    first_live_upsert_completed: true,
    actor_twin_vector_uat_completed: true,
    knowledge_fabric_vector_refresh_wired: true
  },
  required_backend_settings: [
    "MEIDS_EMBEDDING_PROVIDER",
    "ERANEOS_AI_GATEWAY_BASE_URL",
    "ERANEOS_AI_GATEWAY_EMBEDDING_MODEL",
    "ERANEOS_AI_GATEWAY_API_KEY",
    "MEIDS_ALLOW_DETERMINISTIC_VECTORS",
    "AZURE_SEARCH_ENDPOINT",
    "AZURE_SEARCH_AUTH_MODE",
    "AZURE_SEARCH_APPROVED_INDEX",
    "AZURE_SEARCH_WORKING_INDEX",
    "AZURE_SEARCH_API_VERSION",
    "AZURE_OPENAI_EMBEDDING_DIMENSIONS"
  ],
  required_hosted_backend: {
    purpose: "Secrets, Azure Search writes, embedding calls, vector retrieval, trace persistence, and n8n backend proxy calls run server-side.",
    current_blocker: "none",
    endpoint: "https://meids-prod-backend-1853a19b.azurewebsites.net"
  },
  activation_evidence: {
    provider: "eraneos_gateway",
    model: "text-embedding-3-large",
    dimensions: 1536,
    retrieval_mode: "hybrid_vector_semantic",
    rebuild_source_rows: 9,
    rebuild_deferred_documents: 0,
    deterministic_fallback: false,
    evidence_path: "docs/uat/production-semantic-embedding-uat-20261021.json"
  },
  next_actions: [
    "Monitor gateway latency, error rate, and token consumption during UAT.",
    "Repeat the signed rebuild after any embedding model, dimension, or Search schema change.",
    "Rotate the gateway key through Key Vault without exposing it to frontend or workflow JSON."
  ]
};

function validate(data) {
  const errors = [];
  if (data.status !== "active_semantic_production") errors.push("Unexpected live activation status.");
  if (data.portal_observation.search_endpoint !== "https://srch-meids-prod-1853a19b.search.windows.net") errors.push("Unexpected Azure Search endpoint.");
  if (!Array.isArray(data.portal_observation.observed_indexes)) errors.push("observed_indexes must be an array.");
  if (data.readiness.azure_search_service_ready !== true) errors.push("Azure Search service should be marked ready.");
  if (data.readiness.azure_search_indexes_ready !== true) errors.push("Azure Search indexes should be marked ready.");
  if (data.readiness.semantic_embeddings_identified !== true) errors.push("Semantic embeddings should be marked ready.");
  if (data.activation_evidence.deterministic_fallback !== false) errors.push("Production deterministic fallback must remain disabled.");
  if (data.required_backend_settings.length < 10) errors.push("Required backend settings list is incomplete.");
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
