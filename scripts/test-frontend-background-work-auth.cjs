const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");
const source = app.match(/function knowledgeAccessHeaders\(session = state\.authSession\) \{[\s\S]*?\n\}/)?.[0];
const activeViewSource = app.match(/function currentWorkspaceView\(\) \{[\s\S]*?\n\}/)?.[0];

if (!source) throw new Error("knowledgeAccessHeaders helper is missing from frontend/app.js");
if (!activeViewSource) throw new Error("currentWorkspaceView helper is missing from frontend/app.js");

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
