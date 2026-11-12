const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { runPostgresApprovalDecision } = require("../backend/approvalPersistence");
const { stageKnowledge } = require("../backend/knowledgePersistence");
const { stageSkillProposal } = require("../backend/agentApprovalActions");

const connectionString = String(process.env.MEIDS_TEST_DATABASE_URL || "").trim();
const runId = String(process.env.MEIDS_TEST_RUN_ID || "").trim();
if (!connectionString || !/^[a-f0-9]{8,32}$/.test(runId)) {
  throw new Error("MEIDS_TEST_DATABASE_URL and a hexadecimal MEIDS_TEST_RUN_ID are required.");
}
const target = new URL(connectionString);
const expectedDatabase = `meids_approval_faults_${runId}_test`;
const loopback = ["127.0.0.1", "localhost", "::1"].includes(target.hostname);
if (!loopback || target.pathname.replace(/^\//, "") !== expectedDatabase || process.env.MEIDS_ALLOW_DESTRUCTIVE_TEST_DB !== "1") {
  throw new Error("Approval action fault test requires an explicitly enabled, run-owned loopback test database.");
}

const pool = new Pool({ connectionString, max: 4 });
const mapping = {
  tenant_id: "tenant-a",
  user_id: "user-a",
  active_twin_id: "twin-a",
  allowed_twin_ids: ["twin-a"],
  group_ids: [],
};
const domainTables = [
  "knowledge.concept",
  "knowledge.source",
  "knowledge.concept_revision",
  "knowledge.chunk",
  "knowledge.evidence",
  "runtime.outbox_event",
  "agent.skill_spec",
  "audit.event",
];

async function prepare() {
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await pool.query("CREATE SCHEMA knowledge; CREATE SCHEMA runtime; CREATE SCHEMA audit; CREATE SCHEMA agent");
  await pool.query(`CREATE TABLE agent_approval_queue (
    approval_id text PRIMARY KEY, status text NOT NULL, record jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE knowledge.concept (
    concept_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL, owner_user_id text NOT NULL,
    twin_id text NOT NULL, canonical_key text NOT NULL, title text NOT NULL, visibility_scope text NOT NULL,
    review_state text NOT NULL, current_revision integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, twin_id, canonical_key)
  )`);
  await pool.query(`CREATE TABLE knowledge.source (
    source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL, owner_user_id text NOT NULL,
    twin_id text NOT NULL, source_type text NOT NULL, repository_ref text, checksum text NOT NULL, metadata jsonb NOT NULL
  )`);
  await pool.query(`CREATE TABLE knowledge.concept_revision (
    concept_id uuid NOT NULL, revision integer NOT NULL, tenant_id text NOT NULL, owner_user_id text NOT NULL,
    twin_id text NOT NULL, content jsonb NOT NULL, change_reason text NOT NULL, created_by text NOT NULL, checksum text NOT NULL,
    PRIMARY KEY (concept_id, revision)
  )`);
  await pool.query(`CREATE TABLE knowledge.chunk (
    chunk_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), concept_id uuid NOT NULL, revision integer NOT NULL,
    tenant_id text NOT NULL, owner_user_id text NOT NULL, twin_id text NOT NULL, chunk_ordinal integer NOT NULL,
    chunk_text text NOT NULL, search_document_id text NOT NULL, content_vector jsonb
  )`);
  await pool.query(`CREATE TABLE knowledge.evidence (
    evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), concept_id uuid NOT NULL, tenant_id text NOT NULL,
    owner_user_id text NOT NULL, twin_id text NOT NULL, source_id uuid, citation jsonb NOT NULL, confidence numeric
  )`);
  await pool.query(`CREATE TABLE runtime.outbox_event (
    event_id bigserial PRIMARY KEY, tenant_id text NOT NULL, aggregate_type text NOT NULL, aggregate_id uuid NOT NULL,
    event_type text NOT NULL, payload jsonb NOT NULL, dedupe_key text NOT NULL UNIQUE
  )`);
  await pool.query(`CREATE TABLE audit.event (
    event_id bigserial PRIMARY KEY, tenant_id text NOT NULL, actor_user_id text NOT NULL, action text NOT NULL,
    resource_type text NOT NULL, resource_id text NOT NULL, details jsonb NOT NULL
  )`);
  await pool.query(`CREATE TABLE agent.skill_spec (
    skill_id text PRIMARY KEY, tenant_id text NOT NULL, owner_user_id text NOT NULL, twin_id text NOT NULL,
    name text NOT NULL, description text NOT NULL, status text NOT NULL, risk_class text NOT NULL,
    spec jsonb NOT NULL, version text NOT NULL DEFAULT '0.1.0'
  )`);
  await pool.query(`CREATE TABLE test_tx_trace (
    table_name text NOT NULL, backend_pid integer NOT NULL, transaction_id bigint NOT NULL
  )`);
  await pool.query(`CREATE FUNCTION test_record_or_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE target text := TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
    BEGIN
      IF current_setting('meids.test_failpoint', true) = target THEN
        RAISE EXCEPTION 'injected persistence failure at %', target USING ERRCODE = 'P0001';
      END IF;
      INSERT INTO test_tx_trace (table_name, backend_pid, transaction_id)
      VALUES (target, pg_backend_pid(), txid_current());
      RETURN NEW;
    END
  $$`);
  for (const table of domainTables) {
    const triggerName = `test_fault_${table.replace(".", "_")}`;
    await pool.query(`CREATE TRIGGER ${triggerName} BEFORE INSERT OR UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION test_record_or_fail()`);
  }
}

async function reset(approvalId) {
  await pool.query(`TRUNCATE
    agent_approval_queue, knowledge.concept, knowledge.source, knowledge.concept_revision,
    knowledge.chunk, knowledge.evidence, runtime.outbox_event, agent.skill_spec, audit.event, test_tx_trace`);
  await pool.query(
    `INSERT INTO agent_approval_queue (approval_id, status, record)
     VALUES ($1, 'pending_human_approval', $2::jsonb)`,
    [approvalId, JSON.stringify({ approval_id: approvalId, status: "pending_human_approval" })],
  );
}

function knowledgePayload(suffix) {
  return {
    twin_id: "twin-a",
    concept: {
      title: `Fault-safe knowledge ${suffix}`,
      summary: "Persist all governed knowledge records atomically.",
      visibility_scope: "private",
    },
    source: { type: "agent_interaction", repository_ref: `trace-${suffix}` },
    evidence: [{ citation: { text: "Reviewed evidence" }, confidence: 1 }],
    change_reason: "Approval persistence fault test",
  };
}

function skillPayload(suffix) {
  return {
    skill_id: `fault-safe-skill-${suffix}`,
    twin_id: "twin-a",
    name: "Fault-safe skill",
    description: "Persist a governed skill proposal atomically.",
    risk_class: "medium",
    spec: { approval_policy: "never_auto_approve_generated_skills" },
  };
}

async function tableCount(table) {
  const result = await pool.query(`SELECT count(*)::int AS count FROM ${table}`);
  return result.rows[0].count;
}

async function assertNoDomainWrites() {
  for (const table of domainTables) assert.equal(await tableCount(table), 0, `${table} must roll back`);
}

async function assertRetryableFailure(approvalId) {
  const state = await pool.query("SELECT status, record FROM agent_approval_queue WHERE approval_id = $1", [approvalId]);
  assert.equal(state.rows[0].status, "pending_human_approval");
  assert.equal(state.rows[0].record.last_failure_rolled_back, true);
  await assertNoDomainWrites();
}

async function knowledgeFailureAt(table, index) {
  const approvalId = `knowledge-failure-${index}`;
  await reset(approvalId);
  await assert.rejects(runPostgresApprovalDecision(pool, {
    approvalId,
    mapping,
    decisionStatus: "resuming",
    terminalStatus: "resumed",
    execute: async (client) => {
      await client.query("SELECT set_config('meids.test_failpoint', $1, true)", [table]);
      return stageKnowledge(pool, mapping, knowledgePayload(index), { client });
    },
  }), (error) => error.approvalTransactionRolledBack === true && error.message.includes(table));
  await assertRetryableFailure(approvalId);
}

async function skillFailureAt(table, index) {
  const approvalId = `skill-failure-${index}`;
  await reset(approvalId);
  await assert.rejects(runPostgresApprovalDecision(pool, {
    approvalId,
    mapping,
    decisionStatus: "resuming",
    terminalStatus: "resumed",
    execute: async (client) => {
      await client.query("SELECT set_config('meids.test_failpoint', $1, true)", [table]);
      return stageSkillProposal(pool, mapping, skillPayload(index), { client });
    },
  }), (error) => error.approvalTransactionRolledBack === true && error.message.includes(table));
  await assertRetryableFailure(approvalId);
}

async function assertSingleTransaction(expectedTables) {
  const trace = await pool.query(`SELECT array_agg(DISTINCT table_name ORDER BY table_name) AS tables,
    count(DISTINCT backend_pid)::int AS pids, count(DISTINCT transaction_id)::int AS transactions FROM test_tx_trace`);
  assert.equal(trace.rows[0].pids, 1);
  assert.equal(trace.rows[0].transactions, 1);
  assert.deepEqual(trace.rows[0].tables, [...expectedTables].sort());
}

async function successfulKnowledgeApproval() {
  const approvalId = "knowledge-success";
  await reset(approvalId);
  const result = await runPostgresApprovalDecision(pool, {
    approvalId,
    mapping,
    decisionStatus: "resuming",
    terminalStatus: "resumed",
    execute: (client) => stageKnowledge(pool, mapping, knowledgePayload("success"), { client }),
  });
  assert.equal(result.claimed, true);
  assert.equal(result.actionResult.review_state, "review_needed");
  assert.equal((await pool.query("SELECT status FROM agent_approval_queue WHERE approval_id = $1", [approvalId])).rows[0].status, "resumed");
  assert.equal(await tableCount("runtime.outbox_event"), 1);
  await assertSingleTransaction([
    "audit.event", "knowledge.chunk", "knowledge.concept", "knowledge.concept_revision",
    "knowledge.evidence", "knowledge.source", "runtime.outbox_event",
  ]);
}

async function successfulSkillApproval() {
  const approvalId = "skill-success";
  await reset(approvalId);
  const result = await runPostgresApprovalDecision(pool, {
    approvalId,
    mapping,
    decisionStatus: "resuming",
    terminalStatus: "resumed",
    execute: (client) => stageSkillProposal(pool, mapping, skillPayload("success"), { client }),
  });
  assert.equal(result.claimed, true);
  assert.equal(result.actionResult.status, "pending_approval");
  assert.equal((await pool.query("SELECT status FROM agent_approval_queue WHERE approval_id = $1", [approvalId])).rows[0].status, "resumed");
  await assertSingleTransaction(["agent.skill_spec", "audit.event"]);
}

const knowledgeFailpoints = [
  "knowledge.concept", "knowledge.source", "knowledge.concept_revision", "knowledge.chunk",
  "knowledge.evidence", "runtime.outbox_event", "audit.event",
];
const skillFailpoints = ["agent.skill_spec", "audit.event"];

Promise.resolve()
  .then(prepare)
  .then(async () => {
    for (const [index, table] of knowledgeFailpoints.entries()) await knowledgeFailureAt(table, index);
    for (const [index, table] of skillFailpoints.entries()) await skillFailureAt(table, index);
  })
  .then(successfulKnowledgeApproval)
  .then(successfulSkillApproval)
  .then(() => console.log(JSON.stringify({
    status: "passed",
    scenarios: {
      knowledge_failpoints: knowledgeFailpoints,
      skill_failpoints: skillFailpoints,
      same_connection_and_transaction: true,
    },
  }, null, 2)))
  .finally(() => pool.end())
  .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
