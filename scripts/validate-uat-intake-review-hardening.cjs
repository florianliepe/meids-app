const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { qualityAssessment } = require("../backend/workspaceApi");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const backend = read("backend/workspaceApi.js");
const frontend = read("frontend/app.js");
const html = read("frontend/index.html");
const server = read("backend/server.js");

for (const route of [
  'DELETE /api/voice/concepts/drafts',
  'POST /api/voice/concepts/drafts/resolve-duplicates',
  'POST /api/concepts/revise',
]) assert.match(backend, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${route} must be implemented`);

assert.match(html, /id="voiceTranscriptEditor"/, "voice transcript must be editable");
assert.match(frontend, /originalTranscript/, "original transcript evidence must be retained");
assert.match(frontend, /detail\.content/, "knowledge review must render structured content");
assert.match(frontend, /saveConceptRevision/, "knowledge review must support corrected revisions");
assert.match(html, /id="voiceAgentHandoffBtn"[^>]*hidden/, "manual MCP handoff must be hidden from the end-user flow");
assert.match(html, /id="actorVoiceBtn"/, "Actor Twin must expose voice input");
assert.match(html, /id="actorSourceBtn"/, "Actor Twin must expose single-source intake");
assert.match(server, /proxyToN8n\(agentId, envelope, options = \{\}\)/, "n8n proxy must accept bounded per-run timeouts");
assert.match(backend, /SKILL_RUN_TIMEOUT_MS \|\| 90000/, "skill execution must default to a 90-second backend boundary");

const assessment = qualityAssessment({
  category: "personality",
  transcript: "This concept defines a biography. First verify the source, then apply the verified facts because identity questions require accuracy. The result is a grounded answer.",
  replies: ["Florian is involved.", "Nobody else is involved."],
  question_history: [
    "Who is involved, responsible, consulted, or affected?",
    "Who is involved, responsible, consulted, or affected?",
  ],
});
assert.equal(assessment.missing_dimensions.includes("who"), false, "a repeated who dimension must not trap the interview");

console.log("UAT intake and review hardening contract validated.");
