const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appPath = path.join(root, "frontend", "app.js");
const source = fs.readFileSync(appPath, "utf8");

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function requireSource(pattern, message) {
  if (!pattern.test(source)) fail(message);
}

requireSource(
  /const executionIntent = /,
  "Router must define executionIntent explicitly.",
);

if (/const executionIntent = approvedSkillAvailable \|\|/.test(source)) {
  fail("Plain Actor Twin questions must not route to Agentic Butler only because an approved skill exists.");
}

requireSource(
  /fallbackRoute\?\.decision === "answer_direct"[\s\S]*explicitRouteMarker[\s\S]*if \(!explicitRouteMarker\) return null;/,
  "Actor text route parsing must not treat ordinary answer text as Butler/Knowledge delegation.",
);

requireSource(
  /const delegate = actorResult\.response\?\.output\?\.delegate_result;/,
  "Frontend must respect Actor Twin n8n delegated results instead of double-calling target agents.",
);

requireSource(
  /if \(staticPagesMode\) \{[\s\S]*createStaticSkillDraft/,
  "Skill elicitation must use a static Pages fallback instead of calling /api/skills/elicit.",
);

requireSource(
  /function findStaticTraceDetail/,
  "Trace review must support static/local trace lookup on GitHub Pages.",
);

console.log(JSON.stringify({
  status: process.exitCode ? "failed" : "passed",
  checks: [
    "plain_questions_do_not_auto_activate_butler",
    "ordinary_answer_text_not_parsed_as_delegation",
    "actor_delegate_result_not_double_called",
    "static_skill_elicitation_fallback",
    "static_trace_detail_fallback",
  ],
}, null, 2));
