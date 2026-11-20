const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");
const refreshPredicate = app.match(/function knowledgeAccessContextNeedsRefresh\(session = state\.authSession, minValidityMs = 60_000\) \{[\s\S]*?\n\}/)?.[0];

if (!refreshPredicate) throw new Error("Native Actor Twin auth freshness helper is missing.");

function needsRefresh(session, now = Date.now(), minValidityMs = 60_000) {
  const context = { state: { authSession: session }, Date: class extends Date { static now() { return now; } }, Number, result: null };
  vm.runInNewContext(`${refreshPredicate}\nresult = knowledgeAccessContextNeedsRefresh(state.authSession, ${minValidityMs});`, context);
  return context.result;
}

test("native Actor Twin chat sends the scoped token and a stable request id", () => {
  const submit = app.slice(
    app.indexOf("async function submitNativeActorChat("),
    app.indexOf("function actorBackgroundStatusLabel("),
  );
  assert.match(submit, /await ensureFreshKnowledgeAccessContext\(\)/);
  assert.match(submit, /apiRequestJson\("\/api\/agents\/chat"/);
  assert.match(submit, /headers: \{ "Content-Type": "application\/json", \.\.\.knowledgeAccessHeaders\(\) \}/);
  assert.match(submit, /request_id: requestId/);
  assert.match(submit, /conversation_id: nativeActorConversationId\(\)/);
  assert.doesNotMatch(submit, /session_id: n8nChatSessionId\(\)/);
  assert.match(submit, /state\.nativeActorChatSubmitting = true[\s\S]{0,500}await ensureFreshKnowledgeAccessContext\(\)/);
  assert.match(submit, /restoreDraft = true/);
  assert.match(submit, /if \(restoreDraft && nextInput\) nextInput\.value = message/);
  assert.doesNotMatch(submit, /recoverN8nAuthContext\(\)[\s\S]{0,300}apiRequestJson\("\/api\/agents\/chat"/);
});

test("Azure-native conversation ids use a provider-scoped namespace instead of n8n Simple Memory keys", () => {
  const legacy = app.slice(app.indexOf("function n8nChatSessionId()"), app.indexOf("function nativeActorConversationId()"));
  const native = app.slice(app.indexOf("function nativeActorConversationId()"), app.indexOf("function renderN8nInteractionContext()"));
  assert.match(legacy, /meids:n8n-session:/);
  assert.match(native, /meids:azure-native-conversation:v1:/);
  assert.match(native, /conversationId = `azchat_v1_/);
  assert.doesNotMatch(native, /meids:n8n-session:/);
});

test("missing, malformed, or nearly expired knowledge context refreshes before send", () => {
  const now = Date.parse("2026-11-20T09:00:00.000Z");
  assert.equal(needsRefresh({}, now), true);
  assert.equal(needsRefresh({ knowledge_access_token: "token", knowledge_access_expires_at: "invalid" }, now), true);
  assert.equal(needsRefresh({ knowledge_access_token: "token", knowledge_access_expires_at: "2026-11-20T09:00:30.000Z" }, now), true);
});

test("valid scoped context is reused without an unnecessary session call", () => {
  const now = Date.parse("2026-11-20T09:00:00.000Z");
  assert.equal(needsRefresh({
    knowledge_access_token: "token",
    knowledge_access_expires_at: "2026-11-20T10:00:00.000Z",
  }, now), false);
});
