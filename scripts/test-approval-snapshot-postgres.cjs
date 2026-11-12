const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { runPostgresApprovalDecision } = require("../backend/approvalPersistence");

const connectionString = String(process.env.MEIDS_TEST_DATABASE_URL || "").trim();
const runId = String(process.env.MEIDS_TEST_RUN_ID || "").trim();
if (!connectionString || !/^[a-f0-9]{8,32}$/.test(runId)) {
  throw new Error("MEIDS_TEST_DATABASE_URL and a hexadecimal MEIDS_TEST_RUN_ID are required.");
}
const target = new URL(connectionString);
const expectedDatabase = `meids_approval_snapshot_${runId}_test`;
const loopback = ["127.0.0.1", "localhost", "::1"].includes(target.hostname);
if (!loopback || target.pathname.replace(/^\//, "") !== expectedDatabase || process.env.MEIDS_ALLOW_DESTRUCTIVE_TEST_DB !== "1") {
  throw new Error("Approval snapshot test requires an explicitly enabled, run-owned loopback test database.");
}

const pool = new Pool({ connectionString, max: 5 });
const mapping = {
  tenant_id: "tenant-a",
  user_id: "user-a",
  allowed_twin_ids: ["twin-a"],
  group_ids: [],
};

function approvalRecord(approvalId) {
  return {
    approval_id: approvalId,
    trace_id: `trace-${approvalId}`,
    trace_chain_id: `chain-${approvalId}`,
    request_id: `request-${approvalId}`,
    agent_id: "actor_twin",
    target_agent: "knowledge_fabric_agent",
    status: "pending_human_approval",
    timestamp: "2026-11-12T12:00:00.000Z",
    expires_at: "2026-11-13T12:00:00.000Z",
    operation_sha256: "approved-operation-hash",
    original_request: {
      principal: { tenant_id: "tenant-a", user_id: "user-a" },
      context: { active_twin_id: "twin-a" },
      input: { message: "Approved knowledge" },
    },
    original_response: { output: { route_decision: { route: "ingest_or_stage_knowledge" } } },
  };
}

async function prepare() {
  await pool.query(`CREATE TABLE agent_approval_queue (
    approval_id text PRIMARY KEY,
    trace_id text,
    trace_chain_id text,
    request_id text,
    agent_id text,
    target_agent text,
    status text,
    record jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  const migration = fs.readFileSync(path.join(__dirname, "..", "backend", "migrations", "021_approval_operation_snapshot_immutability.sql"), "utf8");
  await pool.query(migration);
}

async function insertApproval(approvalId) {
  const record = approvalRecord(approvalId);
  await pool.query(
    `INSERT INTO agent_approval_queue
      (approval_id, trace_id, trace_chain_id, request_id, agent_id, target_agent, status, record)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [approvalId, record.trace_id, record.trace_chain_id, record.request_id, record.agent_id,
      record.target_agent, record.status, JSON.stringify(record)],
  );
}

async function waitForBlockedPid(pid) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      "SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock' AND state = 'active'",
      [pid],
    );
    if (result.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Snapshot mutation did not wait on the claimed Approval row.");
}

async function mutationBeforeClaimIsRejected() {
  const approvalId = "snapshot-before-claim";
  await insertApproval(approvalId);
  await assert.rejects(
    pool.query(
      `UPDATE agent_approval_queue
       SET record = jsonb_set(jsonb_set(record, '{original_request,input,message}', '"Changed operation"'::jsonb),
                              '{operation_sha256}', '"changed-hash"'::jsonb)
       WHERE approval_id = $1`,
      [approvalId],
    ),
    (error) => error.code === "23514" && error.message.includes("operation snapshot is immutable"),
  );
  const state = await pool.query("SELECT status, record FROM agent_approval_queue WHERE approval_id = $1", [approvalId]);
  assert.equal(state.rows[0].status, "pending_human_approval");
  assert.equal(state.rows[0].record.original_request.input.message, "Approved knowledge");
  assert.equal(state.rows[0].record.operation_sha256, "approved-operation-hash");
}

async function mutationDuringClaimWaitsThenFails() {
  const approvalId = "snapshot-during-claim";
  await insertApproval(approvalId);
  let releaseAction;
  let claimedAction;
  const actionClaimed = new Promise((resolve) => { claimedAction = resolve; });
  const actionRelease = new Promise((resolve) => { releaseAction = resolve; });
  const decision = runPostgresApprovalDecision(pool, {
    approvalId,
    mapping,
    decisionStatus: "resuming",
    terminalStatus: "resumed",
    terminalPatch: { resumed_at: "2026-11-12T12:01:00.000Z", runtime: "azure_native" },
    execute: async () => {
      claimedAction();
      await actionRelease;
      return { persisted: true };
    },
  });
  await actionClaimed;

  const mutator = await pool.connect();
  const pid = (await mutator.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const mutation = mutator.query(
    `UPDATE agent_approval_queue
     SET record = jsonb_set(record, '{original_request,input,message}', '"Changed while running"'::jsonb)
     WHERE approval_id = $1`,
    [approvalId],
  );
  await waitForBlockedPid(pid);
  releaseAction();
  const result = await decision;
  assert.equal(result.claimed, true);
  await assert.rejects(mutation, (error) => error.code === "23514");
  mutator.release();

  const state = await pool.query("SELECT status, record FROM agent_approval_queue WHERE approval_id = $1", [approvalId]);
  assert.equal(state.rows[0].status, "resumed");
  assert.equal(state.rows[0].record.original_request.input.message, "Approved knowledge");
  assert.deepEqual(state.rows[0].record.action_result, { persisted: true });
}

async function lifecycleMetadataRemainsMutable() {
  const approvalId = "snapshot-lifecycle-metadata";
  await insertApproval(approvalId);
  await pool.query(
    `UPDATE agent_approval_queue
     SET status = 'blocked',
         record = record || $2::jsonb,
         updated_at = now()
     WHERE approval_id = $1`,
    [approvalId, JSON.stringify({ status: "blocked", blocked_reason: "bounded_test" })],
  );
  const state = await pool.query("SELECT status, record FROM agent_approval_queue WHERE approval_id = $1", [approvalId]);
  assert.equal(state.rows[0].status, "blocked");
  assert.equal(state.rows[0].record.blocked_reason, "bounded_test");
  assert.equal(state.rows[0].record.original_request.input.message, "Approved knowledge");
}

async function main() {
  try {
    await prepare();
    await mutationBeforeClaimIsRejected();
    await mutationDuringClaimWaitsThenFails();
    await lifecycleMetadataRemainsMutable();
    process.stdout.write(`${JSON.stringify({
      status: "passed",
      snapshot_guard: "database_trigger",
      before_claim_mutation: "rejected",
      during_claim_mutation: "waited_then_rejected",
      lifecycle_metadata: "mutable",
    }, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
