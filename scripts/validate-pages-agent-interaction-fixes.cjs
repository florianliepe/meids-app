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

requireSource(
  /function reconcileActorRouteFromAnswer/,
  "Actor Twin must reconcile known n8n route-mismatch responses back to answer_direct.",
);

requireSource(
  /function shouldRequireHumanApprovalForAgentResult/,
  "Agent approvals must be governed by explicit skill-creation or external-write criteria.",
);

if (/renderAgentResponseRouteCard\(result\)/.test(source)) {
  fail("Actor Twin chat card must not render internal route diagnostics in the lean chat surface.");
}

const workflowFiles = [
  path.join(root, "workflows", "n8n", "implementations", "actor-twin-direct-orchestrator.uat-live-urls.workflow.json"),
  path.join(root, "workflows", "n8n", "implementations", "actor-twin-direct-orchestrator.workflow.json"),
  path.join(root, "workflows", "n8n", "agentic-butler.workflow.json"),
  path.join(root, "workflows", "n8n", "implementations", "agentic-butler.ai-agent.workflow.json"),
];

for (const workflowFile of workflowFiles) {
  if (!fs.existsSync(workflowFile)) continue;
  const raw = fs.readFileSync(workflowFile, "utf8");
  if (workflowFile.includes("actor-twin-direct-orchestrator")) {
    if (!/const actorRoute = normalizeDecision/.test(raw)) {
      fail(`${path.relative(root, workflowFile)} must normalize Actor Twin AI route before context fallback.`);
    }
    if (/const explicit = input\.context\?\.route_decision \|\| normalizeDecision/.test(raw)) {
      fail(`${path.relative(root, workflowFile)} must not let context route override Actor Twin AI route.`);
    }
    if (!/identity, purpose, self-description/.test(raw)) {
      fail(`${path.relative(root, workflowFile)} must instruct identity/purpose questions to answer directly.`);
    }
    if (/delegate\?\.status === 'approval_required'/.test(raw)) {
      fail(`${path.relative(root, workflowFile)} must not treat every delegated approval_required status as final approval.`);
    }
    if (/externalWriteIntent|external write actions/.test(raw)) {
      fail(`${path.relative(root, workflowFile)} must not gate Actor Twin delegation on external-write wording.`);
    }
  }
  if (workflowFile.includes("agentic-butler")) {
    if (!/status: approvalRequired \? 'approval_required' : 'completed'/.test(raw)) {
      fail(`${path.relative(root, workflowFile)} must allow autonomous completed Butler runs.`);
    }
    if (!/Only return approval_required when creating a new skill/.test(raw) || /external write actions/.test(raw)) {
      fail(`${path.relative(root, workflowFile)} must limit Butler approval to new skill or generated agent activation.`);
    }
  }
}

console.log(JSON.stringify({
  status: process.exitCode ? "failed" : "passed",
  checks: [
    "plain_questions_do_not_auto_activate_butler",
    "ordinary_answer_text_not_parsed_as_delegation",
    "actor_delegate_result_not_double_called",
    "static_skill_elicitation_fallback",
    "static_trace_detail_fallback",
    "actor_route_mismatch_reconciliation",
    "new_skill_or_agent_only_approval_boundary",
    "lean_actor_chat_no_route_diagnostics",
    "n8n_actor_route_precedence",
    "n8n_butler_autonomous_runs",
  ],
}, null, 2));
