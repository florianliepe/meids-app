#!/usr/bin/env node
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { learningDryRunDomainFingerprint } = require("../backend/workspaceApi");

const connectionString = String(process.env.MEIDS_TEST_DATABASE_URL || "").trim();
const runId = String(process.env.MEIDS_TEST_RUN_ID || "").trim();
if (!connectionString || !/^[a-f0-9]{8,32}$/.test(runId)) {
  throw new Error("MEIDS_TEST_DATABASE_URL and a hexadecimal MEIDS_TEST_RUN_ID are required.");
}
const target = new URL(connectionString);
const expectedDatabase = `meids_learning_dry_run_${runId}_test`;
const loopback = ["127.0.0.1", "localhost", "::1"].includes(target.hostname);
if (!loopback || target.pathname.replace(/^\//, "") !== expectedDatabase || process.env.MEIDS_ALLOW_DESTRUCTIVE_TEST_DB !== "1") {
  throw new Error("Learning dry-run proof test requires an explicitly enabled, run-owned loopback test database.");
}

const pool = new Pool({ connectionString, max: 2 });
const mapping = {
  tenant_id: "tenant-a",
  user_id: "user-a",
  active_twin_id: "twin-a",
  allowed_twin_ids: ["twin-a"],
  group_ids: [],
};

async function prepare() {
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await pool.query("CREATE SCHEMA learning; CREATE SCHEMA knowledge; CREATE SCHEMA runtime");
  await pool.query(`
    CREATE TABLE learning.increment (increment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text, owner_user_id text, twin_id text, summary text);
    CREATE TABLE learning.concept_delta (delta_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), increment_id uuid, delta jsonb);
    CREATE TABLE knowledge.source (source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text, owner_user_id text, twin_id text, metadata jsonb);
    CREATE TABLE knowledge.concept (concept_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text, owner_user_id text, twin_id text, title text, current_revision int);
    CREATE TABLE knowledge.concept_revision (concept_id uuid, revision int, tenant_id text, owner_user_id text, twin_id text, content jsonb);
    CREATE TABLE knowledge.evidence (evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text, owner_user_id text, twin_id text, citation jsonb);
    CREATE TABLE knowledge.chunk (chunk_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text, owner_user_id text, twin_id text, chunk_text text);
    CREATE TABLE knowledge.graph_node (tenant_id text, twin_id text, node_key text, projection jsonb);
    CREATE TABLE knowledge.graph_edge (tenant_id text, twin_id text, edge_key text, score_evidence jsonb);
    CREATE TABLE knowledge.graph_edge_review (review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text, twin_id text, edge_key text, edge_snapshot jsonb);
    CREATE TABLE knowledge.graph_projection_run (run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text, twin_id text, details jsonb);
    CREATE TABLE runtime.outbox_event (event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text, payload jsonb);
  `);
  const increment = await pool.query(
    "INSERT INTO learning.increment (tenant_id, owner_user_id, twin_id, summary) VALUES ($1,$2,$3,'baseline') RETURNING increment_id",
    [mapping.tenant_id, mapping.user_id, mapping.active_twin_id],
  );
  await pool.query("INSERT INTO learning.concept_delta (increment_id, delta) VALUES ($1, '{}'::jsonb)", [increment.rows[0].increment_id]);
  await pool.query(
    "INSERT INTO knowledge.concept (tenant_id, owner_user_id, twin_id, title, current_revision) VALUES ($1,$2,$3,'baseline',1)",
    [mapping.tenant_id, mapping.user_id, mapping.active_twin_id],
  );
  await pool.query(
    "INSERT INTO runtime.outbox_event (tenant_id, payload) VALUES ($1, jsonb_build_object('user_id',$2::text,'twin_id',$3::text))",
    [mapping.tenant_id, mapping.user_id, mapping.active_twin_id],
  );
}

async function main() {
  try {
    await prepare();
    const before = await learningDryRunDomainFingerprint(pool, mapping, mapping.active_twin_id);
    const stable = await learningDryRunDomainFingerprint(pool, mapping, mapping.active_twin_id);
    assert.equal(before.entity_count, 12);
    assert.equal(stable.digest, before.digest);
    await pool.query("UPDATE knowledge.concept SET title = 'changed' WHERE tenant_id = $1 AND owner_user_id = $2 AND twin_id = $3", [mapping.tenant_id, mapping.user_id, mapping.active_twin_id]);
    const after = await learningDryRunDomainFingerprint(pool, mapping, mapping.active_twin_id);
    assert.notEqual(after.digest, before.digest);
    console.log(JSON.stringify({ status: "passed", contract: before.contract, entity_count: before.entity_count }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
