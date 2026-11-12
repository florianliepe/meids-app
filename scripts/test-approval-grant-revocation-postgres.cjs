const assert = require("node:assert/strict");
const { Pool } = require("pg");
const {
  assertCurrentApprovalAuthorization,
  runPostgresApprovalDecision,
} = require("../backend/approvalPersistence");

const connectionString = String(process.env.MEIDS_TEST_DATABASE_URL || "").trim();
const runId = String(process.env.MEIDS_TEST_RUN_ID || "").trim();
if (!connectionString || !/^[a-f0-9]{8,32}$/.test(runId)) {
  throw new Error("MEIDS_TEST_DATABASE_URL and a hexadecimal MEIDS_TEST_RUN_ID are required.");
}
const target = new URL(connectionString);
const expectedDatabase = `meids_approval_grants_${runId}_test`;
if (!["127.0.0.1", "localhost", "::1"].includes(target.hostname)
  || target.pathname.replace(/^\//, "") !== expectedDatabase
  || process.env.MEIDS_ALLOW_DESTRUCTIVE_TEST_DB !== "1") {
  throw new Error("Approval grant test requires an explicitly enabled, run-owned loopback test database.");
}

const pool = new Pool({ connectionString, max: 6 });
const mapping = {
  tenant_id: "tenant-a",
  user_id: "user-a",
  active_twin_id: "twin-a",
  allowed_twin_ids: ["twin-a"],
  group_ids: [],
};

function approvalRecord(approvalId, timestamp) {
  return {
    approval_id: approvalId,
    status: "pending_human_approval",
    timestamp,
    original_request: {
      principal: { tenant_id: "tenant-a", user_id: "user-a" },
      context: { active_twin_id: "twin-a" },
    },
  };
}

async function prepare() {
  await pool.query("CREATE SCHEMA identity; CREATE SCHEMA twin");
  await pool.query(`CREATE TABLE identity.app_user (
    user_id text PRIMARY KEY, tenant_id text NOT NULL, status text NOT NULL
  )`);
  await pool.query(`CREATE TABLE twin.twin (
    twin_id text PRIMARY KEY, tenant_id text NOT NULL, status text NOT NULL
  )`);
  await pool.query(`CREATE TABLE twin.user_twin_access (
    tenant_id text NOT NULL, user_id text NOT NULL, twin_id text NOT NULL,
    access_role text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id, twin_id)
  )`);
  await pool.query(`CREATE TABLE agent_approval_queue (
    approval_id text PRIMARY KEY, status text NOT NULL, record jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE approval_effect (
    approval_id text PRIMARY KEY, effect text NOT NULL
  )`);
}

async function reset(approvalId, timestamp = new Date().toISOString()) {
  await pool.query(`TRUNCATE agent_approval_queue, approval_effect,
    twin.user_twin_access, twin.twin, identity.app_user`);
  await pool.query("INSERT INTO identity.app_user VALUES ('user-a', 'tenant-a', 'active')");
  await pool.query("INSERT INTO twin.twin VALUES ('twin-a', 'tenant-a', 'active')");
  await pool.query(`INSERT INTO twin.user_twin_access
    (tenant_id, user_id, twin_id, access_role, created_at)
    VALUES ('tenant-a', 'user-a', 'twin-a', 'owner', $1::timestamptz - interval '1 minute')`, [timestamp]);
  await pool.query(
    `INSERT INTO agent_approval_queue (approval_id, status, record)
     VALUES ($1, 'pending_human_approval', $2::jsonb)`,
    [approvalId, JSON.stringify(approvalRecord(approvalId, timestamp))],
  );
  return timestamp;
}

function gate() {
  let enter;
  let release;
  return {
    entered: new Promise((resolve) => { enter = resolve; }),
    released: new Promise((resolve) => { release = resolve; }),
    enter,
    release,
  };
}

async function waitForLockWait() {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query(`SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND state = 'active'`);
    if (waiting.rows.length) return waiting.rows.map(({ pid }) => pid);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Grant revocation did not reach the PostgreSQL lock barrier.");
}

function approve(approvalId, beforeAuthorization = null, afterAuthorization = null) {
  return runPostgresApprovalDecision(pool, {
    approvalId,
    mapping,
    decisionStatus: "resuming",
    terminalStatus: "resumed",
    execute: async (client, approval) => {
      if (beforeAuthorization) await beforeAuthorization();
      await assertCurrentApprovalAuthorization(client, mapping, approval);
      if (afterAuthorization) await afterAuthorization();
      await client.query("INSERT INTO approval_effect (approval_id, effect) VALUES ($1, 'governed-write')", [approvalId]);
      return { persisted: true };
    },
  });
}

async function assertPendingWithoutEffect(approvalId) {
  const state = await pool.query("SELECT status, record FROM agent_approval_queue WHERE approval_id = $1", [approvalId]);
  assert.equal(state.rows[0].status, "pending_human_approval");
  assert.equal(state.rows[0].record.last_failure_rolled_back, true);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM approval_effect")).rows[0].count, 0);
}

async function revokeWinsBeforeSecurityLinearization() {
  const approvalId = "grant-revoke-wins";
  await reset(approvalId);
  const barrier = gate();
  const decision = approve(approvalId, async () => {
    barrier.enter();
    await barrier.released;
  });
  await barrier.entered;
  await pool.query("DELETE FROM twin.user_twin_access WHERE tenant_id = 'tenant-a' AND user_id = 'user-a' AND twin_id = 'twin-a'");
  barrier.release();
  await assert.rejects(decision, (error) => error.code === "approval_authorization_revoked"
    && error.statusCode === 403 && error.noRetry === true && error.approvalTransactionRolledBack === true);
  await assertPendingWithoutEffect(approvalId);
}

async function actionWinsAtSecurityLinearizationThenRevocationApplies() {
  const approvalId = "grant-action-wins";
  await reset(approvalId);
  const barrier = gate();
  const decision = approve(approvalId, null, async () => {
    barrier.enter();
    await barrier.released;
  });
  await barrier.entered;
  const revocation = pool.query("DELETE FROM twin.user_twin_access WHERE tenant_id = 'tenant-a' AND user_id = 'user-a' AND twin_id = 'twin-a'");
  const waitingPids = await waitForLockWait();
  assert.equal(waitingPids.length, 1);
  barrier.release();
  const approved = await decision;
  await revocation;
  assert.equal(approved.claimed, true);
  assert.equal((await pool.query("SELECT status FROM agent_approval_queue WHERE approval_id = $1", [approvalId])).rows[0].status, "resumed");
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM approval_effect")).rows[0].count, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM twin.user_twin_access")).rows[0].count, 0);
}

