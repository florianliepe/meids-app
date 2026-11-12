const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const {
  claimRuntimeJobs,
  completeRuntimeJob,
  failRuntimeJob,
} = require("../backend/runtimeJobs");

const connectionString = String(process.env.MEIDS_TEST_DATABASE_URL || "").trim();
const runId = String(process.env.MEIDS_TEST_RUN_ID || "").trim();
if (!connectionString || !/^[a-f0-9]{8,32}$/.test(runId)) {
  throw new Error("MEIDS_TEST_DATABASE_URL and a hexadecimal MEIDS_TEST_RUN_ID are required.");
}
const target = new URL(connectionString);
const databaseName = target.pathname.replace(/^\//, "");
const expectedDatabase = `meids_runtime_lease_${runId}_test`;
const loopback = ["127.0.0.1", "localhost", "::1"].includes(target.hostname);
if (!loopback || databaseName !== expectedDatabase || process.env.MEIDS_ALLOW_DESTRUCTIVE_TEST_DB !== "1") {
  throw new Error("Lease-fencing test requires an explicitly enabled, run-owned loopback test database.");
}

const root = path.resolve(__dirname, "..");
const pool = new Pool({ connectionString, max: 4 });

async function prepareMigratedSchema() {
  const current = await pool.query("SELECT current_database() AS name");
  assert.equal(current.rows[0].name, expectedDatabase);
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
  await pool.query(`CREATE FUNCTION app_security.setting_list(name text) RETURNS text[]
    LANGUAGE sql STABLE AS $$ SELECT CASE
      WHEN app_security.setting(name) IS NULL THEN ARRAY[]::text[]
      ELSE string_to_array(app_security.setting(name), ',') END $$`);
  await pool.query(`CREATE TABLE audit.event (
    tenant_id text NOT NULL, actor_user_id text NOT NULL, resource_id text,
    resource_type text NOT NULL, action text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb
  )`);
  for (const migration of [
    "012_audit_runtime_read_policy.sql",
    "017_runtime_background_jobs.sql",
    "019_audit_background_work_update_policy.sql",
    "020_runtime_background_job_cancellation.sql",
  ]) {
    await pool.query(fs.readFileSync(path.join(root, "backend", "migrations", migration), "utf8"));
  }
}

async function enqueue(jobId) {
  await pool.query(
    `INSERT INTO runtime.background_job (
       job_id, tenant_id, actor_user_id, twin_id, job_type, idempotency_key, payload, binary_payload, max_attempts
     ) VALUES ($1, 'tenant-a', 'user-a', 'twin-a', 'agent_work', $2, '{}'::jsonb, decode('CAFE', 'hex'), 3)`,
    [jobId, `${jobId}-${runId}`],
  );
}

async function expireLease(jobId) {
  await pool.query(
    "UPDATE runtime.background_job SET lease_expires_at = now() - interval '1 second' WHERE job_id = $1",
    [jobId],
  );
}

async function verifySameWorkerReclaimFence() {
  await enqueue("lease-fence-complete");
  const first = (await claimRuntimeJobs(pool, { workerId: "stable-worker-id", batchSize: 1, leaseSeconds: 60 }))[0];
  assert.equal(first.attempts, 1);
  await expireLease(first.job_id);
  const reclaimed = await pool.query(
    `UPDATE runtime.background_job
     SET attempts = attempts + 1, leased_at = now(), lease_expires_at = now() + interval '60 seconds'
     WHERE job_id = $1 AND status = 'processing'
     RETURNING *`,
    [first.job_id],
  );
  const second = reclaimed.rows[0];
  assert.equal(second.job_id, first.job_id);
  assert.equal(second.attempts, 2);

  await assert.rejects(
    () => completeRuntimeJob(pool, first, { stale: true }),
    /completion lease was lost/,
  );
  await assert.rejects(
    () => failRuntimeJob(pool, first, new Error("stale failure")),
    /failure lease was lost/,
  );
  await completeRuntimeJob(pool, second, { accepted_attempt: second.attempts });
  await assert.rejects(
    () => failRuntimeJob(pool, first, new Error("late terminal regression")),
    /failure lease was lost/,
  );

  const stored = await pool.query(
    `SELECT status, attempts, result, binary_payload IS NULL AS binary_purged
     FROM runtime.background_job WHERE job_id = $1`,
    [first.job_id],
  );
  assert.deepEqual(stored.rows[0], {
    status: "completed",
    attempts: 2,
    result: { accepted_attempt: 2 },
    binary_purged: true,
  });
}

async function verifyExpiredLeaseStopsWithoutRedispatch() {
  await enqueue("lease-expired-unknown");
  const first = (await claimRuntimeJobs(pool, { workerId: "uncertain-worker", batchSize: 1, leaseSeconds: 60 }))[0];
  assert.equal(first.attempts, 1);
  await expireLease(first.job_id);
  const secondClaim = await claimRuntimeJobs(pool, { workerId: "replacement-worker", batchSize: 1, leaseSeconds: 60 });
  assert.equal(secondClaim.length, 0);
  const stored = await pool.query(
    `SELECT status, attempts, result, leased_by, binary_payload IS NULL AS binary_purged
     FROM runtime.background_job WHERE job_id = $1`,
    [first.job_id],
  );
  assert.deepEqual(stored.rows[0], {
    status: "dead_letter",
    attempts: 1,
    result: {
      status: "unknown_completion",
      code: "runtime_lease_expired_unknown_completion",
      retryable: false,
      reconciliation_required: true,
    },
    leased_by: null,
    binary_purged: true,
  });
}

async function verifyCurrentFailureGeneration() {
  await enqueue("lease-fence-failure");
  const job = (await claimRuntimeJobs(pool, { workerId: "failure-worker", batchSize: 1, leaseSeconds: 60 }))[0];
  const outcome = await failRuntimeJob(pool, job, new Error("retryable provider failure"));
  assert.equal(outcome.terminal, false);
  const stored = await pool.query(
    "SELECT status, attempts, last_error, binary_payload IS NOT NULL AS has_binary FROM runtime.background_job WHERE job_id = $1",
    [job.job_id],
  );
  assert.deepEqual(stored.rows[0], {
    status: "failed",
    attempts: 1,
    last_error: "retryable provider failure",
    has_binary: true,
  });
}

Promise.resolve()
  .then(prepareMigratedSchema)
  .then(verifySameWorkerReclaimFence)
  .then(verifyExpiredLeaseStopsWithoutRedispatch)
  .then(verifyCurrentFailureGeneration)
  .then(() => console.log(JSON.stringify({
    status: "passed",
    contract: "meids.runtime-lease-fencing.v1",
    scenarios: [
      "same_worker_reclaim_increments_generation",
      "stale_completion_rejected",
      "stale_failure_rejected",
      "terminal_state_cannot_regress",
      "expired_processing_lease_stops_without_redispatch",
      "current_failure_generation_succeeds",
    ],
  }, null, 2)))
  .finally(() => pool.end())
  .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
