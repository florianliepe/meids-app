const assert = require("node:assert/strict");
const path = require("node:path");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const { Pool } = require("pg");
const { runPostgresApprovalDecision } = require("../backend/approvalPersistence");

const connectionString = String(process.env.MEIDS_TEST_DATABASE_URL || "").trim();
const runId = String(process.env.MEIDS_TEST_RUN_ID || "").trim();
if (!connectionString || !/^[a-f0-9]{8,32}$/.test(runId)) {
  throw new Error("MEIDS_TEST_DATABASE_URL and a hexadecimal MEIDS_TEST_RUN_ID are required.");
}
const target = new URL(connectionString);
const expectedDatabase = `meids_approval_crash_${runId}_test`;
const loopback = ["127.0.0.1", "localhost", "::1"].includes(target.hostname);
if (!loopback || target.pathname.replace(/^\//, "") !== expectedDatabase || process.env.MEIDS_ALLOW_DESTRUCTIVE_TEST_DB !== "1") {
  throw new Error("Process-termination test requires an explicitly enabled, run-owned loopback test database.");
}

const pool = new Pool({ connectionString, max: 4 });
const workerPath = path.join(__dirname, "approval-process-worker.cjs");
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

function startWorker(mode) {
  return fork(workerPath, [], {
    env: { ...process.env, MEIDS_APPROVAL_WORKER_MODE: mode },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
}

function waitForMessage(child, event, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Worker did not reach ${event}.`)), timeoutMs);
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

async function killAndWait(child) {
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}

async function waitForState(expectedStatus, expectedEffects) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const approval = await pool.query("SELECT status FROM agent_approval_queue WHERE approval_id = 'approval-1'");
    const effects = await pool.query("SELECT count(*)::int AS count FROM approval_effect");
    if (approval.rows[0]?.status === expectedStatus && effects.rows[0].count === expectedEffects) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Database did not converge to ${expectedStatus}/${expectedEffects}.`);
}

async function completeOnce() {
  return runPostgresApprovalDecision(pool, {
    approvalId: "approval-1",
    mapping,
    decisionStatus: "resuming",
    terminalStatus: "resumed",
    execute: async (client) => {
      await client.query("INSERT INTO approval_effect (approval_id, decision) VALUES ('approval-1', 'approve')");
      return { persisted: true };
    },
  });
}

async function terminationBeforeCommitRollsBack() {
  await reset();
  const child = startWorker("pause_before_commit");
  await waitForMessage(child, "action_written");
  await killAndWait(child);
  await waitForState("pending_human_approval", 0);
  const retry = await completeOnce();
  assert.equal(retry.claimed, true);
  await waitForState("resumed", 1);
}

async function terminationAfterCommitDoesNotReplay() {
  await reset();
  const child = startWorker("pause_after_commit");
  const committed = await waitForMessage(child, "committed");
  assert.equal(committed.claimed, true);
  await killAndWait(child);
  await waitForState("resumed", 1);
  const replay = await completeOnce();
  assert.equal(replay.claimed, false);
  await waitForState("resumed", 1);
}

Promise.resolve()
  .then(prepare)
  .then(terminationBeforeCommitRollsBack)
  .then(terminationAfterCommitDoesNotReplay)
  .then(() => console.log(JSON.stringify({
    status: "passed",
    scenarios: ["process_killed_before_commit_rolls_back", "process_killed_after_commit_does_not_replay"],
  }, null, 2)))
  .finally(() => pool.end())
  .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
