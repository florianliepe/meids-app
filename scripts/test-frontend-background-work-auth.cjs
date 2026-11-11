const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");
const source = app.match(/function knowledgeAccessHeaders\(session = state\.authSession\) \{[\s\S]*?\n\}/)?.[0];

if (!source) throw new Error("knowledgeAccessHeaders helper is missing from frontend/app.js");

function headersFor(session) {
  const context = { session, result: null };
  vm.runInNewContext(`${source}\nresult = knowledgeAccessHeaders(session);`, context);
  return { ...context.result };
}

test("background status polling omits Authorization when no scoped token exists", () => {
  assert.deepEqual(headersFor({}), {});
});

test("background status polling uses the scoped knowledge token as Bearer authorization", () => {
  assert.deepEqual(headersFor({ knowledge_access_token: "  signed-token  " }), {
    Authorization: "Bearer signed-token",
  });
});
