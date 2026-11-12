const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const { Pool } = require("pg");
const { processRuntimeJobBatch } = require("../backend/runtimeJobs");

const connectionString = String(process.env.MEIDS_TEST_DATABASE_URL || "").trim();
const runId = String(process.env.MEIDS_TEST_RUN_ID || "").trim();

async function workerMode() {
  const pool = new Pool({ connectionString, max: 2 });
  try {
    const result = await processRuntimeJobBatch(pool, {
      agent_work: {
        async run(job) {
          const response = await fetch(process.env.MEIDS_TEST_PROVIDER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Operation-Id": job.job_id },
            body: JSON.stringify({ job_id: job.job_id, attempt: Number(job.attempts) }),
          });
          return response.json();
        },
      },
    }, { workerId: process.env.MEIDS_TEST_WORKER_ID, batchSize: 1, leaseSeconds: 60 });
    if (process.send) process.send({ type: "result", result });
  } catch (error) {
    if (process.send) process.send({ type: "error", error: error.stack || error.message });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.env.MEIDS_TEST_CHILD_WORKER === "1") {
  workerMode();
} else {
  if (!connectionString || !/^[a-f0-9]{8,32}$/.test(runId)) {
    throw new Error("MEIDS_TEST_DATABASE_URL and a hexadecimal MEIDS_TEST_RUN_ID are required.");
  }
  const target = new URL(connectionString);
  const databaseName = target.pathname.replace(/^\//, "");
  const expectedDatabase = `meids_runtime_worker_${runId}_test`;
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(target.hostname);
  if (!loopback || databaseName !== expectedDatabase || process.env.MEIDS_ALLOW_DESTRUCTIVE_TEST_DB !== "1") {
    throw new Error("Worker-termination test requires an explicitly enabled, run-owned loopback test database.");
  }

  const root = path.resolve(__dirname, "..");
  const pool = new Pool({ connectionString, max: 4 });
  let providerInvocations = 0;
  let releaseFirstRequest;
  const firstRequest = new Promise((resolve) => { releaseFirstRequest = resolve; });
  const provider = http.createServer((req) => {
    providerInvocations += 1;
    req.resume();
    releaseFirstRequest();
    // Keep the accepted request unresolved so the worker dies with unknown completion.
  });

  function spawnWorker(providerUrl, workerId) {
    return fork(__filename, [], {
      env: {
        ...process.env,
        MEIDS_TEST_CHILD_WORKER: "1",
        MEIDS_TEST_PROVIDER_URL: providerUrl,
        MEIDS_TEST_WORKER_ID: workerId,
      },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
  }

  async function waitForExit(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await once(child, "exit");
  }

  function waitForWorkerResult(child, timeoutMs = 5_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Replacement worker did not finish without redispatch.")), timeoutMs);
      child.once("message", (message) => {
        clearTimeout(timer);
        if (message?.type === "error") reject(new Error(message.error));
        else resolve(message?.result);
      });
      child.once("exit", (code, signal) => {
        if (code && code !== 0) {
          clearTimeout(timer);
          reject(new Error(`Replacement worker exited with ${code || signal}.`));
        }
      });
    });
  }

  async function prepare() {
    const current = await pool.query("SELECT current_database() AS name");
    assert.equal(current.rows[0].name, expectedDatabase);
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meids_app_runtime') THEN
        CREATE ROLE meids_app_runtime;
      END IF;
    END $$`);
    await pool.query("CREATE SCHEMA runtime");
    await pool.query("CREATE SCHEMA app_security");
    await pool.query("CREATE SCHEMA audit");
    await pool.query(`CREATE FUNCTION app_security.setting(name text) RETURNS text
      LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting(name, true), '') $$`);
    await pool.query(`CREATE FUNCTION app_security.setting_list(name text) RETURNS text[]
      LANGUAGE sql STABLE AS $$ SELECT CASE
        WHEN app_security.setting(name) IS NULL THEN ARRAY[]::text[]
        ELSE string_to_array(app_security.setting(name), ',') END $$`);
    await pool.query(`CREATE TABLE audit.event (
      tenant_id text NOT NULL, actor_user_id text NOT NULL, resource_id text,
      resource_type text NOT NULL, action text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb
    )`);
    for (const migration of [
      "012_audit_runtime_read_policy.sql",
      "017_runtime_background_jobs.sql",
      "019_audit_background_work_update_policy.sql",
      "020_runtime_background_job_cancellation.sql",
    ]) {
      await pool.query(fs.readFileSync(path.join(root, "backend", "migrations", migration), "utf8"));
    }
    await pool.query(
      `INSERT INTO runtime.background_job (
         job_id, tenant_id, actor_user_id, twin_id, job_type, idempotency_key, payload, binary_payload, max_attempts
       ) VALUES ('worker-kill-job', 'tenant-a', 'user-a', 'twin-a', 'agent_work', $1, '{}'::jsonb, decode('CAFE', 'hex'), 3)`,
      [`worker-kill-${runId}`],
    );
  }

  async function run() {
    await prepare();
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const address = provider.address();
    const providerUrl = `http://127.0.0.1:${address.port}/provider`;

    const original = spawnWorker(providerUrl, "worker-before-kill");
    await Promise.race([
      firstRequest,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Provider did not receive the first dispatch.")), 5_000)),
    ]);
    assert.equal(providerInvocations, 1);
    original.kill("SIGKILL");
    await waitForExit(original);

    const beforeRecovery = await pool.query(
      "SELECT status, attempts FROM runtime.background_job WHERE job_id = 'worker-kill-job'",
    );
    assert.deepEqual(beforeRecovery.rows[0], { status: "processing", attempts: 1 });
    await pool.query(
      "UPDATE runtime.background_job SET lease_expires_at = now() - interval '1 second' WHERE job_id = 'worker-kill-job'",
    );

    const replacement = spawnWorker(providerUrl, "worker-after-kill");
    let replacementResult;
    try {
      replacementResult = await waitForWorkerResult(replacement);
    } finally {
      if (replacement.exitCode === null && replacement.signalCode === null) replacement.kill("SIGKILL");
      await waitForExit(replacement).catch(() => {});
    }
    assert.deepEqual(replacementResult, { claimed: 0, results: [] });
    assert.equal(providerInvocations, 1);

    const stored = await pool.query(
      `SELECT status, attempts, result, binary_payload IS NULL AS binary_purged
       FROM runtime.background_job WHERE job_id = 'worker-kill-job'`,
    );
    assert.deepEqual(stored.rows[0], {
      status: "dead_letter",
      attempts: 1,
      result: {
        status: "unknown_completion",
        code: "runtime_lease_expired_unknown_completion",
        retryable: false,
        reconciliation_required: true,
      },
      binary_purged: true,
    });

    console.log(JSON.stringify({
      status: "passed",
      contract: "meids.runtime-worker-termination.v1",
      provider_invocations: providerInvocations,
      replacement_claims: replacementResult.claimed,
      terminal_status: stored.rows[0].result.status,
    }, null, 2));
  }

  run()
    .finally(async () => {
      if (provider.listening) {
        provider.closeAllConnections?.();
        await new Promise((resolve) => provider.close(resolve));
      }
      await pool.end();
    })
    .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
