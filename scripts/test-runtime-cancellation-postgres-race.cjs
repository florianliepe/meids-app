const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { cancelQueuedRuntimeJob } = require("../backend/runtimeJobs");

const connectionString = String(process.env.MEIDS_TEST_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MEIDS_TEST_DATABASE_URL is required for the PostgreSQL race test.");
const target = new URL(connectionString);
const databaseName = target.pathname.replace(/^\//, "");
const loopback = ["127.0.0.1", "localhost", "::1"].includes(target.hostname);
if (!loopback || !/(^|_)test$/.test(databaseName) || process.env.MEIDS_ALLOW_DESTRUCTIVE_TEST_DB !== "1") {
  throw new Error("Race test requires an explicitly enabled loopback database whose name ends in _test.");
}

const pool = new Pool({ connectionString, max: 4 });
const scope = { job_id: "race-job", tenant_id: "tenant-a", actor_user_id: "user-a", twin_id: "twin-a" };

async function reset() {
  await pool.query("CREATE SCHEMA IF NOT EXISTS runtime");
  await pool.query("DROP TABLE IF EXISTS runtime.background_job");
  await pool.query(`CREATE TABLE runtime.background_job (
    job_id text PRIMARY KEY,
    tenant_id text NOT NULL,
    actor_user_id text NOT NULL,
    twin_id text NOT NULL,
    status text NOT NULL,
    completed_at timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    leased_at timestamptz,
    lease_expires_at timestamptz,
    leased_by text,
    binary_payload bytea,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(
    `INSERT INTO runtime.background_job (job_id, tenant_id, actor_user_id, twin_id, status, binary_payload)
     VALUES ($1, $2, $3, $4, 'pending', decode('CAFE', 'hex'))`,
    [scope.job_id, scope.tenant_id, scope.actor_user_id, scope.twin_id],
  );
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
    await new Promise((resolve) => setTimeout(resolve, 75));
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

async function cancellationWins() {
  await reset();
  const canceller = await pool.connect();
  const claimant = await pool.connect();
  try {
    await canceller.query("BEGIN");
    const outcome = await cancelQueuedRuntimeJob(canceller, scope);
    assert.equal(outcome.cancelled, true);
    const claim = claimant.query(
      `UPDATE runtime.background_job SET status = 'processing', leased_by = 'worker-b', leased_at = now()
       WHERE job_id = $1 AND status = 'pending' RETURNING job_id`,
      [scope.job_id],
    );
    await new Promise((resolve) => setTimeout(resolve, 75));
    await canceller.query("COMMIT");
    const claimed = await claim;
    assert.equal(claimed.rowCount, 0);
    const stored = await pool.query("SELECT status, binary_payload IS NULL AS binary_purged FROM runtime.background_job WHERE job_id = $1", [scope.job_id]);
    assert.deepEqual(stored.rows[0], { status: "cancelled", binary_purged: true });
  } finally {
    await canceller.query("ROLLBACK").catch(() => {});
    canceller.release();
    claimant.release();
  }
}

Promise.resolve()
  .then(claimWins)
  .then(cancellationWins)
  .then(() => console.log(JSON.stringify({ status: "passed", scenarios: ["claim_wins", "cancellation_wins"] }, null, 2)))
  .finally(() => pool.end())
  .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
