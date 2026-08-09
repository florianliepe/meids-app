const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(process.argv[2] || "frontend");
const outDir = path.resolve(process.argv[3] || path.join("docs", "visual-qa", `screenshots-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`));
const port = Number(process.env.MEIDS_QA_PORT || 8791);
const host = "127.0.0.1";

const cases = [
  { view: "concepts", name: "knowledge-desktop-dark", width: 1440, height: 1000, main: ".knowledge-browser-panel", cards: ".knowledge-increment" },
  { view: "concepts", name: "knowledge-mobile-dark", width: 390, height: 900, main: ".knowledge-browser-panel", cards: ".knowledge-increment" },
  { view: "graph", name: "graph-desktop-dark", width: 1440, height: 1000, main: ".graph-cockpit-panel", cards: ".graph-svg-node, .graph-node, .graph-list-node" },
  { view: "graph", name: "graph-mobile-dark", width: 390, height: 900, main: ".graph-cockpit-panel", cards: ".graph-svg-node, .graph-node, .graph-list-node" },
  { view: "dashboard", name: "trace-dashboard-desktop-dark", width: 1440, height: 1000, main: "#dashboard", cards: ".agent-trace-row" },
  { view: "dashboard", name: "trace-dashboard-mobile-dark", width: 390, height: 900, main: "#dashboard", cards: ".agent-trace-row" },
];

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

