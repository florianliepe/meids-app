const { Pool } = require("pg");
const { runPostgresApprovalDecision } = require("../backend/approvalPersistence");

const connectionString = String(process.env.MEIDS_TEST_DATABASE_URL || "").trim();
const mode = String(process.env.MEIDS_APPROVAL_WORKER_MODE || "").trim();
if (!connectionString || !["pause_before_commit", "pause_after_commit"].includes(mode) || typeof process.send !== "function") {
  throw new Error("Approval process worker requires an IPC parent, test database, and supported mode.");
}

const pool = new Pool({ connectionString, max: 1 });
const mapping = { tenant_id: "tenant-a", user_id: "user-a", allowed_twin_ids: ["twin-a"], group_ids: [] };

async function hold() {
  await new Promise(() => {});
}

async function main() {
  const result = await runPostgresApprovalDecision(pool, {
    approvalId: "approval-1",
    mapping,
    decisionStatus: "resuming",
    terminalStatus: "resumed",
    execute: async (client) => {
      await client.query("INSERT INTO approval_effect (approval_id, decision) VALUES ('approval-1', 'approve')");
      if (mode === "pause_before_commit") {
        process.send({ event: "action_written" });
        await hold();
      }
      return { persisted: true };
    },
  });
  if (mode === "pause_after_commit") {
    process.send({ event: "committed", claimed: result.claimed });
    await hold();
  }
}

main().catch(async (error) => {
  process.send?.({ event: "failed", error: error.message });
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
