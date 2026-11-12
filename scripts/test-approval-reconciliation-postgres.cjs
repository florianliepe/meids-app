const assert = require("node:assert/strict");
const path = require("node:path");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const { Pool } = require("pg");
const { startPostgresCommitResponseProxy } = require("./postgres-commit-response-proxy.cjs");
const {
  reconcilePostgresApprovalDecision,
  runPostgresApprovalDecision,
} = require("../backend/approvalPersistence");

const connectionString = String(process.env.MEIDS_TEST_DATABASE_URL || "").trim();
const runId = String(process.env.MEIDS_TEST_RUN_ID || "").trim();
if (!connectionString || !/^[a-f0-9]{8,32}$/.test(runId)) {
  throw new Error("MEIDS_TEST_DATABASE_URL and a hexadecimal MEIDS_TEST_RUN_ID are required.");
}
const target = new URL(connectionString);
const expectedDatabase = `meids_approval_reconcile_${runId}_test`;
const loopback = ["127.0.0.1", "localhost", "::1"].includes(target.hostname);
if (!loopback || target.pathname.replace(/^\//, "") !== expectedDatabase || process.env.MEIDS_ALLOW_DESTRUCTIVE_TEST_DB !== "1") {
  throw new Error("Approval reconciliation test requires an explicitly enabled, run-owned loopback test database.");
}

const pool = new Pool({ connectionString, max: 5 });
const workerPath = path.join(__dirname, "approval-reconciliation-worker.cjs");
const mapping = { tenant_id: "tenant-a", user_id: "user-a", allowed_twin_ids: ["twin-a"], group_ids: [] };

function record(approvalId) {
  return {
    approval_id: approvalId,
    status: "pending_human_approval",
    timestamp: "2026-11-12T12:00:00.000Z",
    original_request: {
      principal: { tenant_id: "tenant-a", user_id: "user-a" },
      context: { active_twin_id: "twin-a" },
    },
  };
}

async function prepare() {
  await pool.query(`CREATE TABLE agent_approval_queue (
    approval_id text PRIMARY KEY, status text NOT NULL, record jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE approval_effect (
    approval_id text PRIMARY KEY, effect text NOT NULL
  )`);
}

async function reset(approvalId) {
  await pool.query("TRUNCATE agent_approval_queue, approval_effect");
  await pool.query(
    "INSERT INTO agent_approval_queue (approval_id, status, record) VALUES ($1, 'pending_human_approval', $2::jsonb)",
    [approvalId, JSON.stringify(record(approvalId))],
  );
}

function waitForMessage(child, event, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Reconciler did not reach ${event}.`)), timeoutMs);
    const onMessage = (message) => {
      if (message?.event === "failed") {
        clearTimeout(timeout);
        reject(new Error(message.error));
      } else if (message?.event === event) {
        clearTimeout(timeout);
        child.off("message", onMessage);
        resolve(message);
      }
    };
    child.on("message", onMessage);
  });
}

function startReconciler(approvalId, mode = "once") {
  return fork(workerPath, [], {
    env: {
      ...process.env,
      MEIDS_APPROVAL_ID: approvalId,
      MEIDS_RECONCILIATION_WORKER_MODE: mode,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
}

async function killAndWait(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}

async function statementTimeoutRollsBackEverything() {
  const approvalId = "statement-timeout";
  await reset(approvalId);
  await assert.rejects(
    runPostgresApprovalDecision(pool, {
      approvalId,
      mapping,
      decisionStatus: "resuming",
      terminalStatus: "resumed",
      execute: async (client) => {
        await client.query("INSERT INTO approval_effect (approval_id, effect) VALUES ($1, 'written-before-timeout')", [approvalId]);
        await client.query("SET LOCAL lock_timeout = '2s'");
        await client.query("SET LOCAL statement_timeout = '100ms'");
        await client.query("SELECT pg_sleep(1)");
      },
    }),
    (error) => error.code === "57014" && error.approvalTransactionRolledBack === true,
  );
  const approval = await pool.query("SELECT status FROM agent_approval_queue WHERE approval_id = $1", [approvalId]);
  const effects = await pool.query("SELECT count(*)::int AS count FROM approval_effect");
  assert.equal(approval.rows[0].status, "pending_human_approval");
  assert.equal(effects.rows[0].count, 0);
  assert.equal((await pool.query("SELECT 1 AS reusable")).rows[0].reusable, 1);
}

async function inFlightAndInterruptedReconciliationNeverReplay() {
  const approvalId = "reconciliation-interruption";
  await reset(approvalId);
  let actionWritten;
  let releaseAction;
  const written = new Promise((resolve) => { actionWritten = resolve; });
  const release = new Promise((resolve) => { releaseAction = resolve; });
  const decision = runPostgresApprovalDecision(pool, {
    approvalId,
    mapping,
    decisionStatus: "resuming",
    terminalStatus: "resumed",
    execute: async (client) => {
      await client.query("INSERT INTO approval_effect (approval_id, effect) VALUES ($1, 'exactly-once')", [approvalId]);
      actionWritten();
      await release;
      return { persisted: true };
    },
  });
  await written;

  const early = startReconciler(approvalId);
  const earlyResult = await waitForMessage(early, "observed");
  assert.equal(earlyResult.result.state, "unknown_in_flight");
  if (early.exitCode === null) await once(early, "exit");

  releaseAction();
  const completed = await decision;
  assert.equal(completed.claimed, true);

  const interrupted = startReconciler(approvalId, "pause_after_read");
  const observed = await waitForMessage(interrupted, "observed");
  assert.equal(observed.result.state, "confirmed_terminal");
  await killAndWait(interrupted);

  const repeated = await reconcilePostgresApprovalDecision(pool, {
    approvalId,
    mapping,
    expectedTerminalStatus: "resumed",
  });
  assert.equal(repeated.state, "confirmed_terminal");
  const effects = await pool.query("SELECT count(*)::int AS count FROM approval_effect WHERE approval_id = $1", [approvalId]);
  assert.equal(effects.rows[0].count, 1);
}

async function foreignScopeIsNotVisible() {
  const result = await reconcilePostgresApprovalDecision(pool, {
    approvalId: "reconciliation-interruption",
    mapping: { ...mapping, user_id: "user-b" },
    expectedTerminalStatus: "resumed",
  });
  assert.equal(result.state, "not_found");
}

async function lostCommitResponseIsReconciledWithoutReplay() {
  const approvalId = "lost-commit-response";
  await reset(approvalId);
  const targetUrl = new URL(connectionString);
  const proxy = await startPostgresCommitResponseProxy({ hostname: targetUrl.hostname, port: targetUrl.port || 5432 });
  const proxyUrl = new URL(connectionString);
  proxyUrl.hostname = "127.0.0.1";
  proxyUrl.port = String(proxy.port);
  const proxyPool = new Pool({ connectionString: proxyUrl.toString(), max: 2 });
  proxyPool.on("error", () => {});
  try {
    const result = await runPostgresApprovalDecision(proxyPool, {
      approvalId,
      mapping,
      decisionStatus: "resuming",
      terminalStatus: "resumed",
      execute: async (client) => {
        await client.query("INSERT INTO approval_effect (approval_id, effect) VALUES ($1, 'commit-response-lost')", [approvalId]);
        return { persisted: true };
      },
    });
    assert.equal(proxy.state.commitIntercepted, true);
    assert.equal(proxy.state.commitReadyObserved, true);
    assert.equal(result.commitConfirmedAfterError, true);
    const approval = await pool.query("SELECT status FROM agent_approval_queue WHERE approval_id = $1", [approvalId]);
    const effects = await pool.query("SELECT count(*)::int AS count FROM approval_effect WHERE approval_id = $1", [approvalId]);
    assert.equal(approval.rows[0].status, "resumed");
    assert.equal(effects.rows[0].count, 1);
  } finally {
    await proxyPool.end().catch(() => {});
    await proxy.close();
  }
}

async function preReadKillAndStaleDualReconcilerStayReadOnly() {
  const approvalId = "reconciler-ordering";
  await reset(approvalId);

  const beforeRead = startReconciler(approvalId, "pause_before_read");
  await waitForMessage(beforeRead, "ready_before_read");
  await killAndWait(beforeRead);

  const stale = startReconciler(approvalId, "pause_after_read");
  const staleObservation = await waitForMessage(stale, "observed");
  assert.equal(staleObservation.result.state, "confirmed_pending");

  const decision = await runPostgresApprovalDecision(pool, {
    approvalId,
    mapping,
    decisionStatus: "resuming",
    terminalStatus: "resumed",
    execute: async (client) => {
      await client.query("INSERT INTO approval_effect (approval_id, effect) VALUES ($1, 'after-stale-read')", [approvalId]);
      return { persisted: true };
    },
  });
  assert.equal(decision.claimed, true);
  const fresh = await reconcilePostgresApprovalDecision(pool, {
    approvalId,
    mapping,
    expectedTerminalStatus: "resumed",
  });
  assert.equal(fresh.state, "confirmed_terminal");
  await killAndWait(stale);

  const approval = await pool.query("SELECT status FROM agent_approval_queue WHERE approval_id = $1", [approvalId]);
  const effects = await pool.query("SELECT count(*)::int AS count FROM approval_effect WHERE approval_id = $1", [approvalId]);
  assert.equal(approval.rows[0].status, "resumed");
  assert.equal(effects.rows[0].count, 1);
}

async function main() {
  try {
    await prepare();
    await statementTimeoutRollsBackEverything();
    await inFlightAndInterruptedReconciliationNeverReplay();
    await foreignScopeIsNotVisible();
    await lostCommitResponseIsReconciledWithoutReplay();
    await preReadKillAndStaleDualReconcilerStayReadOnly();
    process.stdout.write(`${JSON.stringify({
      status: "passed",
      statement_timeout: "full_rollback_and_pool_reuse",
      in_flight_reconciliation: "unknown_without_replay",
      interrupted_reconciliation: "repeatable_read_only_terminal_result",
      foreign_scope: "not_found",
      lost_commit_response: "terminal_commit_reconciled_once",
      pre_read_kill: "no_state_change",
      stale_dual_reconciler: "terminal_state_not_regressed",
    }, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
