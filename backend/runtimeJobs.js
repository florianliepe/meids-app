const crypto = require("node:crypto");

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LEASE_SECONDS = 420;

function clean(value, max = 4_000) {
  return String(value || "").trim().slice(0, max);
}

function workerId() {
  return clean(`${process.env.WEBSITE_INSTANCE_ID || "local"}:${process.pid}`, 256);
}

async function enqueueRuntimeJob(client, job) {
  const jobId = clean(job.job_id || crypto.randomUUID(), 128);
  const idempotencyKey = clean(job.idempotency_key || jobId, 256);
  const result = await client.query(
    `INSERT INTO runtime.background_job (
       job_id, tenant_id, actor_user_id, twin_id, job_type, idempotency_key,
       payload, binary_payload, max_attempts
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
     ON CONFLICT (idempotency_key) DO UPDATE
       SET idempotency_key = EXCLUDED.idempotency_key
     RETURNING job_id, status, created_at`,
    [
      jobId,
      clean(job.tenant_id, 256),
      clean(job.actor_user_id, 256),
      clean(job.twin_id, 128),
      clean(job.job_type, 100),
      idempotencyKey,
      JSON.stringify(job.payload || {}),
      job.binary_payload || null,
      Math.max(1, Math.min(Number(job.max_attempts || DEFAULT_MAX_ATTEMPTS), 12)),
    ],
  );
  return result.rows[0];
}

async function claimRuntimeJobs(pool, options = {}) {
  const batchSize = Math.max(1, Math.min(Number(options.batchSize || process.env.MEIDS_RUNTIME_JOB_BATCH_SIZE || 4), 25));
  const leaseSeconds = Math.max(60, Math.min(Number(options.leaseSeconds || process.env.MEIDS_RUNTIME_JOB_LEASE_SECONDS || DEFAULT_LEASE_SECONDS), 1_800));
  const claimedBy = clean(options.workerId || workerId(), 256);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `WITH candidates AS (
         SELECT job_id
         FROM runtime.background_job
         WHERE (
           (status IN ('pending', 'failed') AND next_attempt_at <= now())
           OR (status = 'processing' AND lease_expires_at < now())
         )
           AND attempts < max_attempts
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE runtime.background_job job
       SET status = 'processing',
           attempts = attempts + 1,
           started_at = COALESCE(started_at, now()),
           leased_at = now(),
           lease_expires_at = now() + ($2::text || ' seconds')::interval,
           leased_by = $3,
           updated_at = now()
       FROM candidates
       WHERE job.job_id = candidates.job_id
       RETURNING job.*`,
      [batchSize, leaseSeconds, claimedBy],
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function completeRuntimeJob(pool, job, result) {
  const update = await pool.query(
    `UPDATE runtime.background_job
     SET status = 'completed', result = $2::jsonb, last_error = NULL,
         completed_at = now(), leased_at = NULL, lease_expires_at = NULL,
         leased_by = NULL, binary_payload = NULL, updated_at = now()
     WHERE job_id = $1 AND status = 'processing' AND leased_by = $3`,
    [job.job_id, JSON.stringify(result || {}), job.leased_by],
  );
  if (update.rowCount !== 1) throw new Error(`Runtime job completion lease was lost for ${job.job_id}.`);
}

async function failRuntimeJob(pool, job, error) {
  const terminal = Number(job.attempts) >= Number(job.max_attempts);
  const delaySeconds = Math.min(900, 15 * (2 ** Math.max(0, Number(job.attempts) - 1)));
  const update = await pool.query(
    `UPDATE runtime.background_job
     SET status = $2,
         last_error = $3,
         next_attempt_at = CASE WHEN $2 = 'failed'
           THEN now() + ($4::text || ' seconds')::interval ELSE next_attempt_at END,
         completed_at = CASE WHEN $2 = 'dead_letter' THEN now() ELSE completed_at END,
         leased_at = NULL, lease_expires_at = NULL, leased_by = NULL,
         binary_payload = CASE WHEN $2 = 'dead_letter' THEN NULL ELSE binary_payload END,
         updated_at = now()
     WHERE job_id = $1 AND status = 'processing' AND leased_by = $5`,
    [job.job_id, terminal ? "dead_letter" : "failed", clean(error?.message || error, 4_000), delaySeconds, job.leased_by],
  );
  if (update.rowCount !== 1) throw new Error(`Runtime job failure lease was lost for ${job.job_id}.`);
  return { terminal, delay_seconds: terminal ? 0 : delaySeconds };
}

async function processRuntimeJobBatch(pool, handlers, options = {}) {
  const jobs = await claimRuntimeJobs(pool, options);
  const results = [];
  for (const job of jobs) {
    const handler = handlers[job.job_type];
    if (!handler) {
      const failure = await failRuntimeJob(pool, job, new Error(`No runtime handler is registered for ${job.job_type}.`));
      results.push({ job_id: job.job_id, status: failure.terminal ? "dead_letter" : "failed" });
      continue;
    }
    try {
      const result = await handler.run(job);
      await completeRuntimeJob(pool, job, result);
      results.push({ job_id: job.job_id, status: "completed" });
    } catch (error) {
      let failure;
      try {
        failure = await failRuntimeJob(pool, job, error);
        if (handler.onFailure) await handler.onFailure(job, error, failure);
      } catch (persistenceError) {
        console.error(JSON.stringify({
          event: "runtime_job_failure_persistence",
          job_id: job.job_id,
          execution_error: clean(error?.message || error),
          persistence_error: clean(persistenceError?.message || persistenceError),
        }));
        throw persistenceError;
      }
      results.push({
        job_id: job.job_id,
        status: failure.terminal ? "dead_letter" : "failed",
        error: clean(error?.message || error),
      });
    }
  }
  return { claimed: jobs.length, results };
}

module.exports = {
  enqueueRuntimeJob,
  processRuntimeJobBatch,
};
