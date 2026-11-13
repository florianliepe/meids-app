const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  selectRuntimeProvider,
  assertRuntimeProvider,
} = require("../backend/agentRuntimeSelection");

test("selects one provider from the runtime flag and route allowlist", () => {
  assert.equal(selectRuntimeProvider({ mode: "n8n", route: "answer_direct" }), "n8n");
  assert.equal(selectRuntimeProvider({ mode: "azure_native", route: "answer_direct" }), "azure_native");
  assert.equal(selectRuntimeProvider({ mode: "hybrid", route: "retrieve_knowledge", azureRoutes: "answer_direct,retrieve_knowledge" }), "azure_native");
  assert.equal(selectRuntimeProvider({ mode: "hybrid", route: "execute_work_sync", azureRoutes: ["answer_direct"] }), "n8n");
});

test("a queued provider remains pinned across a global rollback", () => {
  const queued = {
    runtime_provider: selectRuntimeProvider({ mode: "azure_native", route: "execute_work_sync" }),
  };
  const newWorkAfterRollback = selectRuntimeProvider({ mode: "n8n", route: "execute_work_sync" });
  assert.equal(assertRuntimeProvider(queued.runtime_provider), "azure_native");
  assert.equal(newWorkAfterRollback, "n8n");
});

test("invalid or missing explicit providers fail closed", () => {
  assert.throws(() => assertRuntimeProvider("hybrid"), /Unsupported agent runtime provider/);
  assert.throws(() => assertRuntimeProvider(""), /Unsupported agent runtime provider/);
});

test("background work persists and consumes the immutable provider pin", () => {
  const root = path.resolve(__dirname, "..");
  const workspace = fs.readFileSync(path.join(root, "backend", "workspaceApi.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8");
  assert.match(workspace, /payload: \{ mapping, request: queuedRequest, queued, runtime_provider: runtimeProvider \}/);
  assert.match(workspace, /runtime_provider: runtimeProvider,/);
  assert.match(workspace, /runtimeProviderForJob\(job, "execute_work_sync"\)/);
  assert.match(workspace, /executeAgent\("actor_twin", request, \{[\s\S]{0,120}runtimeProvider,/);
  assert.match(server, /payload: \{ mapping, learning: safePayload, runtime_provider: "azure_native" \}/);
  assert.match(server, /job_type: "learning_post_turn",[\s\S]{0,100}runtime_provider: "azure_native"/);
  assert.match(server, /if \(pinnedProvider[\s\S]{0,180}MEIDS_AGENT_AZURE_FALLBACK_TO_N8N/);
});
