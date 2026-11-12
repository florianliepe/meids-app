const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { runPostgresApprovalDecision } = require("../backend/approvalPersistence");

const connectionString = String(process.env.MEIDS_TEST_DATABASE_URL || "").trim();
const runId = String(process.env.MEIDS_TEST_RUN_ID || "").trim();
if (!connectionString || !/^[a-f0-9]{8,32}$/.test(runId)) {
  throw new Error("MEIDS_TEST_DATABASE_URL and a hexadecimal MEIDS_TEST_RUN_ID are required.");
}
const target = new URL(connectionString);
const expectedDatabase = `meids_approval_race_${runId}_test`;
const loopback = ["127.0.0.1", "localhost", "::1"].includes(target.hostname);
if (!loopback || target.pathname.replace(/^\//, "") !== expectedDatabase || process.env.MEIDS_ALLOW_DESTRUCTIVE_TEST_DB !== "1") {
  throw new Error("Approval race test requires an explicitly enabled, run-owned loopback test database.");
}

const pool = new Pool({ connectionString, max: 8 });
const mapping = { tenant_id: "tenant-a", user_id: "user-a", allowed_twin_ids: ["twin-a"], group_ids: [] };

async function prepare() {
  await pool.query(`CREATE TABLE agent_approval_queue (
    approval_id text PRIMARY KEY, status text NOT NULL, record jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE approval_effect (
    approval_id text PRIMARY KEY, decision text NOT NULL
  )`);
}

async function reset() {
  await pool.query("TRUNCATE agent_approval_queue, approval_effect");
  await pool.query(
    "INSERT INTO agent_approval_queue (approval_id, status, record) VALUES ('approval-1', 'pending_human_approval', $1::jsonb)",
    [JSON.stringify({ approval_id: "approval-1", status: "pending_human_approval" })],
  );
}

function barrier() {
  let enter;
  let release;
  return {
    entered: new Promise((resolve) => { enter = resolve; }),
    released: new Promise((resolve) => { release = resolve; }),
    enter,
    release,
  };
}

async function waitForBlockedDecision() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT count(*)::int AS count FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (result.rows[0].count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Competing approval decision did not reach the PostgreSQL lock barrier.");
}

async function approveWins() {
  await reset();
  const gate = barrier();
  const approve = runPostgresApprovalDecision(pool, {
    approvalId: "approval-1",
    mapping,
    decisionStatus: "resuming",
    terminalStatus: "resumed",
    execute: async (client) => {
      await client.query("INSERT INTO approval_effect (approval_id, decision) VALUES ('approval-1', 'approve')");
      gate.enter();
      await gate.released;
      return { persisted: true };
    },
  });
  await gate.entered;
  const reject = runPostgresApprovalDecision(pool, {
    approvalId: "approval-1", mapping, decisionStatus: "rejecting", terminalStatus: "rejected",
  });
  await waitForBlockedDecision();
  gate.release();
  const [approved, rejected] = await Promise.all([approve, reject]);
  assert.equal(approved.claimed, true);
  assert.equal(rejected.claimed, false);
  const stored = await pool.query("SELECT status FROM agent_approval_queue WHERE approval_id = 'approval-1'");
  const effects = await pool.query("SELECT decision FROM approval_effect");
  assert.equal(stored.rows[0].status, "resumed");
  assert.deepEqual(effects.rows, [{ decision: "approve" }]);
}

async function rejectWins() {
  await reset();
  const gate = barrier();
  const reject = runPostgresApprovalDecision(pool, {
    approvalId: "approval-1",
    mapping,
    decisionStatus: "rejecting",
    terminalStatus: "rejected",
    execute: async () => { gate.enter(); await gate.released; return null; },
  });
  await gate.entered;
  const approve = runPostgresApprovalDecision(pool, {
    approvalId: "approval-1",
    mapping,
    decisionStatus: "resuming",
    terminalStatus: "resumed",
    execute: async (client) => {
      await client.query("INSERT INTO approval_effect (approval_id, decision) VALUES ('approval-1', 'approve')");
      return { persisted: true };
    },
  });
  await waitForBlockedDecision();
  gate.release();
  const [rejected, approved] = await Promise.all([reject, approve]);
  assert.equal(rejected.claimed, true);
  assert.equal(approved.claimed, false);
  const stored = await pool.query("SELECT status FROM agent_approval_queue WHERE approval_id = 'approval-1'");
  const effects = await pool.query("SELECT count(*)::int AS count FROM approval_effect");
  assert.equal(stored.rows[0].status, "rejected");
  assert.equal(effects.rows[0].count, 0);
}

async function actionRollbackIsRetryable() {
  await reset();
  await assert.rejects(runPostgresApprovalDecision(pool, {
    approvalId: "approval-1",
    mapping,
    decisionStatus: "resuming",
    terminalStatus: "resumed",
    execute: async (client) => {
      await client.query("INSERT INTO approval_effect (approval_id, decision) VALUES ('approval-1', 'approve')");
      throw new Error("injected persistence failure");
    },
  }), (error) => error.approvalTransactionRolledBack === true);
  const stored = await pool.query("SELECT status, record FROM agent_approval_queue WHERE approval_id = 'approval-1'");
  const effects = await pool.query("SELECT count(*)::int AS count FROM approval_effect");
  assert.equal(stored.rows[0].status, "pending_human_approval");
  assert.equal(stored.rows[0].record.last_failure_rolled_back, true);
  assert.equal(effects.rows[0].count, 0);
}

Promise.resolve()
  .then(prepare)
  .then(approveWins)
  .then(rejectWins)
  .then(actionRollbackIsRetryable)
  .then(() => console.log(JSON.stringify({
    status: "passed",
    scenarios: ["approve_wins", "reject_wins", "action_rollback_restores_pending"],
  }, null, 2)))
  .finally(() => pool.end())
  .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
