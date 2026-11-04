const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(process.argv[2] || "frontend");
const outDir = path.resolve(process.argv[3] || path.join("docs", "visual-qa", "actor-first"));
const host = "127.0.0.1";
const port = Number(process.env.MEIDS_QA_PORT || 8797);

const cases = [
  { view: "chat", width: 1440, height: 1000, name: "actor-desktop" },
  { view: "chat", width: 390, height: 844, name: "actor-mobile" },
  { view: "voice", width: 1440, height: 1000, name: "voice-desktop" },
  { view: "voice", width: 390, height: 844, name: "voice-mobile" },
  { view: "ingest", width: 1440, height: 1000, name: "source-desktop" },
  { view: "ingest", width: 390, height: 844, name: "source-mobile" },
  { view: "concepts", width: 1440, height: 1000, name: "knowledge-desktop" },
  { view: "concepts", width: 390, height: 844, name: "knowledge-mobile" },
  { view: "dashboard", width: 1440, height: 1000, name: "review-desktop" },
  { view: "dashboard", width: 390, height: 844, name: "review-mobile" },
  { view: "twins", width: 1440, height: 1000, name: "twins-desktop" },
  { view: "twins", width: 390, height: 844, name: "twins-mobile" },
  { view: "skills", width: 1440, height: 1000, name: "skills-desktop" },
  { view: "skills", width: 390, height: 844, name: "skills-mobile" },
  { view: "graph", width: 1440, height: 1000, name: "graph-desktop" },
  { view: "graph", width: 390, height: 844, name: "graph-mobile" },
];

function type(file) {
  return { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)] || "application/octet-stream";
}

function serve({ listenPort = port, graphV2 = true } = {}) {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(String(request.url || "/").split("?")[0]);
    const file = path.join(root, pathname === "/" ? "index.html" : pathname.replace(/^\//, ""));
    if (!file.startsWith(root)) return response.writeHead(403).end("forbidden");
    fs.readFile(file, (error, data) => {
      if (error) return response.writeHead(404).end("not found");
      const body = path.basename(file) === "runtime-config.js" && graphV2
        ? String(data).replace("graphExplorerV2: false", "graphExplorerV2: true")
        : data;
      response.writeHead(200, { "Content-Type": type(file) });
      response.end(body);
    });
  });
  return new Promise((resolve) => server.listen(listenPort, host, () => resolve(server)));
}