async function revokeAndRegrantDoesNotReviveOldApproval() {
  const approvalId = "grant-aba";
  const approvedAt = await reset(approvalId);
  await pool.query("DELETE FROM twin.user_twin_access");
  await pool.query(`INSERT INTO twin.user_twin_access
    (tenant_id, user_id, twin_id, access_role, created_at)
    VALUES ('tenant-a', 'user-a', 'twin-a', 'owner', $1::timestamptz + interval '1 second')`, [approvedAt]);
  await assert.rejects(approve(approvalId), (error) => error.code === "approval_authorization_revoked"
    && error.noRetry === true && error.approvalTransactionRolledBack === true);
  await assertPendingWithoutEffect(approvalId);
}

async function disabledUserCannotConsumeApproval() {
  const approvalId = "grant-user-disabled";
  await reset(approvalId);
  await pool.query("UPDATE identity.app_user SET status = 'disabled' WHERE user_id = 'user-a'");
  await assert.rejects(approve(approvalId), (error) => error.code === "approval_authorization_revoked"
    && error.noRetry === true && error.approvalTransactionRolledBack === true);
  await assertPendingWithoutEffect(approvalId);
}

Promise.resolve()
  .then(prepare)
  .then(revokeWinsBeforeSecurityLinearization)
  .then(actionWinsAtSecurityLinearizationThenRevocationApplies)
  .then(revokeAndRegrantDoesNotReviveOldApproval)
  .then(disabledUserCannotConsumeApproval)
  .then(() => console.log(JSON.stringify({
    status: "passed",
    security_linearization: "FOR SHARE on active user, active twin, and pre-approval grant",
    scenarios: ["revoke_wins", "action_wins", "revoke_regrant_aba_blocked", "disabled_user_blocked"],
  }, null, 2)))
  .finally(() => pool.end())
  .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
