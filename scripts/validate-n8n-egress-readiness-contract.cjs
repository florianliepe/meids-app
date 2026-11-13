const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "scripts", "write-n8n-egress-readiness-status.cjs"), "utf8");
const verdict = fs.readFileSync(path.join(root, "scripts", "lib", "n8n-egress-verdict.cjs"), "utf8");
const implementation = `${script}\n${verdict}`;
const admin = fs.readFileSync(path.join(root, "frontend", "admin", "admin.js"), "utf8");
const html = fs.readFileSync(path.join(root, "frontend", "admin", "index.html"), "utf8");

const checks = [
  [script.includes('MEIDS_N8N_EGRESS_MIN_HOURS || 168'), "seven-day default observation window"],
  [script.includes('meids.n8n-egress-readiness.v1'), "versioned retirement evidence contract"],
  [implementation.includes('"observation_in_progress"'), "incomplete coverage cannot pass"],
  [implementation.includes('positiveControls < 1'), "positive dependency sensor control"],
  [script.includes('http_dependencies=countif'), "outbound HTTP positive control"],
  [script.includes('n8n_workflow_activity_sensor'), "active n8n workflow execution sensor"],
  [script.includes('inventory_complete'), "versioned workflow inventory completeness"],
  [script.includes('hour_buckets'), "hourly telemetry gap detection"],
  [script.includes('ingestion_lag_hours'), "ingestion freshness gate"],
  [script.includes('unknown_http_dependencies'), "unknown outbound HTTP detection"],
  [script.includes('sampled_dependencies'), "sampling false-pass guard"],
  [script.includes('retention_unknown_workflows'), "n8n execution-retention guard"],
  [script.includes('configured_workers'), "configured worker coverage check"],
  [script.includes('runtime_boundary_healthy'), "Azure-native fallback-off drift gate"],
  [script.includes('browser_endpoint_contract_clean'), "browser endpoint boundary gate"],
  [script.includes('valid_until'), "evidence expiry"],
  [script.includes('2026-11-13T09:04:54.654Z'), "explicit post-rollback Azure-native observation start"],
  [script.includes("n8n_calls=countif"), "n8n target dependency count"],
  [script.includes("data_l contains"), "dependency data alias inspection"],
  [script.includes("boundary:"), "public-safe evidence boundary"],
  [admin.includes("n8n-egress-readiness-status.json"), "Admin Cockpit asset loading"],
  [html.includes('id="n8nEgressStatus"'), "Admin Cockpit status target"],
];
const failures = checks.filter(([passed]) => !passed).map(([, label]) => label);
if (failures.length) {
  console.error(JSON.stringify({ status: "failed", failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ status: "passed", checks: checks.map(([, label]) => label) }, null, 2));