async function run() {
  const { chromium } = require("playwright");
  fs.mkdirSync(outDir, { recursive: true });
  const server = await serve({ listenPort: port, graphV2: true });
  let rollbackServer;
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const item of cases) {
      const context = await browser.newContext({ viewport: { width: item.width, height: item.height } });
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.setItem("intellectualTwin.landing.dismissed", "true");
      });
      await page.goto(`http://${host}:${port}/?view=${item.view}`, { waitUntil: "networkidle" });
      await page.waitForSelector(`#${item.view}.view.active`, { timeout: 10000 });
      await page.waitForTimeout(250);
      const metrics = await page.evaluate((view) => {
        const visible = (selector) => {
          const node = document.querySelector(selector);
          return Boolean(node && getComputedStyle(node).display !== "none" && node.getBoundingClientRect().height > 0);
        };
        const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
        const active = document.querySelector(`#${view}.view.active`);
        const interactive = Array.from(active?.querySelectorAll("button, input, select, textarea, summary, a[href]") || []).filter((node) => {
          const style = getComputedStyle(node);
          const box = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
        });
        return {
          scrollWidth: document.scrollingElement.scrollWidth,
          viewportWidth: innerWidth,
          controlCount: interactive.length,
          actorPanel: visible("#n8nAgentPanel"),
          actorVoice: visible("#actorVoiceBtn"),
          actorSource: visible("#actorSourceBtn"),
          voiceHero: visible("#voice .source-capture-hero"),
          voiceStatusVisible: visible("#voiceReadiness"),
          voiceStatusText: document.querySelector("#voiceReadiness")?.textContent?.trim() || "",
          ingestHero: visible("#ingest .source-capture-hero"),
          ingestContract: visible("#ingest .knowledge-fabric-ingest-contract"),
          ingestCards: document.querySelectorAll("#ingest .source-capture-card").length,
          productionNav: visible('.nav-item[data-view="quality"]'),
          setupPanel: visible("#twins .setup-panel"),
          setupOpen: Boolean(document.querySelector("#twins .setup-panel[open]")),
          advancedTwinOpen: Boolean(document.querySelector(".profile-advanced-settings[open]")),
          skillApproval: visible("#skills .skill-detail-grid > article:nth-child(2)"),
          graphCanvasHeight: rect("#graph .graph-canvas-wrap")?.height || 0,
          reviewConceptActive: document.querySelector('[data-dashboard-filter="concepts"]')?.classList.contains("active") || false,
        };
      }, item.view);
      const failures = [];
      if (metrics.scrollWidth > metrics.viewportWidth + 2) failures.push(`horizontal overflow ${metrics.scrollWidth} > ${metrics.viewportWidth}`);
      if (metrics.productionNav) failures.push("production is visible in daily navigation");
      if (item.view === "chat" && (!metrics.actorPanel || !metrics.actorVoice || !metrics.actorSource)) failures.push("Actor Twin primary controls are not all visible");
      if (item.view === "voice" && (metrics.voiceHero || !metrics.voiceStatusVisible || !metrics.voiceStatusText)) failures.push("Voice Capture lacks a compact readable status");
      if (item.view === "ingest" && (metrics.ingestHero || metrics.ingestContract || metrics.ingestCards !== 4)) failures.push("Source Upload is not reduced to four intake lanes");
      if (item.view === "dashboard" && !metrics.reviewConceptActive) failures.push("Review does not default to concepts");
      if (item.view === "twins" && (!metrics.setupPanel || metrics.setupOpen || metrics.advancedTwinOpen)) failures.push("Twin setup is not a visible collapsed disclosure");
      if (item.view === "skills" && metrics.skillApproval) failures.push("Skill approval remains in the daily skill view");
      if (item.view === "graph" && metrics.graphCanvasHeight < 500) failures.push(`graph canvas too small: ${metrics.graphCanvasHeight}`);
      if (item.view === "twins") {
        await page.locator("#twins .setup-panel > summary").click();
        const setup = await page.evaluate(() => ({
          open: Boolean(document.querySelector("#twins .setup-panel[open]")),
          steps: document.querySelectorAll("#twins .setup-step").length,
        }));
        if (!setup.open || setup.steps !== 5) failures.push("Guided setup cannot expose all five steps");
      }
      if (item.view === "graph") {
        await page.locator('[data-graph-explorer-action="advanced"]').click();
        const advancedVisible = await page.evaluate(() => {
          const node = document.querySelector("#graph .graph-command-surface");
          return Boolean(node && getComputedStyle(node).display !== "none" && node.getBoundingClientRect().height > 0);
        });
        if (!advancedVisible) failures.push("Graph Advanced does not reveal projection controls");
      }
      const screenshot = path.join(outDir, `${item.name}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      results.push({ ...item, metrics, failures, status: failures.length ? "failed" : "passed", screenshot });
      await context.close();
    }

    rollbackServer = await serve({ listenPort: port + 1, graphV2: false });
    const rollbackContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const rollbackPage = await rollbackContext.newPage();
    await rollbackPage.addInitScript(() => localStorage.setItem("intellectualTwin.landing.dismissed", "true"));
    await rollbackPage.goto(`http://${host}:${port + 1}/?view=graph`, { waitUntil: "networkidle" });
    await rollbackPage.waitForSelector("#graph.view.active", { timeout: 10000 });
    const rollback = await rollbackPage.evaluate(() => {
      const visible = (selector) => {
        const node = document.querySelector(selector);
        return Boolean(node && getComputedStyle(node).display !== "none" && node.getBoundingClientRect().height > 0);
      };
      return {
        v2: document.body.classList.contains("graph-explorer-v2"),
        search: visible("#graphSearch"),
        exportButton: visible("#graphExportBtn"),
      };
    });
    const rollbackFailures = [];
    if (rollback.v2 || !rollback.search || !rollback.exportButton) rollbackFailures.push("Graph V2 flag-off rollback does not restore legacy controls");
    results.push({ name: "graph-v1-rollback", width: 1440, height: 1000, metrics: rollback, failures: rollbackFailures, status: rollbackFailures.length ? "failed" : "passed" });
    await rollbackContext.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    if (rollbackServer) await new Promise((resolve) => rollbackServer.close(resolve));
  }
  const report = { generated_at: new Date().toISOString(), results };
  fs.writeFileSync(path.join(outDir, "actor-first-qa.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const result of results) console.log(`${result.status.toUpperCase()} ${result.name}: controls=${result.metrics.controlCount}${result.failures.length ? ` | ${result.failures.join("; ")}` : ""}`);
  if (results.some((result) => result.status === "failed")) process.exit(1);
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
