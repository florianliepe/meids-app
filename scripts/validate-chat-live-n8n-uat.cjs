const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultFile = path.join(root, "docs", "uat", "agent-interaction-uat-results.json");
const expectedCases = new Set([
  "actor_answer",
  "knowledge_fabric_handoff",
  "agentic_butler_work_artifact_handoff",
  "agentic_butler_create_skill_approval",
]);

function argValue(name, fallback = "") {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const file = path.resolve(root, argValue("--file", path.relative(root, defaultFile)));
if (!fs.existsSync(file)) fail(`Missing browser UAT evidence: ${path.relative(root, file)}`);

const artifact = readJson(file);
if (artifact.schema_version !== "0.1.0") fail("schema_version must be 0.1.0");
if (!Array.isArray(artifact.cases)) fail("cases must be an array");
if (!artifact.summary || typeof artifact.summary !== "object") fail("summary missing");
if (artifact.summary.status !== "passed") {
  const failedCases = (artifact.cases || [])
    .filter((item) => item.status !== "passed")
    .map((item) => `${item.case_id}: ${(item.findings || []).join("; ") || "failed"}`);
  fail(`Live n8n UAT failed: ${failedCases.join(" | ")}`);
}

const seen = new Set();
for (const item of artifact.cases) {
  if (!expectedCases.has(item.case_id)) fail(`Unexpected case_id: ${item.case_id}`);
  if (!item.query) fail(`${item.case_id} missing query`);
  if (!item.expected_target_agent) fail(`${item.case_id} missing expected_target_agent`);
  if (!item.actual_target_agent) fail(`${item.case_id} missing actual_target_agent`);
  if (!item.status) fail(`${item.case_id} missing status`);
  if (item.status !== "passed") fail(`${item.case_id} did not pass`);
  if (!item.route_decision) fail(`${item.case_id} missing route_decision`);
  if (item.status === "passed" && item.actual_target_agent !== item.expected_target_agent) {
    fail(`${item.case_id} passed with unexpected target ${item.actual_target_agent}`);
  }
  seen.add(item.case_id);
}

for (const id of expectedCases) {
  if (!seen.has(id)) fail(`Missing UAT case: ${id}`);
}

console.log(JSON.stringify({
  status: "passed",
  evidence: path.relative(root, file).replaceAll("\\", "/"),
  cases: artifact.cases.length,
}, null, 2));
