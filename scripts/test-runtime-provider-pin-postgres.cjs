const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { enqueueRuntimeJob, claimRuntimeJobs } = require("../backend/runtimeJobs");

const connectionString = String(process.env.MEIDS_TEST_DATABASE_URL || "").trim();
const runId = String(process.env.MEIDS_TEST_RUN_ID || "").trim();
if (!connectionString || !/^[a-f0-9]{8,32}$/.test(runId)) {
  throw new Error("MEIDS_TEST_DATABASE_URL and a hexadecimal MEIDS_TEST_RUN_ID are required.");
}
const target = new URL(connectionString);
const databaseName = target.pathname.replace(/^\//, "");
const expectedDatabase = `meids_runtime_provider_${runId}_test`;
if (!["127.0.0.1", "localhost", "::1"].includes(target.hostname)
  || databaseName !== expectedDatabase
  || process.env.MEIDS_ALLOW_DESTRUCTIVE_TEST_DB !== "1") {
  throw new Error("Provider-pin test requires an explicitly enabled, run-owned loopback test database.");
}

const root = path.resolve(__dirname, "..");
const pool = new Pool({ connectionString, max: 6 });

async function prepareBeforePinMigration() {
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meids_app_runtime') THEN
      CREATE ROLE meids_app_runtime;
    END IF;
  END $$`);
  await pool.query("CREATE SCHEMA runtime");
  await pool.query("CREATE SCHEMA app_security");
  await pool.query("CREATE SCHEMA audit");
  await pool.query(`CREATE FUNCTION app_security.setting(name text) RETURNS text
    LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting(name, true), '') $$`);
  await pool.query(`CREATE TABLE audit.event (
    tenant_id text NOT NULL, actor_user_id text NOT NULL, resource_id text,
    resource_type text NOT NULL, action text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb
  )`);
  for (const migration of ["017_runtime_background_jobs.sql", "020_runtime_background_job_cancellation.sql"]) {
    await pool.query(fs.readFileSync(path.join(root, "backend", "migrations", migration), "utf8"));
  }
  await pool.query(`INSERT INTO runtime.background_job
    (job_id, tenant_id, actor_user_id, twin_id, job_type, idempotency_key, payload, status, created_at)
    VALUES
    ('legacy-missing', 'tenant-a', 'user-a', 'twin-a', 'agent_work', 'legacy-missing', '{}'::jsonb, 'pending', '2026-11-11T00:00:00Z'),
    ('native-pinned', 'tenant-a', 'user-a', 'twin-a', 'agent_work', 'native-pinned', '{"runtime_provider":"azure_native"}'::jsonb, 'pending', '2026-11-13T00:00:00Z')`);
  await pool.query(fs.readFileSync(path.join(root, "backend", "migrations", "022_runtime_provider_pin.sql"), "utf8"));
}

async function verifyLegacyFailClosed() {
  const result = await pool.query(`SELECT job_id, status, runtime_provider, result->>'code' AS code
    FROM runtime.background_job WHERE job_id IN ('legacy-missing', 'native-pinned') ORDER BY job_id`);
  assert.deepEqual(result.rows, [
    {
      job_id: "legacy-missing",
      status: "dead_letter",
      runtime_provider: "n8n",
      code: "runtime_provider_missing_before_pin_migration",
    },
    { job_id: "native-pinned", status: "pending", runtime_provider: "azure_native", code: null },
  ]);
}

function job(provider) {
  return {
    job_id: `provider-${provider}`,
    tenant_id: "tenant-a",
    actor_user_id: "user-a",
    twin_id: "twin-a",
    job_type: "agent_work",
    idempotency_key: "provider-race",
    runtime_provider: provider,
    payload: { runtime_provider: provider },
  };
}

async function verifyConcurrentIdempotencyPin() {
  const [first, second] = await Promise.all([
    enqueueRuntimeJob(pool, job("azure_native")),
    enqueueRuntimeJob(pool, job("n8n")),
  ]);
  assert.equal(first.job_id, second.job_id);
  assert.equal(first.runtime_provider, second.runtime_provider);
  const stored = await pool.query("SELECT count(*)::int AS count, runtime_provider FROM runtime.background_job WHERE idempotency_key = 'provider-race' GROUP BY runtime_provider");
  assert.equal(stored.rows[0].count, 1);
  assert.equal(stored.rows[0].runtime_provider, first.runtime_provider);
  await assert.rejects(
    () => pool.query("UPDATE runtime.background_job SET runtime_provider = $2 WHERE job_id = $1", [first.job_id, first.runtime_provider === "n8n" ? "azure_native" : "n8n"]),
    /runtime_provider is immutable/,
  );
}

async function verifyClaimUsesPersistedPin() {
  const claimed = await claimRuntimeJobs(pool, { batchSize: 10, workerId: "provider-test", leaseSeconds: 60 });
  const pinned = claimed.find((item) => item.idempotency_key === "provider-race");
  assert.ok(pinned);
  assert.ok(["n8n", "azure_native"].includes(pinned.runtime_provider));
  assert.equal(pinned.runtime_provider, pinned.payload.runtime_provider);
}

Promise.resolve()
  .then(prepareBeforePinMigration)
  .then(verifyLegacyFailClosed)
  .then(verifyConcurrentIdempotencyPin)
  .then(verifyClaimUsesPersistedPin)
  .then(() => console.log(JSON.stringify({
    status: "passed",
    contract: "meids.runtime-provider-pin.v1",
    scenarios: [
      "legacy_nonterminal_missing_pin_fails_closed",
      "duplicate_enqueue_keeps_first_provider",
      "provider_update_rejected_by_database",
      "claim_reads_persisted_provider",
    ],
  }, null, 2)))
  .finally(() => pool.end())
  .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
