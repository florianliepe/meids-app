const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const backend = read("backend/workspaceApi.js");
const app = read("frontend/app.js");
const html = read("frontend/index.html");
const architecture = read("docs/architecture/actor-butler-skill-definition.md");

const checks = [
  [backend.includes('POST /api/skills/propose'), "missing Butler proposal route"],
  [backend.includes('POST /api/skills/update'), "missing governed update route"],
  [backend.includes('POST /api/skills/retire'), "missing governed retirement route"],
  [backend.includes('POST /api/skills/elicit'), "legacy elicit adapter was removed"],
  [backend.includes('POST /api/skills/decompose'), "legacy decompose adapter was removed"],
  [backend.includes('POST /api/skills/run'), "existing skill executor route was removed"],
  [backend.includes('approval_policy: "never_auto_approve_generated_skills"'), "generated skills can bypass approval"],
  [backend.includes('action === "archive"'), "legacy archive adapter was removed"],
  [backend.includes('revision_history'), "skill revision history is missing"],
  [backend.includes('preservesApprovedRuntime'), "approved runtime is not preserved while a revision is pending"],
  [backend.includes('pending_revision'), "pending skill revisions are not isolated from the active version"],
  [backend.includes('retirement_reason'), "retirement evidence is missing"],
  [app.includes('postJson("/api/skills/propose"'), "Actor/Butler proposal is not persisted"],
  [app.includes('decision: "create_skill"'), "Actor create-skill routing is missing"],
  [app.includes('target_agent: "agentic_butler"'), "Actor does not route capability creation to Butler"],
  [app.includes('postJson("/api/skills/update"'), "Skills UI cannot stage revisions"],
  [app.includes('postJson("/api/skills/retire"'), "Skills UI cannot retire definitions"],
  [html.includes("Define with Actor Twin"), "Skills UI does not direct creation to Actor Twin"],
  [html.includes('id="updateSkillBtn"'), "Skills UI is missing update control"],
  [html.includes('id="retireSkillBtn"'), "Skills UI is missing retirement control"],
  [!html.includes('id="elicitSkillBtn"'), "legacy manual skill creator is still visible"],
  [!html.includes('id="runSkillBtn"'), "Skills registry still duplicates Actor-led execution"],
  [architecture.includes("Can a task agent create another task agent?"), "recursive-agent challenger decision is undocumented"],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) {
  console.error(`Actor/Butler skill definition contract failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(`Actor/Butler skill definition contract passed (${checks.length} checks).`);
