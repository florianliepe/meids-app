const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const frontend = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");
const backend = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8");
const patcher = fs.readFileSync(path.join(root, "scripts", "apply-n8n-actor-grounding-trace-hardening.cjs"), "utf8");

assert.match(frontend, /answerDirectFirst:\s*false/);
assert.match(frontend, /evidenceFirst:\s*true/);
assert.match(frontend, /Never invent a personal or organizational fact/);
assert.doesNotMatch(frontend, /setTimeout\(async \(\) => \{\s*await loadAuthSession\(\);\s*reloadN8nChatContext\(\)/);
assert.match(backend, /POST" && url\.pathname === "\/api\/agents\/post-answer"/);
assert.match(backend, /requireKnowledgeRequestMapping\(req, body\)/);
assert.match(backend, /A gateway key alone does not enable speech-to-text/);
assert.doesNotMatch(backend, /\|\| "gpt-4o-mini-transcribe"/);
assert.match(patcher, /reviewed\/approved knowledge as evidence/);
assert.match(patcher, /Persist post-answer trace/);
assert.match(patcher, /Preserve Actor answer/);
assert.match(patcher, /post_turn_learning/);

console.log(JSON.stringify({
  status: "passed",
  checks: ["evidence-first metadata", "non-destructive refresh", "scoped post-answer trace", "truthful STT readiness", "answer-preserving n8n branch"],
}, null, 2));
