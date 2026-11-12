const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { cancelQueuedRuntimeJob, claimRuntimeJobs } = require("../backend/runtimeJobs");

const connectionString = String(process.env.MEIDS_TEST_DATABASE_URL || "").trim();
const runId = String(process.env.MEIDS_TEST_RUN_ID || "").trim();
if (!connectionString || !/^[a-f0-9]{8,32}$/.test(runId)) {
  throw new Error("MEIDS_TEST_DATABASE_URL and a hexadecimal MEIDS_TEST_RUN_ID are required.");
}
const target = new URL(connectionString);
const databaseName = target.pathname.replace(/^\//, "");
const expectedDatabase = `meids_runtime_race_${runId}_test`;
const loopback = ["127.0.0.1", "localhost", "::1"].includes(target.hostname);
if (!loopback || databaseName !== expectedDatabase || process.env.MEIDS_ALLOW_DESTRUCTIVE_TEST_DB !== "1") {
  throw new Error("Race test requires an explicitly enabled, run-owned loopback test database.");
}

const root = path.resolve(__dirname, "..");
const pool = new Pool({ connectionString, max: 6 });
const scope = { job_id: "race-job", tenant_id: "tenant-a", actor_user_id: "user-a", twin_id: "twin-a" };

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
    tenant_id text NOT NULL, actor_user_id text NOT NULL, resource_id text, resource_type text NOT NULL,
    action text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb
  )`);
  for (const migration of [
    "012_audit_runtime_read_policy.sql",
    "017_runtime_background_jobs.sql",
    "019_audit_background_work_update_policy.sql",
    "020_runtime_background_job_cancellation.sql",
  ]) {
    await pool.query(fs.readFileSync(path.join(root, "backend", "migrations", migration), "utf8"));
  }
  await pool.query("GRANT USAGE ON SCHEMA runtime, audit, app_security TO meids_app_runtime");
  await pool.query("GRANT EXECUTE ON FUNCTION app_security.setting(text), app_security.setting_list(text) TO meids_app_runtime");
  const constraint = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
     WHERE conrelid = 'runtime.background_job'::regclass AND conname = 'background_job_status_check'`,
  );
  assert.match(constraint.rows[0].definition, /cancelled/);
  const policy = await pool.query(
    `SELECT with_check FROM pg_policies WHERE schemaname = 'audit'
     AND tablename = 'event' AND policyname = 'audit_event_background_work_update_own'`,
  );
  assert.match(policy.rows[0].with_check, /agent\.work\.cancelled/);
}

async function verifyEffectiveAuditRls() {
  await pool.query("TRUNCATE audit.event");
  await pool.query(
    `INSERT INTO audit.event (tenant_id, actor_user_id, resource_type, action, details) VALUES
      ('tenant-a', 'user-a', 'agent.background_work', 'agent.work.queued', '{}'),
      ('tenant-a', 'user-b', 'agent.background_work', 'agent.work.queued', '{}'),
      ('tenant-b', 'user-a', 'agent.background_work', 'agent.work.queued', '{}')`,
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', 'tenant-a', true), set_config('app.user_id', 'user-a', true)");
    await client.query("SET LOCAL ROLE meids_app_runtime");
    const own = await client.query(
      "UPDATE audit.event SET action = 'agent.work.cancelled' WHERE actor_user_id = 'user-a' AND tenant_id = 'tenant-a'",
    );
    assert.equal(own.rowCount, 1);
    const foreignOwner = await client.query(
      "UPDATE audit.event SET action = 'agent.work.cancelled' WHERE actor_user_id = 'user-b' AND tenant_id = 'tenant-a'",
    );
    assert.equal(foreignOwner.rowCount, 0);
    const foreignTenant = await client.query(
      "UPDATE audit.event SET action = 'agent.work.cancelled' WHERE actor_user_id = 'user-a' AND tenant_id = 'tenant-b'",
    );
    assert.equal(foreignTenant.rowCount, 0);
    await client.query("SAVEPOINT invalid_action");
    await assert.rejects(
      () => client.query("UPDATE audit.event SET action = 'agent.work.deleted' WHERE actor_user_id = 'user-a' AND tenant_id = 'tenant-a'"),
      (error) => error.code === "42501",
    );
    await client.query("ROLLBACK TO SAVEPOINT invalid_action");
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}

async function reset() {
  await pool.query("TRUNCATE runtime.background_job");
  await pool.query(
    `INSERT INTO runtime.background_job (
       job_id, tenant_id, actor_user_id, twin_id, job_type, idempotency_key, payload, binary_payload
     ) VALUES ($1, $2, $3, $4, 'agent_work', $5, '{}'::jsonb, decode('CAFE', 'hex'))`,
    [scope.job_id, scope.tenant_id, scope.actor_user_id, scope.twin_id, `${scope.job_id}-${Date.now()}`],
  );
}

async function waitForLock(processId) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = await pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [processId]);
    if (state.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Cancellation did not reach the observed PostgreSQL lock barrier.");
}