function luminance([r, g, b]) {
  const values = [r, g, b].map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

function parseRgb(value) {
  const match = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function contrastRatio(foreground, background) {
  const fg = parseRgb(foreground);
  const bg = parseRgb(background);
  if (!fg || !bg) return 0;
  const lighter = Math.max(luminance(fg), luminance(bg));
  const darker = Math.min(luminance(fg), luminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

async function run() {
  if (!fs.existsSync(path.join(root, "index.html"))) {
    throw new Error(`Frontend root not found or missing index.html: ${root}`);
  }
  let playwright;
  try {
    playwright = require("playwright");
  } catch (error) {
    throw new Error(`Playwright is required for browser QA. Set NODE_PATH to the bundled node_modules or install Playwright. Original error: ${error.message}`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const server = await startServer();
  const browser = await playwright.chromium.launch({ headless: true });
  const results = [];
  try {
    for (const qaCase of cases) {
      const page = await browser.newPage({ viewport: { width: qaCase.width, height: qaCase.height } });
      await page.addInitScript(() => {
        window.localStorage.setItem("intellectualTwin.theme", "dark");
        window.localStorage.setItem("intellectualTwin.landing.dismissed", "true");
      });
      await page.goto(`http://${host}:${port}/?view=${qaCase.view}`, { waitUntil: "networkidle" });
      await page.waitForSelector(qaCase.main, { timeout: 10000 });
      await page.waitForTimeout(350);
      let interactionMetrics = {};
      if (qaCase.view === "graph") {
        interactionMetrics = await exerciseGraphRelationLayerFilter(page);
      }
      if (qaCase.view === "dashboard") {
        interactionMetrics = await inspectTraceDashboard(page);
      }
      const metrics = await page.evaluate((selector) => {
        const main = document.querySelector(selector.main);
        const cards = Array.from(document.querySelectorAll(selector.cards));
        const header = document.querySelector(".topbar h1, .knowledge-browser-head h2, .graph-cockpit-head h2");
        const bodyStyle = window.getComputedStyle(document.body);
        const headerStyle = header ? window.getComputedStyle(header) : null;
        const mainBox = main ? main.getBoundingClientRect() : null;
        const hasScrollableAncestor = (node) => {
          let current = node.parentElement;
          while (current && current !== document.body) {
            const style = window.getComputedStyle(current);
            if (["auto", "scroll"].includes(style.overflowX) && current.scrollWidth > current.clientWidth + 2) return true;
            current = current.parentElement;
          }
          return false;
        };
        const overflowing = Array.from(document.querySelectorAll("body *")).filter((node) => {
          if (node.closest(".drawer:not(.open), .drawer-backdrop:not(.open)")) return false;
          if (hasScrollableAncestor(node)) return false;
          const style = window.getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const box = node.getBoundingClientRect();
          return box.width > 1 && (box.right > window.innerWidth + 2 || box.left < -2);
        }).slice(0, 8).map((node) => ({
          tag: node.tagName.toLowerCase(),
          className: String(node.className || "").slice(0, 120),
          right: Math.round(node.getBoundingClientRect().right),
          width: Math.round(node.getBoundingClientRect().width),
        }));
        return {
          themeDark: document.body.classList.contains("theme-dark"),
          title: document.querySelector(".topbar h1")?.textContent?.trim() || "",
          mainFound: Boolean(main),
          cardCount: cards.length,
          bodyBackground: bodyStyle.backgroundColor,
          headerColor: headerStyle?.color || "",
          contrastSample: { foreground: headerStyle?.color || "", background: bodyStyle.backgroundColor },
          mainWidth: mainBox ? Math.round(mainBox.width) : 0,
          viewportWidth: window.innerWidth,
          documentScrollWidth: document.scrollingElement?.scrollWidth || document.documentElement.scrollWidth,
          overflowing,
        };
      }, { main: qaCase.main, cards: qaCase.cards });
      const contrast = contrastRatio(metrics.contrastSample.foreground, metrics.contrastSample.background);
      const screenshot = path.join(outDir, `${qaCase.name}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await page.close();
      const failures = [];
      if (!metrics.themeDark) failures.push("dark theme was not applied");
      if (!metrics.mainFound) failures.push(`main selector missing: ${qaCase.main}`);
      if (metrics.cardCount < 1) failures.push(`no cards/nodes found for selector: ${qaCase.cards}`);
      if (contrast < 4.5) failures.push(`header contrast below 4.5: ${contrast.toFixed(2)}`);
      if (metrics.documentScrollWidth > metrics.viewportWidth + 2) failures.push(`document overflow: ${metrics.documentScrollWidth}px > ${metrics.viewportWidth}px`);
      if (metrics.overflowing.length) failures.push(`horizontal overflow: ${JSON.stringify(metrics.overflowing)}`);
      if (qaCase.view === "graph") {
        if (!interactionMetrics.nodeClicked) failures.push("graph QA could not click a visible node");
        if (!interactionMetrics.relationLayerSummaryFound) failures.push("graph relation layer summary did not render after node selection");
        if (!interactionMetrics.layerButtonCount) failures.push("graph relation layer buttons missing");
        if (interactionMetrics.candidateClicked && interactionMetrics.edgeClassFilter !== "candidate") {
          failures.push(`candidate layer click did not apply edge-class filter: ${interactionMetrics.edgeClassFilter || "unset"}`);
        }
        if (!interactionMetrics.candidateEdgeFound) failures.push("graph QA could not find the static candidate edge");
        if (!interactionMetrics.acceptButtonFound) failures.push("graph candidate edge accept action missing");
        if (interactionMetrics.acceptButtonFound && !String(interactionMetrics.reviewedStatus || "").includes("reviewed")) {
          failures.push(`graph candidate accept did not update review status: ${interactionMetrics.reviewedStatus || "empty"}`);
        }
      }
      if (qaCase.view === "dashboard") {
        if (!interactionMetrics.traceRows) failures.push("trace dashboard has no visible agent trace rows");
        if (!interactionMetrics.setupNotice) failures.push("trace dashboard missing live URL setup notice");
      }
      results.push({ ...qaCase, metrics, contrast: Number(contrast.toFixed(2)), screenshot, status: failures.length ? "failed" : "passed", failures });
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  const failed = results.filter((result) => result.status !== "passed");
  const report = {
    generated_at: new Date().toISOString(),
    root,
    out_dir: outDir,
    results,
  };
  fs.writeFileSync(path.join(outDir, "browser-dark-mode-qa.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Browser dark-mode QA ${failed.length ? "failed" : "passed"}: ${results.length} cases`);
  for (const result of results) {
    console.log(`${result.status.toUpperCase()} ${result.name}: cards=${result.metrics.cardCount} contrast=${result.contrast} screenshot=${path.relative(process.cwd(), result.screenshot)}`);
    for (const failure of result.failures) console.log(`  - ${failure}`);
  }
  if (failed.length) process.exit(1);
}

async function exerciseGraphRelationLayerFilter(page) {
  const node = page.locator("[data-graph-node]").first();
  const nodeClicked = await node.count().then((count) => count > 0);
  if (!nodeClicked) return { nodeClicked: false };
  await node.click({ force: true });
  await page.waitForSelector(".graph-relation-layer-summary", { timeout: 10000 }).catch(() => {});
  const relationLayerSummaryFound = await page.locator(".graph-relation-layer-summary").count().then((count) => count > 0);
  const layerButtonCount = await page.locator(".graph-relation-layer-summary button").count();
  const candidate = page.locator('.graph-relation-layer-summary button[data-graph-edge-class-filter="candidate"]').first();
  const candidateClicked = await candidate.count().then((count) => count > 0);
  if (candidateClicked) {
    await candidate.click({ force: true });
    await page.waitForTimeout(200);
  }
  const edgeClassFilter = await page.evaluate(() =>
    document.querySelector(".graph-relation-layer-summary button.active")?.dataset?.graphEdgeClassFilter || "",
  );
  const promotionMetrics = await exerciseGraphPromotionAction(page);
  return { nodeClicked, relationLayerSummaryFound, layerButtonCount, candidateClicked, edgeClassFilter, ...promotionMetrics };
}

async function exerciseGraphPromotionAction(page) {
  const candidateEdge = page.locator('[data-graph-edge="edge:butler-to-contract"]').first();
  const candidateEdgeFound = await candidateEdge.count().then((count) => count > 0);
  if (!candidateEdgeFound) return { candidateEdgeFound: false };
  await candidateEdge.click({ force: true });
  await page.waitForSelector('.graph-edge-workbench [data-graph-edge-action="accepted"]', { timeout: 10000 }).catch(() => {});
  const acceptButton = page.locator('.graph-edge-workbench [data-graph-edge-action="accepted"]').first();
  const acceptButtonFound = await acceptButton.count().then((count) => count > 0);
  if (!acceptButtonFound) return { candidateEdgeFound, acceptButtonFound: false };
  await acceptButton.click({ force: true });
  await page.waitForTimeout(250);
  const reviewedStatus = await page.evaluate(() => document.querySelector("#graphStatus")?.textContent || "");
  const recentlyReviewed = await page.locator(".graph-svg-edge.recently-reviewed, .graph-edge-line.selected").count();
  return { candidateEdgeFound, acceptButtonFound, reviewedStatus, recentlyReviewed };
}

async function inspectTraceDashboard(page) {
  await page.waitForSelector("#dashAgentTraceHistory", { timeout: 10000 }).catch(() => {});
  const traceRows = await page.locator("#dashAgentTraceHistory .agent-trace-row").count();
  const setupNotice = await page.locator("#dashAgentTraceHistory .agent-trace-setup-notice").count();
  return { traceRows, setupNotice };
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
