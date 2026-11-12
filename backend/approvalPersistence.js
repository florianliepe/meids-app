function failureText(error) {
  return String(error?.message || "Approval action failed.").slice(0, 1_000);
}

async function setRequestContext(client, mapping) {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [mapping.tenant_id]);
  await client.query("SELECT set_config('app.user_id', $1, true)", [mapping.user_id]);
  await client.query("SELECT set_config('app.allowed_twin_ids', $1, true)", [(mapping.allowed_twin_ids || []).join(",")]);
  await client.query("SELECT set_config('app.group_ids', $1, true)", [(mapping.group_ids || []).join(",")]);
}

async function approvalState(pool, approvalId) {
  const result = await pool.query(
    "SELECT status, record FROM agent_approval_queue WHERE approval_id = $1",
    [approvalId],
  );
  return result.rows[0] || null;
}

async function recordRolledBackFailure(pool, approvalId, error) {
  await pool.query(
    `UPDATE agent_approval_queue
     SET record = record || jsonb_build_object(
       'last_failure_reason', $2::text,
       'last_failure_at', now()::text,
       'last_failure_rolled_back', true
     ),
     updated_at = now()
     WHERE approval_id = $1 AND status = 'pending_human_approval'`,
    [approvalId, failureText(error)],
  );
}

async function runPostgresApprovalDecision(pool, options) {
  const {
    approvalId,
    mapping,
    decisionStatus,
    terminalStatus,
    execute,
    terminalPatch = {},
  } = options;
  const client = await pool.connect();
  let commitAttempted = false;
  try {
    await client.query("BEGIN");
    await setRequestContext(client, mapping);
    const claimed = await client.query(
      `UPDATE agent_approval_queue
       SET status = $2,
           record = record || jsonb_build_object('status', $2::text, 'decision_started_at', now()::text),
           updated_at = now()
       WHERE approval_id = $1 AND status = 'pending_human_approval'
       RETURNING record`,
      [approvalId, decisionStatus],
    );
    const approval = claimed.rows[0]?.record;
    if (!approval) {
      await client.query("ROLLBACK");
      return { claimed: false };
    }
    const actionResult = execute ? await execute(client, approval) : null;
    const patch = {
      ...terminalPatch,
      status: terminalStatus,
      action_result: actionResult,
      decision_completed_at: new Date().toISOString(),
    };
    const completed = await client.query(
      `UPDATE agent_approval_queue
       SET status = $2,
           record = record || $3::jsonb,
           updated_at = now()
       WHERE approval_id = $1 AND status = $4
       RETURNING record`,
      [approvalId, terminalStatus, JSON.stringify(patch), decisionStatus],
    );
    if (!completed.rows[0]) throw new Error("Approval decision state changed before completion.");
    commitAttempted = true;
    await client.query("COMMIT");
    return { claimed: true, approval: completed.rows[0].record, actionResult };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    const state = await approvalState(pool, approvalId).catch(() => null);
    if (commitAttempted && state?.status === terminalStatus) {
      return { claimed: true, approval: state.record, actionResult: state.record?.action_result, commitConfirmedAfterError: true };
    }
    if (state?.status === "pending_human_approval") {
      await recordRolledBackFailure(pool, approvalId, error).catch(() => {});
      error.approvalTransactionRolledBack = true;
    } else {
      error.approvalCompletionUnknown = true;
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  runPostgresApprovalDecision,
};