async function claimWins() {
  await reset();
  const claimant = await pool.connect();
  const canceller = await pool.connect();
  try {
    await claimant.query("BEGIN");
    await claimant.query(
      `UPDATE runtime.background_job SET status = 'processing', leased_by = 'worker-a', leased_at = now()
       WHERE job_id = $1 AND status = 'pending'`,
      [scope.job_id],
    );
    const cancellation = cancelQueuedRuntimeJob(canceller, scope);
    await waitForLock(canceller.processID);
    await claimant.query("COMMIT");
    const outcome = await cancellation;
    assert.equal(outcome.cancelled, false);
    assert.equal(outcome.status, "processing");
    const stored = await pool.query("SELECT status, binary_payload IS NOT NULL AS has_binary FROM runtime.background_job WHERE job_id = $1", [scope.job_id]);
    assert.deepEqual(stored.rows[0], { status: "processing", has_binary: true });
  } finally {
    await claimant.query("ROLLBACK").catch(() => {});
    claimant.release();
    canceller.release();
  }
}

async function cancellationWinsAgainstRealClaim() {
  await reset();
  const canceller = await pool.connect();
  try {
    await canceller.query("BEGIN");
    const outcome = await cancelQueuedRuntimeJob(canceller, scope);
    assert.equal(outcome.cancelled, true);
    const claimed = await claimRuntimeJobs(pool, { workerId: "worker-b", batchSize: 1, leaseSeconds: 60 });
    assert.equal(claimed.length, 0);
    await canceller.query("COMMIT");
    const stored = await pool.query("SELECT status, binary_payload IS NULL AS binary_purged FROM runtime.background_job WHERE job_id = $1", [scope.job_id]);
    assert.deepEqual(stored.rows[0], { status: "cancelled", binary_purged: true });
  } finally {
    await canceller.query("ROLLBACK").catch(() => {});
    canceller.release();
  }
}

async function verifyScopeAndRollback() {
  await reset();
  const client = await pool.connect();
  try {
    const foreign = await cancelQueuedRuntimeJob(client, { ...scope, actor_user_id: "user-b" });
    assert.equal(foreign, null);
    await client.query("BEGIN");
    const cancelled = await cancelQueuedRuntimeJob(client, scope);
    assert.equal(cancelled.cancelled, true);
    await client.query("ROLLBACK");
    const stored = await pool.query(
      "SELECT status, binary_payload IS NOT NULL AS has_binary FROM runtime.background_job WHERE job_id = $1",
      [scope.job_id],
    );
    assert.deepEqual(stored.rows[0], { status: "pending", has_binary: true });
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

Promise.resolve()
  .then(prepareMigratedSchema)
  .then(verifyEffectiveAuditRls)
  .then(claimWins)
  .then(cancellationWinsAgainstRealClaim)
  .then(verifyScopeAndRollback)
  .then(() => console.log(JSON.stringify({
    status: "passed",
    schema: "migrations_012_017_019_020",
    scenarios: [
      "effective_owner_tenant_rls",
      "claim_wins_observed_lock",
      "cancellation_wins_real_claim",
      "foreign_scope_hidden",
      "transaction_rollback_restores_job",
    ],
  }, null, 2)))
  .finally(() => pool.end())
  .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
