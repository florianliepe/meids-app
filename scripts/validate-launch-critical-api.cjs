const fs = require("node:fs");
const path = require("node:path");
const { qualityAssessment, REVIEW_FROM_UI } = require("../backend/workspaceApi");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "contracts", "backend", "launch-critical-api.json"), "utf8"));
const source = ["backend/server.js", "backend/workspaceApi.js"]
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");
const auditUpdateMigration = fs.readFileSync(
  path.join(root, "backend", "migrations", "015_audit_skill_run_update_policy.sql"),
  "utf8",
);

const missing = manifest.routes.filter((route) => {
  const [method, pathname] = route.split(" ");
  return !source.includes(`\"${method} ${pathname}\"`)
    && !(source.includes(`req.method === \"${method}\"`) && source.includes(`url.pathname === \"${pathname}\"`))
    && !(pathname === "/api/agents/actor-twin/chat" && source.includes("PATH_TO_AGENT[url.pathname]"));
});

if (missing.length) {
  process.stderr.write(`Missing launch-critical backend routes:\n${missing.map((item) => `- ${item}`).join("\n")}\n`);
  process.exit(1);
}

const incomplete = qualityAssessment({ transcript: "We do a process for invoices.", replies: [] });
if (incomplete.ready || !incomplete.next_question) throw new Error("Circular interview must ask a follow-up for incomplete knowledge.");
const complete = qualityAssessment({
  transcript: "The topic is invoice approval. We need it because financial control prevents duplicate payment. First the requester submits evidence, then the responsible finance owner checks it and the controller approves. The result is an auditable payment decision.",
  replies: ["The finance owner is responsible and the requester is informed."],
});
if (!complete.ready || complete.eligibility_score < 0.7) throw new Error("Complete circular interview sample must pass the quality gate.");
if (complete.eligibility_score > 1 || complete.consistency_score > 1) {
  throw new Error("Voice quality scores must use the frontend's 0..1 contract.");
}
if (!Number.isInteger(complete.word_count) || complete.word_count < 45) {
  throw new Error("Voice quality assessment must expose the assessed word count.");
}
if (REVIEW_FROM_UI["pending-review"] !== "review_needed" || REVIEW_FROM_UI["needs-rework"] !== "updated") {
  throw new Error("Frontend and database review states are not mapped correctly.");
}
if (!source.includes("routing_policy: \"call_n8n_workflow_tool_first\"")) {
  throw new Error("Interactive skill execution must preserve the Call n8n Workflow Tool hierarchy policy.");
}
for (const required of [
  'action: "sendMessage"',
  'sessionId:',
  'chatInput:',
  'knowledgeAccessToken',
  'action IN (\'skill.run.queued\', \'skill.run\', \'skill.run.failed\')',
  'call Agentic Butler first',
]) {
  if (!source.includes(required)) throw new Error(`Backend-driven Actor Twin calls or skill-run history missing ${required}.`);
}
for (const required of ["FOR UPDATE", "actor_user_id = app_security.setting('app.user_id')", "resource_type = 'agent.skill_run'", "GRANT UPDATE ON audit.event"]) {
  if (!auditUpdateMigration.includes(required)) throw new Error(`Skill-run ledger migration missing ${required}.`);
}

process.stdout.write(`Launch-critical API contract valid: ${manifest.routes.length} routes.\n`);
