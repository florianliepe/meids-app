#!/usr/bin/env node
const test = require("node:test");
const assert = require("node:assert/strict");
const { learningDryRunDomainProof } = require("../backend/workspaceApi");

test("matching authoritative fingerprints prove an unchanged dry-run scope", () => {
  const proof = learningDryRunDomainProof(
    { digest: "a".repeat(64), entity_count: 12 },
    { digest: "a".repeat(64), entity_count: 12 },
  );
  assert.equal(proof.contract, "meids.learning-dry-run-domain-proof.v1");
  assert.equal(proof.entity_count, 12);
  assert.equal(proof.unchanged, true);
});

test("changed authoritative fingerprints fail closed", () => {
  const proof = learningDryRunDomainProof(
    { digest: "a".repeat(64), entity_count: 12 },
    { digest: "b".repeat(64), entity_count: 12 },
  );
  assert.equal(proof.unchanged, false);
});

test("missing fingerprints never count as unchanged", () => {
  assert.equal(learningDryRunDomainProof({}, {}).unchanged, false);
});
