const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const runtimeJobs = fs.readFileSync(path.join(root, "backend", "runtimeJobs.js"), "utf8");
const workspaceApi = fs.readFileSync(path.join(root, "backend", "workspaceApi.js"), "utf8");
const server = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "backend", "migrations", "017_runtime_background_jobs.sql"), "utf8");

function requireText(source, text, message) {
  if (!source.includes(text)) throw new Error(message || `Missing ${text}`);
}

for (const required of [
  "FOR UPDATE SKIP LOCKED",
  "lease_expires_at < now()",
  "attempts < max_attempts",
  "binary_payload = NULL",
  "idempotency_key",
]) requireText(runtimeJobs, required, `Runtime worker is missing ${required}.`);

for (const required of [
  'job_type: "skill_execution"',
  'job_type: "voice_transcription"',
  "await enqueueRuntimeJob(client",
  "delete queuedRequest.metadata.authorization.knowledgeAccessToken",
  "knowledgeAccessToken: issueKnowledgeAccessToken(mapping, job.twin_id)",
  "workspaceApi.processRuntimeJobs",
]) requireText(workspaceApi, required, `Workspace API is missing durable queue contract ${required}.`);

if (/jsonResponse\(res, 202, queued\);\s*\n\s*void\s*\(async/.test(workspaceApi)) {
  throw new Error("A 202 route still launches work through a detached in-process promise.");
}

for (const required of [
  "CREATE TABLE IF NOT EXISTS runtime.background_job",
  "binary_payload bytea",
  "dead_letter",
  "idx_background_job_claim",
]) requireText(migration, required, `Runtime job migration is missing ${required}.`);

for (const required of [
  "MEIDS_RUNTIME_JOB_WORKER_ENABLED",
  "handleWorkspaceApi.processRuntimeJobs()",
]) requireText(server, required, `Backend startup is missing ${required}.`);

console.log(JSON.stringify({
  status: "passed",
  contract: "durable-runtime-background-jobs",
  guarantees: [
    "transactional enqueue",
    "lease recovery",
    "bounded retries",
    "idempotency key",
    "binary payload purge",
    "no detached 202 execution",
  ],
}, null, 2));
