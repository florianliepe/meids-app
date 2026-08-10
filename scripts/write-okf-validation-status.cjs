const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const defaultOutputPath = path.join(root, "frontend", "assets", "okf-validation-status.json");

function listFiles(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, predicate);
    return predicate(full) ? [full] : [];
  });
}

function runCheck(command, args) {
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return {
    command: `node ${[command, ...args].join(" ")}`,
    status: result.status === 0 ? "passed" : "failed",
    exit_code: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function parseArgs(argv) {
  const args = { write: false, output: defaultOutputPath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") args.write = true;
    if (arg === "--output") {
      args.output = path.resolve(argv[index + 1] || "");
      index += 1;
    }
  }
  return args;
}

function rel(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function vectorEligibilitySummary(vectorRequests) {
  const summary = {
    request_count: vectorRequests.length,
    document_count: 0,
    approved_only_request_count: 0,
    selected_pending_request_count: 0,
    evidence_ref_count: 0,
    evidence_state_count: 0,
    aligned_evidence_state_count: 0,
    approved_evidence_count: 0,
    pending_evidence_count: 0,
    candidate_evidence_count: 0,
    blocked_evidence_count: 0,
    statuses: [],
  };
  for (const file of vectorRequests) {
    const request = readJson(file);
    if (request.source_policy === "approved_only") summary.approved_only_request_count += 1;
    if (request.source_policy === "selected_pending") summary.selected_pending_request_count += 1;
    const documents = Array.isArray(request.documents) ? request.documents : [];
    summary.document_count += documents.length;
    for (const document of documents) {
      const evidenceRefs = Array.isArray(document.metadata?.evidence_refs) ? document.metadata.evidence_refs : [];
      const evidenceStates = Array.isArray(document.metadata?.evidence_review_states) ? document.metadata.evidence_review_states : [];
      summary.evidence_ref_count += evidenceRefs.length;
      summary.evidence_state_count += evidenceStates.length;
      if (evidenceRefs.length === evidenceStates.length) summary.aligned_evidence_state_count += evidenceRefs.length;
      for (const state of evidenceStates) {
        if (state === "approved") summary.approved_evidence_count += 1;
        else if (state === "pending-review") summary.pending_evidence_count += 1;
        else if (state === "candidate") summary.candidate_evidence_count += 1;
        else summary.blocked_evidence_count += 1;
      }
    }
  }
  if (summary.evidence_ref_count && summary.evidence_ref_count === summary.aligned_evidence_state_count) {
    summary.statuses.push("evidence aligned");
  }
  if (summary.selected_pending_request_count) summary.statuses.push("selected pending gated");
  if (summary.approved_only_request_count) summary.statuses.push("approved only tested");
  else summary.statuses.push("approved only fixture missing");
  if (summary.blocked_evidence_count) summary.statuses.push("blocked evidence found");
  return summary;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const checks = [
    runCheck("scripts/validate-okf-fixtures.cjs", []),
    runCheck("scripts/validate-graph-promotions.cjs", []),
    runCheck("scripts/validate-vector-adapter.cjs", []),
  ];
  const failed = checks.filter((check) => check.status !== "passed");
  const examples = listFiles(path.join(root, "contracts", "okf", "examples"), (file) => /\.(md|yaml|json|jsonl)$/.test(file));
  const generated = listFiles(path.join(root, "contracts", "okf", "generated"), (file) => /\.(md|yaml|json|jsonl)$/.test(file));
  const promotions = listFiles(path.join(root, "contracts", "okf", "promotions"), (file) => file.endsWith(".json"));
  const repoSyncPackages = listFiles(path.join(root, "contracts", "okf", "repo-sync"), (file) => file.endsWith(".json"));
  const vectorRequests = listFiles(path.join(root, "contracts", "okf"), (file) => file.includes(`${path.sep}vector${path.sep}`) && !file.includes(`${path.sep}negative${path.sep}`) && file.endsWith(".json"));
  const negativeVectorRequests = listFiles(path.join(root, "contracts", "okf", "negative", "vector"), (file) => file.endsWith(".json"));
  const negativeConcepts = listFiles(path.join(root, "contracts", "okf", "negative", "concepts"), (file) => file.endsWith(".md"));
  const artifact = {
    schema_version: "0.1.0",
    generated_at: new Date().toISOString(),
    status: failed.length ? "failed" : "passed",
    statuses: failed.length
      ? ["documented", "fixture ready", "validation failed"]
      : ["documented", "fixture ready", "contract tested", "promotion tested", "vector boundary tested", "evidence review gate tested"],
    summary: {
      example_fixture_count: examples.length,
      generated_ingest_file_count: generated.length,
      promotion_fixture_count: promotions.length,
      repo_sync_package_fixture_count: repoSyncPackages.length,
      vector_request_fixture_count: vectorRequests.length,
      negative_vector_fixture_count: negativeVectorRequests.length,
      negative_concept_fixture_count: negativeConcepts.length,
      evidence_review_gate_fixture_count: negativeConcepts.filter((file) => file.includes("evidence-review") || file.includes("evidence")).length,
      check_count: checks.length,
      passed_check_count: checks.length - failed.length,
    },
    vector_eligibility: vectorEligibilitySummary(vectorRequests),
    paths: {
      schema_doc: "docs/knowledge-fabric-okf-schema.md",
      fixture_root: "contracts/okf/examples",
      ingest_request: "contracts/okf/ingest/sample-ingest-request.json",
      generated_root: "contracts/okf/generated",
      promotion_root: "contracts/okf/promotions",
      repo_sync_root: "contracts/okf/repo-sync",
      vector_adapter_example: "contracts/okf/generated/vector/ing_example_001-upsert-request.json",
    },
    checks,
    sample_files: {
      examples: examples.slice(0, 5).map(rel),
      generated: generated.slice(0, 5).map(rel),
      promotions: promotions.map(rel),
      repo_sync_packages: repoSyncPackages.map(rel),
      vector_requests: vectorRequests.map(rel),
      negative_vector_requests: negativeVectorRequests.map(rel),
      negative_concepts: negativeConcepts.map(rel),
    },
  };
  if (args.write) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  }
  console.log(`OKF validation status ${artifact.status}: ${artifact.summary.passed_check_count}/${artifact.summary.check_count} checks passed`);
  if (args.write) console.log(`OKF validation status written: ${rel(args.output)}`);
  if (failed.length) process.exit(1);
}

main();
