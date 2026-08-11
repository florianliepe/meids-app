const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const node = process.execPath;
const artifactCheckDir = path.join(os.tmpdir(), `meids-pages-public-safe-${process.pid}`);

const checks = [
  [node, ["--check", "frontend/app.js"]],
  [node, ["--check", "scripts/build-pages-static.cjs"]],
  [node, ["scripts/validate-n8n-fixtures.cjs"]],
  [node, ["scripts/validate-n8n-response-adapters.cjs"]],
  [node, ["scripts/write-n8n-production-adapter-status.cjs", "--check"]],
  [node, ["scripts/validate-n8n-live-probes.cjs"]],
  [node, ["scripts/validate-n8n-live-probe-evidence.cjs"]],
  [node, ["scripts/validate-okf-fixtures.cjs"]],
  [node, ["scripts/validate-graph-promotions.cjs"]],
  [node, ["scripts/validate-vector-adapter.cjs"]],
  [node, ["scripts/validate-postgres-graph-schema.cjs"]],
  [node, ["scripts/write-n8n-runtime-readiness-status.cjs", "--check"]],
  [node, ["scripts/write-n8n-live-readiness-preflight.cjs", "--check"]],
  [node, ["scripts/write-zielmodus-4-live-completion-checklist.cjs", "--check"]],
  [node, ["scripts/write-n8n-live-handoff-commands.cjs", "--check"]],
  [node, ["scripts/validate-n8n-live-artifacts.cjs"]],
  [node, ["scripts/validate-zielmodus-4-readiness.cjs"]],
  [node, ["scripts/pages-smoke-check.cjs", "frontend"]],
  [node, ["scripts/build-pages-static.cjs", "--output", artifactCheckDir]],
];

function run(command, args) {
  const label = [command, ...args].join(" ");
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Public-safe gate failed: ${label}`);
  }
}

try {
  for (const [command, args] of checks) {
    run(command, args);
  }
  console.log("\nZielmodus 4 public-safe gate passed.");
  console.log("Live completion is proven for UAT; remaining work is production adapter and durable persistence hardening.");
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
} finally {
  fs.rmSync(artifactCheckDir, { recursive: true, force: true });
}
