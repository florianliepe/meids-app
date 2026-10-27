const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { createBuildInfo, readBuildInfo, validateBuildInfo } = require("../backend/buildInfo");
const env = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "florianliepe/meids-app", GITHUB_SHA: "a".repeat(40), GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2", SECRET_FOR_TEST: "must-not-leak" };

test("CI manifests expose only exact revision and workflow identity", () => {
  const value = createBuildInfo("backend", env);
  assert.equal(value.commit, env.GITHUB_SHA); assert.equal(value.runAttempt, 2);
  assert.equal(JSON.stringify(value).includes(env.SECRET_FOR_TEST), false);
  assert.equal(validateBuildInfo({ ...value, secret: "hidden" }, "backend"), null);
  assert.equal(validateBuildInfo(value, "frontend"), null);
  assert.throws(() => createBuildInfo("backend", { ...env, GITHUB_SHA: "main" }));
  assert.throws(() => createBuildInfo("frontend", { ...env, GITHUB_RUN_ID: "0" }));
  assert.deepEqual(createBuildInfo("frontend", {}), { schemaVersion: 1, available: false, component: "frontend" });
});

test("missing, malformed and oversized manifests never fall back to a guessed revision", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meids-build-info-")); const file = path.join(dir, "manifest.json");
  try {
    assert.equal(readBuildInfo(file).available, false);
    fs.writeFileSync(file, "not JSON"); assert.equal(readBuildInfo(file).available, false);
    fs.writeFileSync(file, " ".repeat(4097)); assert.equal(readBuildInfo(file).available, false);
    fs.writeFileSync(file, JSON.stringify(createBuildInfo("backend", env))); assert.equal(readBuildInfo(file).commit, env.GITHUB_SHA);
  } finally {
    if (path.resolve(path.dirname(dir)) !== path.resolve(os.tmpdir())) throw new Error("Unexpected test directory");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the actual backend route serves the packaged manifest without authentication or knowledge writes", async () => {
  const file = path.resolve(__dirname, "../backend/build-info.json"); const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
  const { routeRequest } = require("../backend/server"); const server = http.createServer(routeRequest);
  try {
    fs.writeFileSync(file, JSON.stringify(createBuildInfo("backend", env)));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/build-info`;
    const response = await fetch(url); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).commit, env.GITHUB_SHA);
    fs.writeFileSync(file, "{}"); const unavailable = await fetch(url); assert.equal(unavailable.status, 503); assert.equal((await unavailable.json()).available, false);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    if (before) fs.writeFileSync(file, before); else if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});
