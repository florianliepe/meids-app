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
  assert.match(submit, /const requestScope = nativeActorChatScope\(\)/);
  assert.match(submit, /requestScopeKey !== nativeActorChatScopeKey\(\)/);
  assert.match(submit, /apiRequestJson\("\/api\/agents\/chat"/);
  assert.match(submit, /const authorizationHeaders = knowledgeAccessHeaders\(\)/);
  assert.match(submit, /headers: \{ "Content-Type": "application\/json", \.\.\.authorizationHeaders \}/);
  assert.match(submit, /request_id: requestId/);
  assert.match(submit, /conversation_id: conversationId/);
  assert.match(submit, /twin_id: requestScope\.twinId/);
  assert.doesNotMatch(submit, /session_id: n8nChatSessionId\(\)/);
  assert.match(submit, /state\.nativeActorChatSubmitting = true[\s\S]{0,700}await ensureFreshKnowledgeAccessContext\(\)/);
  assert.match(submit, /restoreDraft = true/);
  assert.match(submit, /if \(restoreDraft && requestScopeKey === nativeActorChatScopeKey\(\) && nextInput\) nextInput\.value = message/);
  assert.doesNotMatch(submit, /recoverN8nAuthContext\(\)[\s\S]{0,300}apiRequestJson\("\/api\/agents\/chat"/);
});

test("Azure-native conversation ids use a provider-scoped namespace instead of n8n Simple Memory keys", () => {
  const legacy = app.slice(app.indexOf("function n8nChatSessionId()"), app.indexOf("function nativeActorChatScope()"));
  const native = app.slice(app.indexOf("function nativeActorChatScope()"), app.indexOf("function renderN8nInteractionContext()"));
  assert.match(legacy, /meids:n8n-session:/);
  assert.match(native, /meids:azure-native-conversation:v1:/);
  assert.match(native, /conversationId = `azchat_v1_/);
  assert.match(native, /\^azchat_v1_/);
  assert.doesNotMatch(native, /meids:n8n-session:/);
});

function nativeChatFixture() {
  const submit = app.slice(
    app.indexOf("async function submitNativeActorChat("),
    app.indexOf("function actorBackgroundStatusLabel("),
  );
  const scopeHelpers = app.slice(
    app.indexOf("function nativeActorChatScope()"),
    app.indexOf("function renderN8nInteractionContext()"),
  );
  const messagesHelper = app.slice(
    app.indexOf("function nativeActorChatMessages("),
    app.indexOf("function actorChatReadableText("),
  );
  const storage = new Map();
  const calls = [];
  const input = { value: "synthetic draft", focus() {} };
  const button = {};
  const status = {};
  const context = {
    state: {
      activeTwin: "a",
      authSession: { tenant: { id: "t" }, user: { id: "u" } },
      actorBackgroundJobs: [],
      nativeActorChatSubmitting: false,
    },
    window: { localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) } },
    crypto: { randomUUID: () => "11111111-2222-4333-8444-555555555555" },
    calls,
    renderNativeActorChat() {},
    $: (selector) => selector === "#nativeActorChatInput" ? input : status,
    ensureFreshKnowledgeAccessContext: async () => {},
    knowledgeAccessHeaders: () => ({ Authorization: "Bearer synthetic-only" }),
    apiRequestJson: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { output: { answer: "synthetic answer" } };
    },
    actorChatReadableText: (value) => value,
    blockedN8nAuthContext: () => false,
    recoverN8nAuthContext: async () => {},
    compactError: (value) => value,
    renderActorBackgroundWork() {},
    scheduleActorBackgroundWorkPolling() {},
  };
  vm.createContext(context);
  vm.runInContext(`${scopeHelpers}\n${messagesHelper}\n${submit}`, context);
  return {
    context,
    calls,
    input,
    storage,
    event: {
      preventDefault() {},
      currentTarget: { querySelector: (selector) => selector === "textarea" ? input : button },
    },
  };
}

test("switching twin during auth preflight never submits the prior twin's draft", async () => {
  const fixture = nativeChatFixture();
  fixture.context.ensureFreshKnowledgeAccessContext = async () => { fixture.context.state.activeTwin = "b"; };
  await fixture.context.submitNativeActorChat(fixture.event);
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.context.nativeActorChatMessages("t:u:b").length, 0);
  assert.match(fixture.context.nativeActorChatMessages("t:u:a").at(-1).text, /active twin changed/i);
});

test("a late response remains in the request twin's conversation", async () => {
  const fixture = nativeChatFixture();
  fixture.context.apiRequestJson = async (url, options) => {
    fixture.calls.push({ url, body: JSON.parse(options.body) });
    fixture.context.state.activeTwin = "b";
    return { output: { answer: "answer for twin a" } };
  };
  await fixture.context.submitNativeActorChat(fixture.event);
  assert.equal(fixture.context.nativeActorChatMessages("t:u:b").length, 0);
  assert.equal(fixture.context.nativeActorChatMessages("t:u:a").at(-1).text, "answer for twin a");
});

test("tampered legacy values cannot become Azure-native conversation ids", () => {
  const fixture = nativeChatFixture();
  const key = "meids:azure-native-conversation:v1:t:u:a";
  fixture.storage.set(key, "legacy-n8n-id");
  const conversationId = fixture.context.nativeActorConversationId();
  assert.match(conversationId, /^azchat_v1_/);
  assert.notEqual(conversationId, "legacy-n8n-id");
  assert.equal(fixture.storage.get(key), conversationId);
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
