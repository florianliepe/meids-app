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
  const vectorRequests = listFiles(path.join(root, "contracts", "okf"), (file) => file.includes(`${path.sep}vector${path.sep}`) && file.endsWith(".json"));
  const artifact = {
    schema_version: "0.1.0",
    generated_at: new Date().toISOString(),
    status: failed.length ? "failed" : "passed",
    statuses: failed.length
      ? ["documented", "fixture ready", "validation failed"]
      : ["documented", "fixture ready", "contract tested", "promotion tested", "vector boundary tested"],
    summary: {
      example_fixture_count: examples.length,
      generated_ingest_file_count: generated.length,
      promotion_fixture_count: promotions.length,
      vector_request_fixture_count: vectorRequests.length,
      check_count: checks.length,
      passed_check_count: checks.length - failed.length,
    },
    paths: {
      schema_doc: "docs/knowledge-fabric-okf-schema.md",
      fixture_root: "contracts/okf/examples",
      ingest_request: "contracts/okf/ingest/sample-ingest-request.json",
      generated_root: "contracts/okf/generated",
      promotion_root: "contracts/okf/promotions",
      vector_adapter_example: "contracts/okf/generated/vector/ing_example_001-upsert-request.json",
    },
    checks,
    sample_files: {
      examples: examples.slice(0, 5).map(rel),
      generated: generated.slice(0, 5).map(rel),
      promotions: promotions.map(rel),
      vector_requests: vectorRequests.map(rel),
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
