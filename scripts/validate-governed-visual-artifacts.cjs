const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const api = read("backend/workspaceApi.js");
const storage = read("backend/artifactStorage.js");
const migration = read("backend/migrations/018_governed_visual_artifacts.sql");
const frontend = read("frontend/app.js");
const html = read("frontend/index.html");

for (const route of [
  "POST /api/artifacts",
  "GET /api/artifacts",
  "GET /api/artifacts/content",
  "POST /api/artifacts/review",
]) {
  if (!api.includes(`\"${route}\"`)) throw new Error(`Governed visual route missing: ${route}`);
}

for (const required of [
  "CREATE TABLE IF NOT EXISTS knowledge.source_artifact",
  "ALTER TABLE knowledge.source_artifact ENABLE ROW LEVEL SECURITY",
  "CREATE POLICY source_artifact_read",
  "CREATE POLICY source_artifact_write",
  "CREATE POLICY source_artifact_update",
  "GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge.source_artifact TO meids_app_runtime",
]) {
  if (!migration.includes(required)) throw new Error(`Governed visual migration missing: ${required}`);
}

for (const required of [
  "App Service managed identity endpoint is unavailable",
  "x-ms-blob-type",
  "ensurePrivateContainer",
  "Artifact URI is outside the configured private storage account",
]) {
  if (!storage.includes(required)) throw new Error(`Private Blob storage guardrail missing: ${required}`);
}

for (const required of [
  "review_state = $4",
  "artifact.review_state !== \"approved\"",
  "Cache-Control\": \"private, no-store, max-age=0",
  "X-Content-Type-Options\": \"nosniff",
  "cascadeArtifactReview",
  "visualSignatureMatches",
  "markArtifactPersistenceFailure",
]) {
  if (!api.includes(required)) throw new Error(`Governed recall guardrail missing: ${required}`);
}

for (const required of [
  'id="visualArtifactInput"',
  'id="visualArtifactDescription"',
  'id="uploadVisualArtifactBtn"',
  "async function uploadVisualArtifact()",
  "async function loadConceptArtifacts(conceptId)",
]) {
  if (!html.includes(required) && !frontend.includes(required)) throw new Error(`Governed visual UI contract missing: ${required}`);
}

if (api.includes("blob_uri: row.blob_uri") || api.includes("blob_uri: artifact.blob_uri")) {
  throw new Error("Private Blob URI must not be returned in artifact metadata responses.");
}

process.stdout.write("Governed visual artifact contract valid: private Blob, RLS, review gate, and recall UI present.\n");
