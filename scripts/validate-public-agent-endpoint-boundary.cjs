const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const runtime = fs.readFileSync(path.join(root, "frontend/runtime-config.js"), "utf8");
const asset = JSON.parse(fs.readFileSync(path.join(root, "frontend/assets/agent-runtime-config.json"), "utf8"));
const builder = fs.readFileSync(path.join(root, "scripts/build-pages-static.cjs"), "utf8");
const assetBuilder = fs.readFileSync(path.join(root, "scripts/write-pages-agent-runtime-config.cjs"), "utf8");

assert.match(runtime, /n8nChatWebhookUrl:\s*""/, "The browser must not expose an n8n chat endpoint");
assert.match(runtime, /n8nActorTwinWebhookUrl:\s*""/, "The browser must not expose an n8n Actor endpoint");
assert.match(runtime, /nativeActorChatEnabled:\s*true/, "The authenticated native Actor composer must be enabled");
assert.match(runtime, /n8nKnowledgeFabricWebhookUrl:\s*""/);
assert.match(runtime, /n8nAgenticButlerWebhookUrl:\s*""/);
assert.equal(asset.n8nAgentWebhooks.knowledge_fabric_agent, "");
assert.equal(asset.n8nAgentWebhooks.agentic_butler, "");
assert.equal(asset.n8nAgentWebhooks.actor_twin, "");
assert.equal(asset.n8nActorTwinWebhookUrl, "");
assert.equal(asset.n8nKnowledgeFabricWebhookUrl, "");
assert.equal(asset.n8nAgenticButlerWebhookUrl, "");
assert.match(builder, /const knowledgeUrl = "";/);
assert.match(builder, /const butlerUrl = "";/);
assert.match(assetBuilder, /const knowledgeUrl = "";/);
assert.match(assetBuilder, /const butlerUrl = "";/);

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "meids-public-agent-boundary-"));
try {
  const forbiddenWorkerUrl = "https://forbidden-worker.example/webhook/internal";
  const build = spawnSync(process.execPath, [path.join(root, "scripts/build-pages-static.cjs"), "--output", buildDir, "--no-smoke"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL: forbiddenWorkerUrl,
      GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL: forbiddenWorkerUrl,
      GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL: forbiddenWorkerUrl,
      GH_PAGES_N8N_CHAT_WEBHOOK_URL: forbiddenWorkerUrl,
    },
  });
  assert.equal(build.status, 0, `Static build failed:\n${build.stdout}\n${build.stderr}`);
  const builtRuntime = fs.readFileSync(path.join(buildDir, "runtime-config.js"), "utf8");
  const builtAsset = fs.readFileSync(path.join(buildDir, "assets/agent-runtime-config.json"), "utf8");
  assert.equal(builtRuntime.includes(forbiddenWorkerUrl), false, "Built runtime config leaked a worker URL");
  assert.equal(builtAsset.includes(forbiddenWorkerUrl), false, "Built agent asset leaked a worker URL");
  assert.match(builtRuntime, /n8nChatWebhookUrl:\s*""/);
  assert.match(builtRuntime, /n8nActorTwinWebhookUrl:\s*""/);
  assert.match(builtRuntime, /n8nKnowledgeFabricWebhookUrl:\s*""/);
  assert.match(builtRuntime, /n8nAgenticButlerWebhookUrl:\s*""/);
} finally {
  fs.rmSync(buildDir, { recursive: true, force: true });
}

console.log(JSON.stringify({
  status: "passed",
  contract: "source and built browser assets expose no n8n endpoint; Actor Twin and worker agents use authenticated backend routes",
}, null, 2));
