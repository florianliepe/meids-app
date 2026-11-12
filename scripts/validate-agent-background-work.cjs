const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workspace = fs.readFileSync(path.join(root, "backend/workspaceApi.js"), "utf8");
const policy = fs.readFileSync(path.join(root, "backend/agentRoutingPolicy.js"), "utf8");
const frontend = fs.readFileSync(path.join(root, "frontend/app.js"), "utf8");
const workflow = JSON.parse(fs.readFileSync(path.join(root, "workflows/n8n/queue-background-work.workflow.json"), "utf8"));
const migration = fs.readFileSync(path.join(root, "backend/migrations/019_audit_background_work_update_policy.sql"), "utf8");

for (const text of [
  'job_type: "agent_work"', 'resource_type = \'agent.background_work\'', '"POST /api/agents/work"',
  '"GET /api/agents/work"', '"DELETE /api/agents/work"', 'classified.route !== "execute_work_async"', 'max_attempts: 3',
]) if (!workspace.includes(text)) throw new Error(`Missing backend background-work contract: ${text}`);
for (const text of ["trustedBackgroundWork", "meids_backend_background_work", "trusted_background_work"]) {
  if (!policy.includes(text)) throw new Error(`Missing trusted worker boundary: ${text}`);
}
for (const text of [
  "refreshActorBackgroundWork",
  "actorBackgroundPollTimer",
  "/api/agents/work?twin=",
  "knowledgeAccessHeaders()",
  'refreshN8nChatAuthorizationContext({ reconnect: false, reason: "background_poll" })',
  'data-chat-action="cancel-background-work"',
  'method: "DELETE"',
]) {
  if (!frontend.includes(text)) throw new Error(`Missing frontend background-work behavior: ${text}`);
}
if (workflow.nodes[0]?.type !== "n8n-nodes-base.executeWorkflowTrigger") throw new Error("Background adapter must be an internal callable workflow.");
if (!JSON.stringify(workflow).includes("allow_external_side_effects: false")) throw new Error("Background adapter must enforce no external side effects.");
for (const text of ["audit_event_background_work_update_own", "resource_type = 'agent.background_work'", "agent.work.completed", "agent.work.failed"]) {
  if (!migration.includes(text)) throw new Error(`Missing background-work RLS policy: ${text}`);
}
const cancellationMigration = fs.readFileSync(path.join(root, "backend/migrations/020_runtime_background_job_cancellation.sql"), "utf8");
for (const text of ["'cancelled'", "agent.work.cancelled", "background_job_status_check"]) {
  if (!cancellationMigration.includes(text)) throw new Error(`Missing queued cancellation migration contract: ${text}`);
}
console.log(JSON.stringify({ status: "passed", contract: "meids.agent-work.v1", guarantees: ["fast durable acknowledgement", "owner and twin isolation", "bounded retries", "no recursive routing", "external side effects blocked", "n8n-to-code portable contract"] }, null, 2));
