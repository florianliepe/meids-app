const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const schemaDir = path.join(root, "contracts", "azure-search");
const schemaFiles = [
  "meids-okf-approved-v1.index.json",
  "meids-okf-working-v1.index.json",
];

function cleanBaseUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function configFromEnv() {
  const endpoint = cleanBaseUrl(process.env.AZURE_SEARCH_ENDPOINT || process.env.AZURE_AI_SEARCH_ENDPOINT || "");
  const apiKey = String(process.env.AZURE_SEARCH_API_KEY || process.env.AZURE_AI_SEARCH_API_KEY || "").trim();
  const apiVersion = String(process.env.AZURE_SEARCH_API_VERSION || "2025-09-01").trim();
  const authMode = String(process.env.AZURE_SEARCH_AUTH_MODE || (apiKey ? "api_key" : "azure_cli")).trim().toLowerCase();
  const missing = [];
  if (!endpoint) missing.push("AZURE_SEARCH_ENDPOINT");
  if (authMode === "api_key" && !apiKey) missing.push("AZURE_SEARCH_API_KEY");
  if (!["api_key", "azure_cli"].includes(authMode)) missing.push("AZURE_SEARCH_AUTH_MODE=api_key or azure_cli");
  return { endpoint, apiKey, apiVersion, authMode, missing };
}

function authHeaders(config) {
  if (config.authMode === "api_key") return { "api-key": config.apiKey };
  const args = [
    "account",
    "get-access-token",
    "--resource",
    "https://search.azure.com",
    "--query",
    "accessToken",
    "-o",
    "tsv",
  ];
  const token = process.platform === "win32"
    ? execFileSync("cmd.exe", ["/d", "/s", "/c", `az ${args.join(" ")}`], { encoding: "utf8", windowsHide: true }).trim()
    : execFileSync("az", args, { encoding: "utf8" }).trim();
  if (!token) fail("Azure CLI did not return an Azure AI Search access token.");
  return { Authorization: `Bearer ${token}` };
}

async function putIndex(schema, config) {
  const response = await fetch(`${config.endpoint}/indexes/${encodeURIComponent(schema.name)}?api-version=${encodeURIComponent(config.apiVersion)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(config),
    },
    body: JSON.stringify(schema),
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    fail(`${schema.name}: Azure Search returned ${response.status}: ${data.error?.message || raw}`);
  }
  return data;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const config = configFromEnv();
  const schemas = schemaFiles.map((fileName) => {
    const file = path.join(schemaDir, fileName);
    if (!fs.existsSync(file)) fail(`Missing schema: ${path.relative(root, file)}`);
    const schema = readJson(file);
    if (!schema.name || !Array.isArray(schema.fields)) fail(`Invalid Azure Search index schema: ${path.relative(root, file)}`);
    return { fileName, schema };
  });

  if (dryRun) {
    console.log(JSON.stringify({
      status: config.missing.length ? "blocked" : "ready",
      operation: "setup_azure_search_indexes",
      dry_run: true,
      endpoint_configured: Boolean(config.endpoint),
      api_key_configured: Boolean(config.apiKey),
      authentication: config.authMode,
      api_version: config.apiVersion,
      missing: config.missing,
      indexes: schemas.map(({ schema }) => schema.name),
    }, null, 2));
    return;
  }

  if (config.missing.length) fail(`Missing required environment variables: ${config.missing.join(", ")}`);
  const results = [];
  for (const { schema } of schemas) {
    const result = await putIndex(schema, config);
    results.push({ name: schema.name, fields: Array.isArray(result.fields) ? result.fields.length : schema.fields.length });
  }
  console.log(JSON.stringify({
    status: "completed",
    operation: "setup_azure_search_indexes",
    indexes: results,
  }, null, 2));
}

main().catch((error) => fail(error.message || String(error)));
