const { Pool } = require("pg");
const { reconcilePostgresApprovalDecision } = require("../backend/approvalPersistence");

const connectionString = String(process.env.MEIDS_TEST_DATABASE_URL || "").trim();
const approvalId = String(process.env.MEIDS_APPROVAL_ID || "").trim();
const mode = String(process.env.MEIDS_RECONCILIATION_WORKER_MODE || "once").trim();
if (!connectionString || !approvalId || !["once", "pause_after_read"].includes(mode) || typeof process.send !== "function") {
  throw new Error("Approval reconciliation worker requires an IPC parent, test database, Approval ID and supported mode.");
}

const pool = new Pool({ connectionString, max: 1 });
const mapping = { tenant_id: "tenant-a", user_id: "user-a", allowed_twin_ids: ["twin-a"], group_ids: [] };

async function main() {
  const result = await reconcilePostgresApprovalDecision(pool, {
    approvalId,
    mapping,
    expectedTerminalStatus: "resumed",
  });
  process.send({ event: "observed", result });
  if (mode === "pause_after_read") await new Promise(() => {});
  await pool.end();
}

main().catch(async (error) => {
  process.send?.({ event: "failed", error: error.message });
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
