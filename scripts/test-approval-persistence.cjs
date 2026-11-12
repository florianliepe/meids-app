const test = require("node:test");
const assert = require("node:assert/strict");
const { reconcilePostgresApprovalDecision, runPostgresApprovalDecision } = require("../backend/approvalPersistence");

function fakePool({ failAction = false, commitErrorAfterApply = false } = {}) {
  const state = {
    status: "pending_human_approval",
    record: {
      approval_id: "approval-1",
      status: "pending_human_approval",
      timestamp: "2026-11-12T12:00:00.000Z",
      original_request: {
        principal: { tenant_id: "tenant-a", user_id: "user-a" },
        context: { active_twin_id: "twin-a" },
      },
    },
    writes: 0,
  };
  let transaction = null;
  const client = {
    async query(sql, params = []) {
      if (sql === "BEGIN") { transaction = structuredClone(state); return { rows: [] }; }
      if (sql === "ROLLBACK") { transaction = null; return { rows: [] }; }
      if (sql === "COMMIT") {
        Object.assign(state, transaction);
        transaction = null;
        if (commitErrorAfterApply) {
          commitErrorAfterApply = false;
          throw new Error("connection lost after commit");
        }
        return { rows: [] };
      }
      if (/set_config/.test(sql)) return { rows: [] };
      if (/SELECT status, record/.test(sql) && /FOR UPDATE NOWAIT/.test(sql)) {
        return { rows: [{ status: state.status, record: structuredClone(state.record) }] };
      }
      if (/status = \$2/.test(sql) && /pending_human_approval/.test(sql)) {
        if (transaction.status !== "pending_human_approval") return { rows: [] };
        transaction.status = params[1];
        transaction.record = { ...transaction.record, status: params[1] };
        return { rows: [{ record: structuredClone(transaction.record) }] };
      }
      if (/record = record \|\| \$3::jsonb/.test(sql)) {
        if (transaction.status !== params[3]) return { rows: [] };
        transaction.status = params[1];
        transaction.record = { ...transaction.record, ...JSON.parse(params[2]) };
        return { rows: [{ record: structuredClone(transaction.record) }] };
      }
      throw new Error(`Unexpected client query: ${sql}`);
    },
    on() {},
    off() {},
    release() {},
  };
  const pool = {
    async connect() { return client; },
    async query(sql, params = []) {
      if (/SELECT status, record/.test(sql)) return { rows: [{ status: state.status, record: structuredClone(state.record) }] };
      if (/last_failure_reason/.test(sql) && state.status === "pending_human_approval") {
        state.record.last_failure_reason = params[1];
        state.record.last_failure_rolled_back = true;
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
  };
  const execute = async () => {
    transaction.writes += 1;
    if (failAction) throw new Error("injected action failure");
    return { persisted: true };
  };
  return { pool, state, execute };
}

const mapping = { tenant_id: "tenant-a", user_id: "user-a", allowed_twin_ids: ["twin-a"], group_ids: [] };

test("approval action and terminal status commit atomically", async () => {
  const fixture = fakePool();
  const result = await runPostgresApprovalDecision(fixture.pool, {
    approvalId: "approval-1", mapping, decisionStatus: "resuming", terminalStatus: "resumed", execute: fixture.execute,
  });
  assert.equal(result.claimed, true);
  assert.equal(fixture.state.status, "resumed");
  assert.equal(fixture.state.writes, 1);
});

test("action failure rolls back both action and claim", async () => {
  const fixture = fakePool({ failAction: true });
  await assert.rejects(
    runPostgresApprovalDecision(fixture.pool, {
      approvalId: "approval-1", mapping, decisionStatus: "resuming", terminalStatus: "resumed", execute: fixture.execute,
    }),
    (error) => error.approvalTransactionRolledBack === true,
  );
  assert.equal(fixture.state.status, "pending_human_approval");
  assert.equal(fixture.state.writes, 0);
  assert.equal(fixture.state.record.last_failure_rolled_back, true);
});

test("a completed decision cannot execute a second time", async () => {
  const fixture = fakePool();
  await runPostgresApprovalDecision(fixture.pool, {
    approvalId: "approval-1", mapping, decisionStatus: "resuming", terminalStatus: "resumed", execute: fixture.execute,
  });
  const duplicate = await runPostgresApprovalDecision(fixture.pool, {
    approvalId: "approval-1", mapping, decisionStatus: "resuming", terminalStatus: "resumed", execute: fixture.execute,
  });
  assert.equal(duplicate.claimed, false);
  assert.equal(fixture.state.writes, 1);
});

test("lost commit acknowledgement is reconciled without replay", async () => {
  const fixture = fakePool({ commitErrorAfterApply: true });
  const result = await runPostgresApprovalDecision(fixture.pool, {
    approvalId: "approval-1", mapping, decisionStatus: "resuming", terminalStatus: "resumed", execute: fixture.execute,
  });
  assert.equal(result.commitConfirmedAfterError, true);
  assert.equal(fixture.state.status, "resumed");
  assert.equal(fixture.state.writes, 1);
});

test("read-only reconciliation returns current terminal state without invoking an action", async () => {
  const fixture = fakePool();
  await runPostgresApprovalDecision(fixture.pool, {
    approvalId: "approval-1", mapping, decisionStatus: "resuming", terminalStatus: "resumed", execute: fixture.execute,
  });
  const result = await reconcilePostgresApprovalDecision(fixture.pool, {
    approvalId: "approval-1", mapping, expectedTerminalStatus: "resumed",
  });
  assert.equal(result.state, "confirmed_terminal");
  assert.equal(fixture.state.writes, 1);
});
