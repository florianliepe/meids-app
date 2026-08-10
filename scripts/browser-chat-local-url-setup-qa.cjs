const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(process.argv[2] || "frontend");
const outDir = path.resolve(process.argv[3] || path.join("docs", "visual-qa", "chat-local-url-setup"));
const port = Number(process.env.MEIDS_CHAT_URL_QA_PORT || 8793);
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

async function run() {
  if (!fs.existsSync(path.join(root, "index.html"))) {
    throw new Error(`Frontend root not found or missing index.html: ${root}`);
  }
  let playwright;
  try {
    playwright = require("playwright");
  } catch (error) {
    throw new Error(`Playwright is required. Set NODE_PATH to the bundled node_modules. Original error: ${error.message}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const server = await startServer();
  const browser = await playwright.chromium.launch({ headless: true });
  const cases = [
    { name: "chat-local-url-desktop-dark", width: 1440, height: 1000 },
    { name: "chat-local-url-mobile-dark", width: 390, height: 900 },
  ];
  const results = [];

  try {
    for (const qaCase of cases) {
      const page = await browser.newPage({ viewport: { width: qaCase.width, height: qaCase.height } });
      await page.addInitScript(() => {
        window.localStorage.setItem("intellectualTwin.theme", "dark");
        window.localStorage.setItem("intellectualTwin.landing.dismissed", "true");
        window.localStorage.removeItem("intellectualTwin.agentWebhookOverrides");
      });
      await page.goto(`http://${host}:${port}/?view=chat`, { waitUntil: "networkidle" });
      await page.waitForSelector(".chat-runtime-local-overrides .agent-webhook-local-override", { timeout: 10000 });

      const count = await page.locator(".chat-runtime-local-overrides .agent-webhook-local-override").count();
      const labels = await page.locator(".chat-runtime-local-overrides .agent-webhook-local-override label span").evaluateAll((nodes) => (
        nodes.map((node) => node.textContent.trim())
      ));

      const firstInput = page.locator(".chat-runtime-local-overrides .agent-webhook-local-override input").first();
      await firstInput.fill("http://example.com/not-webhook");
      await page.locator(".chat-runtime-local-overrides [data-agent-webhook-action='save']").first().click();
      await page.waitForTimeout(350);
      const overrideAfterReject = await page.evaluate(() => window.localStorage.getItem("intellectualTwin.agentWebhookOverrides"));

      await firstInput.fill("https://example.com/webhook/test");
      await page.locator(".chat-runtime-local-overrides [data-agent-webhook-action='save']").first().click();
      await page.waitForTimeout(350);
      const overrideAfterSave = await page.evaluate(() => window.localStorage.getItem("intellectualTwin.agentWebhookOverrides"));

      const healthText = await page.locator("#chatModeHealthStrip").innerText();
      const screenshot = path.join(outDir, `${qaCase.name}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await page.close();

      const failures = [];
      if (count !== 2) failures.push(`expected 2 local URL controls, found ${count}`);
      if (!labels.some((label) => label.includes("Knowledge Fabric"))) failures.push("Knowledge Fabric local URL control missing");
      if (!labels.some((label) => label.includes("Agentic Butler"))) failures.push("Agentic Butler local URL control missing");
      if (overrideAfterReject) failures.push("invalid non-HTTPS/non-webhook URL was saved");
      if (!overrideAfterSave || !overrideAfterSave.includes("https://example.com/webhook/test")) failures.push("valid HTTPS webhook URL was not saved locally");
      if (!healthText.includes("awaiting URL")) failures.push("Chat health strip did not expose awaiting URL state");

      results.push({
        ...qaCase,
        status: failures.length ? "failed" : "passed",
        failures,
        metrics: {
          control_count: count,
          labels,
          invalid_url_rejected: !overrideAfterReject,
          valid_url_saved: Boolean(overrideAfterSave && overrideAfterSave.includes("https://example.com/webhook/test")),
          health_text: healthText,
        },
        screenshot,
      });
    }
  } finally {
    await browser.close();
    server.close();
  }

  const report = {
    generated_at: new Date().toISOString(),
    frontend_root: root,
    out_dir: outDir,
    passed: results.every((result) => result.status === "passed"),
    cases: results,
  };
  fs.writeFileSync(path.join(outDir, "chat-local-url-setup-qa.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (!report.passed) {
    console.error(`Chat local URL setup QA failed: ${path.join(outDir, "chat-local-url-setup-qa.json")}`);
    for (const result of results.filter((item) => item.status !== "passed")) {
      console.error(`FAILED ${result.name}: ${result.failures.join("; ")}`);
    }
    process.exit(1);
  }

  console.log(`Chat local URL setup QA passed: ${results.length} cases`);
  for (const result of results) {
    console.log(`PASSED ${result.name}: controls=${result.metrics.control_count} screenshot=${result.screenshot}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
