const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");
const source = app.match(/function knowledgeAccessHeaders\(session = state\.authSession\) \{[\s\S]*?\n\}/)?.[0];
const activeViewSource = app.match(/function currentWorkspaceView\(\) \{[\s\S]*?\n\}/)?.[0];
const scopeSource = app.match(/function actorBackgroundScopeKey\(\) \{[\s\S]*?\n\}/)?.[0];
const refreshSource = app.slice(
  app.indexOf("async function refreshActorBackgroundWork()"),
  app.indexOf("function scheduleActorBackgroundWorkPolling()"),
).trim();
const scheduleSource = app.slice(
  app.indexOf("function scheduleActorBackgroundWorkPolling()"),
  app.indexOf("async function askTwinViaN8n("),
).trim();

if (!source) throw new Error("knowledgeAccessHeaders helper is missing from frontend/app.js");
if (!activeViewSource) throw new Error("currentWorkspaceView helper is missing from frontend/app.js");
if (!scopeSource || !refreshSource || !scheduleSource) throw new Error("background lifecycle sources are missing from frontend/app.js");

function headersFor(session) {
  const context = { session, result: null };
  vm.runInNewContext(`${source}\nresult = knowledgeAccessHeaders(session);`, context);
  return { ...context.result };
}

function activeViewFor({ bodyView = "", navView = "", visibleView = "" } = {}) {
  const document = {
    body: { dataset: { activeView: bodyView } },
    querySelector(selector) {
      if (selector === ".nav-item.active") return navView ? { dataset: { view: navView } } : null;
      if (selector === ".view.active") return visibleView ? { id: visibleView } : null;
      return null;
    },
  };
  const context = { document, result: null };
  vm.runInNewContext(`${activeViewSource}\nresult = currentWorkspaceView();`, context);
  return context.result;
}

test("background status polling omits Authorization when no scoped token exists", () => {
  assert.deepEqual(headersFor({}), {});
});

test("background status polling uses the scoped knowledge token as Bearer authorization", () => {
  assert.deepEqual(headersFor({ knowledge_access_token: "  signed-token  " }), {
    Authorization: "Bearer signed-token",
  });
});

test("background polling recognizes the visible chat on authenticated direct entry", () => {
  assert.equal(activeViewFor({ navView: "chat", visibleView: "chat" }), "chat");
});

test("background polling prefers an explicitly selected workspace view", () => {
  assert.equal(activeViewFor({ bodyView: "graph", navView: "chat", visibleView: "chat" }), "graph");
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function lifecycleContext(requests) {
  const state = {
    activeTwin: "twin-a",
    authSession: {
      status: "authenticated",
      tenant: { id: "tenant-a" },
      user: { id: "user-a" },
      knowledge_access_token: "signed-token",
    },
    actorBackgroundJobs: [],
    actorBackgroundRequestId: 0,
  };
  const context = {
    state,
    staticPagesMode: false,
    authenticatedSession: () => state.authSession.status === "authenticated",
    currentWorkspaceView: () => "chat",
    knowledgeAccessHeaders: () => ({ Authorization: "Bearer signed-token" }),
    apiRequestJson: () => requests.shift().promise,
    blockedN8nAuthContext: () => false,
    refreshN8nChatAuthorizationContext: async () => {},
    renderCount: 0,
    renderActorBackgroundWork() { context.renderCount += 1; },
    console: { warn() {} },
  };
  vm.runInNewContext(`${scopeSource}\n${refreshSource}`, context);
  return context;
}

test("a slower status response cannot regress a newer terminal result", async () => {
  const slow = deferred();
  const fast = deferred();
  const context = lifecycleContext([slow, fast]);
  const first = context.refreshActorBackgroundWork();
  const second = context.refreshActorBackgroundWork();
  fast.resolve({ jobs: [{ status: "completed" }] });
  await second;
  slow.resolve({ jobs: [{ status: "queued" }] });
  await first;
  assert.equal(context.state.actorBackgroundJobs[0].status, "completed");
  assert.equal(context.renderCount, 1);
});

test("a response from an old twin scope is ignored", async () => {
  const pending = deferred();
  const context = lifecycleContext([pending]);
  const refresh = context.refreshActorBackgroundWork();
  context.state.activeTwin = "twin-b";
  pending.resolve({ jobs: [{ status: "completed" }] });
  await refresh;
  assert.deepEqual(context.state.actorBackgroundJobs, []);
  assert.equal(context.renderCount, 0);
});

test("leaving chat while a poll is pending does not restart the timer", async () => {
  const timers = [];
  let activeView = "chat";
  let refreshCount = 0;
  const state = {
    actorBackgroundJobs: [{ status: "queued" }],
    actorBackgroundPollTimer: null,
  };
  const context = {
    state,
    currentWorkspaceView: () => activeView,
    clearTimeout() {},
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    async refreshActorBackgroundWork() { refreshCount += 1; },
  };
  vm.runInNewContext(scheduleSource, context);
  context.scheduleActorBackgroundWorkPolling();
  assert.equal(timers[0].delay, 3_000);
  activeView = "graph";
  await timers[0].callback();
  assert.equal(refreshCount, 0);
  assert.equal(timers.length, 1);
  assert.equal(state.actorBackgroundPollTimer, null);
});
