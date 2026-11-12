const test = require("node:test");
const assert = require("node:assert/strict");
const { cancelQueuedRuntimeJob, processRuntimeJobBatch } = require("../backend/runtimeJobs");

function fakePool(job) {
  const calls = [];
  return {
    calls,
    async connect() {
      return {
        async query(sql, params = []) {
          calls.push({ scope: "client", sql, params });
          if (String(sql).includes("RETURNING job.*")) return { rows: [job], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    },
    async query(sql, params = []) {
      calls.push({ scope: "pool", sql, params });
      return { rows: [], rowCount: 1 };
    },
  };
}

function syntheticJob(overrides = {}) {
  return {
    job_id: "synthetic-runtime-job",
    job_type: "synthetic",
    status: "processing",
    attempts: 1,
    max_attempts: 3,
    leased_by: "synthetic-worker",
    payload: { synthetic: true },
    binary_payload: Buffer.from("synthetic-audio"),
    ...overrides,
  };
}

test("synthetic runtime job completes and purges binary payload", async () => {
  const pool = fakePool(syntheticJob());
  const result = await processRuntimeJobBatch(pool, {
    synthetic: { async run(job) { return { accepted: job.payload.synthetic }; } },
  });
  assert.equal(result.claimed, 1);
  assert.equal(result.results[0].status, "completed");
  const completion = pool.calls.find((call) => call.scope === "pool" && call.sql.includes("status = 'completed'"));
  assert.ok(completion);
  assert.match(completion.sql, /binary_payload = NULL/);
  assert.equal(completion.params[2], "synthetic-worker");
  assert.equal(completion.params[3], 1);
  assert.match(completion.sql, /leased_by = \$3 AND attempts = \$4/);
});

test("synthetic runtime job schedules bounded retry", async () => {
  const pool = fakePool(syntheticJob({ attempts: 2, max_attempts: 3 }));
  const failures = [];
  const result = await processRuntimeJobBatch(pool, {
    synthetic: {
      async run() { throw new Error("synthetic transient failure"); },
      async onFailure(job, error, failure) { failures.push({ job, error, failure }); },
    },
  });
  assert.equal(result.results[0].status, "failed");
  const failure = pool.calls.find((call) => call.scope === "pool" && call.sql.includes("SET status = $2"));
  assert.equal(failure.params[1], "failed");
  assert.equal(failure.params[3], 30);
  assert.equal(failure.params[5], 2);
  assert.match(failure.sql, /leased_by = \$5 AND attempts = \$6/);
  assert.equal(failures[0].failure.terminal, false);
});

test("synthetic runtime job dead-letters and purges binary after final attempt", async () => {
  const pool = fakePool(syntheticJob({ attempts: 3, max_attempts: 3 }));
  const result = await processRuntimeJobBatch(pool, {
    synthetic: { async run() { throw new Error("synthetic terminal failure"); } },
  });
  assert.equal(result.results[0].status, "dead_letter");
  const failure = pool.calls.find((call) => call.scope === "pool" && call.sql.includes("SET status = $2"));
  assert.equal(failure.params[1], "dead_letter");
  assert.match(failure.sql, /binary_payload = CASE WHEN \$2 = 'dead_letter' THEN NULL/);
});

test("uncertain timeout is terminal without an automatic duplicate retry", async () => {
  const pool = fakePool(syntheticJob({ attempts: 1, max_attempts: 3 }));
  const timeout = new Error("upstream completion is unknown");
  timeout.noRetry = true;
  const failures = [];
  const result = await processRuntimeJobBatch(pool, {
    synthetic: {
      async run() { throw timeout; },
      async onFailure(job, error, failure) { failures.push({ job, error, failure }); },
    },
  });
  assert.equal(result.results[0].status, "dead_letter");
  const failure = pool.calls.find((call) => call.scope === "pool" && call.sql.includes("SET status = $2"));
  assert.equal(failure.params[1], "dead_letter");
  assert.equal(failures[0].failure.terminal, true);
});

test("queued cancellation is atomic, owner-scoped, and purges binary payload", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rowCount: 1, rows: [{ job_id: "agent-work-cancel", status: "cancelled", cancelled: true }] };
    },
  };
  const result = await cancelQueuedRuntimeJob(client, {
    job_id: "agent-work-cancel", tenant_id: "tenant-a", actor_user_id: "user-a", twin_id: "twin-a",
  });
  assert.equal(result.cancelled, true);
  assert.deepEqual(calls[0].params, ["agent-work-cancel", "tenant-a", "user-a", "twin-a"]);
  assert.match(calls[0].sql, /target\.status IN \('pending', 'failed'\)/);
  assert.match(calls[0].sql, /job\.status IN \('pending', 'failed'\)/);
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.match(calls[0].sql, /binary_payload = NULL/);
  assert.doesNotMatch(calls[0].sql, /status = 'processing'.*cancelled/s);
});

test("cancellation reports a processing race without changing the leased job", async () => {
  const client = {
    async query() {
      return { rowCount: 1, rows: [{ job_id: "agent-work-running", status: "processing", cancelled: false }] };
    },
  };
  const result = await cancelQueuedRuntimeJob(client, {
    job_id: "agent-work-running", tenant_id: "tenant-a", actor_user_id: "user-a", twin_id: "twin-a",
  });
  assert.deepEqual(result, { job_id: "agent-work-running", status: "processing", cancelled: false });
});
