const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("frontend/app.js");
const html = read("frontend/index.html");
const styles = read("frontend/styles.css");
const prompts = [
  "prompts/actor-twin/system.md",
  "prompts/agentic-butler/system.md",
  "prompts/skill-orchestrator/system.md",
  "prompts/task-agent/system.md",
  "prompts/critical-faculty/system.md",
  "prompts/learning-agent/system.md",
].map(read).join("\n");

const assertions = [
  [html.includes('rel="preconnect" href="https://cdn.jsdelivr.net"'), "n8n chat CDN is preconnected"],
  [html.includes('rel="preconnect" href="https://eraneos-agentic-platform.azurewebsites.net"'), "n8n runtime is preconnected"],
  [app.includes("Understanding your request"), "immediate progress copy exists"],
  [app.includes("Checking reviewed knowledge"), "knowledge progress phase exists"],
  [app.includes("Coordinating the right specialist"), "routing progress phase exists"],
  [app.includes("Still working; no need to resubmit"), "extended wait guidance exists"],
  [app.includes("ACTOR_CHAT_LATENCY_SAMPLE_LIMIT = 20"), "latency samples are bounded"],
  [app.includes('outcome: String(outcome || "completed")'), "latency telemetry stores outcome only"],
  [!app.includes("chatInput: query,\n      duration_ms"), "latency telemetry is not attached to request content"],
  [app.includes('input.disabled = busy'), "duplicate submission guard remains active"],
  [app.includes('mount.setAttribute("aria-busy", String(busy))'), "busy state is exposed accessibly"],
  [styles.includes('.actor-chat-status[data-phase="extended"]'), "extended progress has a stable visual state"],
  [prompts.includes("return direct answers within 10 seconds"), "Actor Twin direct-answer budget is explicit"],
  [prompts.includes("complete nested route within 60 seconds"), "nested orchestration budget is explicit"],
  [prompts.includes("Target one Task Agent call"), "Skill Orchestrator defaults to one worker"],
  [prompts.includes("Never delay the user-facing answer"), "Learning remains post-turn for routine work"],
];

const failed = assertions.filter(([ok]) => !ok);
for (const [ok, label] of assertions) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
}

if (failed.length) {
  process.exitCode = 1;
} else {
  console.log(`Validated ${assertions.length} agent-interaction performance safeguards.`);
}
