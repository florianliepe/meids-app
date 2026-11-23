const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(process.argv[2] || "frontend");
const port = Number(process.env.MEIDS_SKILL_REGISTRY_QA_PORT || 8796);
const host = "127.0.0.1";

function contentType(filePath) {
  return {
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  }[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function startServer() {
  const server = http.createServer((request, response) => {
    const urlPath = decodeURIComponent(String(request.url || "/").split("?")[0]);
    const requested = urlPath === "/" ? "/index.html" : urlPath;
    const filePath = path.join(root, requested);
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(404);
        response.end("not found");
        return;
      }
      response.writeHead(200, { "Content-Type": contentType(filePath) });
      response.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

const skill = {
  skill_id: "invoice-guidance-qa",
  name: "Invoice guidance",
  description: "Review invoice evidence and prepare grounded guidance.",
  status: "approved",
  lifecycle_state: "approved",
  risk_class: "medium",
  version: "1.2.0",
  spec: {
    name: "Invoice guidance",
    description: "Review invoice evidence and prepare grounded guidance.",
    origin: { channel: "actor_twin_agentic_butler" },
    task_agents: [{
      name: "invoice-guidance-task-agent",
      purpose: "Review invoice evidence.",
      tools: ["knowledge_retrieval"],
      system_instruction: "Use reviewed invoice evidence and return a bounded recommendation.",
      boundary: "Do not approve, send, or alter an invoice.",
    }],
  },
};

async function run() {
  let playwright;
  try {
    playwright = require("playwright");
  } catch (error) {
    throw new Error(`Playwright is required. Set NODE_PATH to the bundled node_modules. Original error: ${error.message}`);
  }
  const server = await startServer();
  const browser = await playwright.chromium.launch({ headless: true });
  const results = [];
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const pageErrors = [];
      let updatePayload = null;
      let retirePayload = null;
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem("intellectualTwin.landing.dismissed", "true");
      });
      await page.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
      await page.route("**/api/skills/detail**", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...skill,
          skill,
          config: {
            status: skill.status,
            actor_agent: { persona_ref: "florian" },
            orchestrator: { mode: "direct_task_agent", max_steps: 8 },
            task_agents: skill.spec.task_agents,
          },
          lint: { valid: true, errors: [] },
        }),
      }));
      await page.route("**/api/skills/update", async (route) => {
        updatePayload = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "pending_approval", skill: { ...skill, status: "pending_approval", version: "1.2.1" } }) });
      });
      await page.route("**/api/skills/retire", async (route) => {
        retirePayload = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "retired", skill: { ...skill, status: "archived", lifecycle_state: "retired" } }) });
      });
      await page.route("**/api/skills?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ skills: [skill] }) }));
      await page.goto(`http://${host}:${port}/?view=skills`, { waitUntil: "networkidle" });
      await page.waitForSelector("#skillCatalog .skill-select");
      await page.locator("#skillCatalog .skill-select").click();
      await page.waitForSelector("#skillEditInstruction:not([disabled])");

      const legacyCreatorCount = await page.locator("#elicitSkillBtn, #skillDescriptionInput, #runSkillBtn").count();
      const actorCreationText = await page.locator("#skills").innerText();
      const instruction = await page.locator("#skillEditInstruction").inputValue();
      const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

      if (viewport.width > 500) {
        await page.locator("#skillEditDescription").fill("Updated governed invoice guidance.");
        await page.locator("#skillEditReason").fill("Tighten evidence and action boundaries.");
        await page.locator("#updateSkillBtn").click();
        await page.waitForTimeout(100);
        await page.locator("#retireSkillBtn").click();
        await page.locator("#decisionInput").fill("Superseded by the approved finance capability.");
        await page.locator("#decisionConfirmBtn").click();
        await page.waitForTimeout(100);
      }

      const failures = [];
      if (legacyCreatorCount !== 0) failures.push("legacy authoring or run controls remain visible");
      if (!actorCreationText.includes("Define with Actor Twin")) failures.push("Actor-led creation action missing");
      if (!instruction.includes("reviewed invoice evidence")) failures.push("task-agent system instruction was not rendered");
      if (horizontalOverflow) failures.push("horizontal overflow detected");
      if (pageErrors.length) failures.push(`page errors: ${pageErrors.join("; ")}`);
      if (viewport.width > 500 && (!updatePayload?.change_reason || updatePayload.task_agent?.tools?.[0] !== "knowledge_retrieval")) failures.push("governed update payload invalid");
      if (viewport.width > 500 && !retirePayload?.rationale) failures.push("retirement reason was not submitted");
      results.push({ viewport, status: failures.length ? "failed" : "passed", failures });
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter((result) => result.status === "failed");
  if (failed.length) {
    console.error(JSON.stringify(results, null, 2));
    process.exit(1);
  }
  console.log(`Skill registry browser QA passed (${results.length} viewports).`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
