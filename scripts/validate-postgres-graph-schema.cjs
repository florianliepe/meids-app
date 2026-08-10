const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const schemaPath = path.join(root, "contracts", "okf", "postgres", "graph-projection-schema.sql");

function fail(message) {
  throw new Error(message);
}

function normalize(sql) {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

function requireIncludes(sql, label, patterns) {
  for (const pattern of patterns) {
    if (!sql.includes(pattern.toLowerCase())) fail(`${label}: missing ${pattern}`);
  }
}

if (!fs.existsSync(schemaPath)) fail("Missing contracts/okf/postgres/graph-projection-schema.sql");

const sql = normalize(fs.readFileSync(schemaPath, "utf8"));

requireIncludes(sql, "schema", [
  "create schema if not exists meids_okf",
  "create table if not exists meids_okf.graph_nodes",
  "create table if not exists meids_okf.graph_edges",
  "create table if not exists meids_okf.graph_promotions",
  "create table if not exists meids_okf.graph_projection_runs",
  "create view if not exists meids_okf.trusted_graph_edges",
  "create view if not exists meids_okf.reviewable_graph_edges",
]);

requireIncludes(sql, "review lifecycle", [
  "'draft'",
  "'candidate'",
  "'pending-review'",
  "'approved'",
  "'needs-rework'",
  "'rejected'",
  "'retired'",
]);

requireIncludes(sql, "edge contract", [
  "'supports'",
  "'contradicts'",
  "'requires'",
  "'similar_to'",
  "'causes'",
  "'evidence_for'",
  "'uses_skill'",
  "'explicit'",
  "'inferred'",
  "'duplicate-candidate'",
  "'contradiction-candidate'",
  "confidence >= 0 and confidence <= 1",
]);

requireIncludes(sql, "source projection boundary", [
  "source_path text not null",
  "source_hash text not null",
  "promotion_path text not null",
  "source_commit_sha text not null",
]);

requireIncludes(sql, "trusted retrieval gate", [
  "where review_state = 'approved'",
  "jsonb_array_length(evidence_refs) > 0",
]);

console.log("Postgres graph projection schema validation passed");
