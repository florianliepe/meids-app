const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const defaultOutput = path.join(root, "frontend", "assets", "n8n-production-adapter-status.json");
const exampleDir = path.join(root, "contracts", "n8n", "adapter-examples");

function rel(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseArgs(argv) {
  const args = { output: defaultOutput, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") {
      args.output = path.resolve(argv[index + 1] || "");
      index += 1;
    }
    if (arg === "--check") args.check = true;
  }
  return args;
}

function runValidator() {
  const result = spawnSync(process.execPath, ["scripts/validate-n8n-response-adapters.cjs"], {
    cwd: root,
    encoding: "utf8",
  });
  return {
    status: result.status === 0 ? "passed" : "failed",
    exit_code: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function buildArtifact(validation) {
  const files = fs
    .readdirSync(exampleDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => path.join(exampleDir, file));
  const examples = files.map((file) => {
    const body = readJson(file);
    return {
      path: rel(file),
      agent_id: body.agent_id,
      status: body.status,
      has_trace: Boolean(body.trace?.trace_id),
      approval_gate: body.approval?.gate || null,
      error_code: body.error?.code || null,
    };
  });
  const statuses = new Set(examples.map((example) => example.status));
  return {
    schema_version: "0.1.0",
    generated_at: new Date().toISOString(),
    status: validation.status === "passed" ? "adapter_contract_ready" : "blocked",
    boundary: "Public-safe status. It validates production adapter response examples and does not call n8n or include webhook URLs.",
    schema: "contracts/n8n/schemas/agent-response.schema.json",
    validation,
    summary: {
      example_count: examples.length,
      status_count: statuses.size,
      required_status_count: 3,
      production_adapter_ready: validation.status === "passed" && statuses.size >= 3,
    },
    examples,
    next_actions: [
      "Patch each live n8n workflow to run raw AI output through the production adapter normalizer.",
      "Add a failure fallback branch that returns INVALID_CONTRACT_PAYLOAD when adapter normalization fails.",
      "Re-run live probes and record new trace IDs after adapter patching.",
      "Only then connect Knowledge Fabric writes and Agentic Butler trace persistence to durable stores."
    ],
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const validation = runValidator();
  const artifact = buildArtifact(validation);
  const next = `${JSON.stringify(artifact, null, 2)}\n`;
  if (args.check) {
    if (!fs.existsSync(args.output)) throw new Error(`${rel(args.output)} is missing`);
    const current = readJson(args.output);
    if (current.status !== artifact.status) throw new Error(`${rel(args.output)} status is ${current.status}, expected ${artifact.status}`);
    if (current.summary?.example_count !== artifact.summary.example_count) {
      throw new Error(`${rel(args.output)} example count is out of date`);
    }
    if (current.summary?.status_count !== artifact.summary.status_count) {
      throw new Error(`${rel(args.output)} response status count is out of date`);
    }
  } else {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, next, "utf8");
  }
  if (validation.status !== "passed") {
    throw new Error(validation.stderr || validation.stdout || "n8n production adapter validation failed");
  }
  console.log(`n8n production adapter status ${args.check ? "checked" : "written"}: ${rel(args.output)}`);
}

main();
