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

function approvalOwnerAndTwin(approval = {}) {
  const request = approval.original_request || {};
  return {
    tenantId: String(request.principal?.tenant_id || "").trim(),
    userId: String(request.principal?.user_id || "").trim(),
    twinId: String(request.context?.active_twin_id || request.metadata?.identity?.activeTwinId || "").trim(),
    approvedAt: String(approval.timestamp || "").trim(),
  };
}

async function assertCurrentApprovalAuthorization(client, mapping, approval) {
  const owner = approvalOwnerAndTwin(approval);
  if (!owner.tenantId || !owner.userId || !owner.twinId || !owner.approvedAt
    || owner.tenantId !== mapping.tenant_id || owner.userId !== mapping.user_id) {
    const error = new Error("Approval authorization binding is invalid.");
    error.statusCode = 403;
    error.code = "approval_authorization_revoked";
    error.noRetry = true;
    throw error;
  }
  const current = await client.query(
    `SELECT access.access_role, access.created_at
     FROM identity.app_user app_user
     JOIN twin.user_twin_access access
       ON access.tenant_id = app_user.tenant_id AND access.user_id = app_user.user_id
     JOIN twin.twin twin_row
       ON twin_row.tenant_id = access.tenant_id AND twin_row.twin_id = access.twin_id
     WHERE app_user.tenant_id = $1
       AND app_user.user_id = $2
       AND app_user.status = 'active'
       AND access.twin_id = $3
       AND twin_row.status = 'active'
       AND access.created_at <= $4::timestamptz
     FOR SHARE OF app_user, access, twin_row`,
    [owner.tenantId, owner.userId, owner.twinId, owner.approvedAt],
  );
  if (!current.rowCount) {
    const error = new Error("Approval authorization changed before execution.");
    error.statusCode = 403;
    error.code = "approval_authorization_revoked";
    error.noRetry = true;
    throw error;
  }
  return { ...owner, accessRole: current.rows[0].access_role, grantCreatedAt: current.rows[0].created_at };
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
  assertCurrentApprovalAuthorization,
  runPostgresApprovalDecision,
};
