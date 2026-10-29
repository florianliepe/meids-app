const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(process.argv[2] || "dist-graph-v2-preview");
const outDir = path.resolve(process.argv[3] || path.join("docs", "visual-qa", "graph-explorer-v2"));
const host = "127.0.0.1";
const port = Number(process.env.MEIDS_GRAPH_QA_PORT || 8795);

const cases = [
  { name: "desktop-light", width: 1440, height: 1000, theme: "light" },
  { name: "desktop-dark", width: 1440, height: 1000, theme: "dark" },
  { name: "tablet-light", width: 1024, height: 900, theme: "light" },
  { name: "mobile-light", width: 390, height: 900, theme: "light" },
  { name: "mobile-dark", width: 390, height: 900, theme: "dark" },
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

async function restoreStaticGraph(page) {
  await page.evaluate(() => {
    if (window.INTELLECTUAL_TWIN_CONFIG?.staticPagesMode && typeof refreshStaticPagesWorkspace === "function") {
      refreshStaticPagesWorkspace();
    }
  });
  await page.waitForSelector("#graphCanvas .graph-svg-node", { timeout: 10000 });
}

async function inspectExplorer(page) {
  const failures = [];
  const bodyClass = await page.locator("body").getAttribute("class");
  if (!String(bodyClass).includes("graph-explorer-v2")) failures.push("graph-explorer-v2 body class is absent");
  if (!await page.locator("#graphExplorerToolbar:visible").count()) failures.push("compact explorer toolbar is not visible");
  if (await page.locator(".graph-command-surface:visible").count()) failures.push("legacy governance controls are visible by default");

  const pressed = async (selector) => page.locator(selector).getAttribute("aria-pressed");
  if (await pressed('[data-graph-layer="trusted"]') !== "true") failures.push("Trusted layer is not enabled by default");
  if (await pressed('[data-graph-layer="evidence"]') !== "true") failures.push("Evidence layer is not enabled by default");
  if (await pressed('[data-graph-layer="candidates"]') !== "false") failures.push("Candidates layer is not opt-in");

  const node = page.locator("#graphCanvas .graph-svg-node:visible").first();
  await node.focus();
  await page.waitForTimeout(220);
  const focusRing = await node.evaluate((element) => {
    const circle = element.querySelector("circle:not(.graph-node-hit-target)");
    return document.activeElement === element && Number.parseFloat(getComputedStyle(circle).strokeWidth || "0") >= 4;
  });
  if (!focusRing) failures.push("keyboard focus ring is not visible");
  if (!await page.locator("#graphExplorerTooltip:not([hidden])").count()) failures.push("focus does not reveal the graph tooltip");

  await page.keyboard.press("Enter");
  await page.waitForTimeout(80);
  if (!await page.locator("#graph.graph-has-selection").count()) failures.push("Enter does not persist node selection");
  if (!await page.locator("#graphNodeDetail:visible").count()) failures.push("persistent selection drawer is not visible");

  await page.locator('[data-graph-depth="1"]').click();
  if (await pressed('[data-graph-depth="1"]') !== "true") failures.push("1-hop local graph control did not activate");
  await page.locator('[data-graph-depth="2"]').click();
  if (await pressed('[data-graph-depth="2"]') !== "true") failures.push("2-hop local graph control did not activate");

  await page.locator('[data-graph-layer="candidates"]').click();
  if (await pressed('[data-graph-layer="candidates"]') !== "true") failures.push("Candidates layer did not activate");

  await page.locator('[data-graph-explorer-action="list"]').evaluate((element) => element.click());
  await page.waitForTimeout(80);
  if (await pressed('[data-graph-explorer-action="list"]') !== "true") failures.push("List view control did not activate");
  if (!await page.locator("#graphCanvas .graph-list-node:visible").count()) failures.push("accessible List view is empty");
  await page.locator('[data-graph-explorer-action="map"]').evaluate((element) => element.click());

  await page.locator('[data-graph-explorer-action="advanced"]').click();
  if (!await page.locator(".graph-command-surface:visible").count()) failures.push("Advanced does not reveal legacy graph controls");
  await page.locator('[data-graph-explorer-action="advanced"]').evaluate((element) => element.click());
  await page.waitForTimeout(80);
  if (await page.locator('[data-graph-explorer-action="advanced"]').getAttribute("aria-expanded") !== "false") failures.push("Advanced controls did not close");
  if (await page.locator(".graph-command-surface:visible").count()) failures.push("legacy graph controls remain visible after Advanced closes");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  if (await page.locator("#graph.graph-has-selection").count()) failures.push("Escape did not clear selection");

  await restoreStaticGraph(page);
  const hoverNode = page.locator("#graphCanvas .graph-svg-node:visible").first();
  const hoverMs = await hoverNode.evaluate((element) => {
    const started = performance.now();
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    return performance.now() - started;
  });
  await page.waitForTimeout(220);
  if (hoverMs >= 100) failures.push(`hover class update exceeded 100 ms: ${hoverMs.toFixed(2)} ms`);
  if (!await page.locator("#graphCanvas .graph-svg-node.is-muted").count()) failures.push("hover does not dim unrelated nodes");
  if (!await page.locator("#graphCanvas .graph-svg-edge.is-connected").count()) failures.push("hover does not highlight connecting edges");
  if (!await page.locator("#graphExplorerTooltip:not([hidden])").count()) failures.push("hover tooltip is not visible after its delay");

  const layout = await page.evaluate(() => {
    const panel = document.querySelector(".graph-cockpit-panel");
    const canvas = document.querySelector("#graphCanvas");
    const toolbar = document.querySelector("#graphExplorerToolbar");
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    return {
      panelWidth: Math.round(panel?.getBoundingClientRect().width || 0),
      canvasWidth: Math.round(canvas?.getBoundingClientRect().width || 0),
      viewportWidth: innerWidth,
      toolbarHeight: Math.round(toolbar?.getBoundingClientRect().height || 0),
      documentWidth: document.scrollingElement?.scrollWidth || 0,
      reduceMotion,
      advancedOpen: document.querySelector("#graph")?.classList.contains("graph-advanced-open") || false,
      relationLayerDisplay: getComputedStyle(document.querySelector("#graphCanvas .graph-relation-layer-summary")).display,
    };
  });
  if (layout.documentWidth > layout.viewportWidth + 2) failures.push(`horizontal overflow: ${layout.documentWidth}px > ${layout.viewportWidth}px`);
  if (layout.canvasWidth < Math.min(320, layout.panelWidth * 0.7)) failures.push("graph canvas is not the dominant surface");
  if (layout.advancedOpen) failures.push("Advanced graph state remained open after it was closed");
  if (layout.relationLayerDisplay !== "none") failures.push(`advanced relation layers remain visible: ${layout.relationLayerDisplay}`);
  return { failures, hoverMs: Number(hoverMs.toFixed(2)), layout };
}

async function benchmarkSyntheticHover(page, count) {
  return page.evaluate((nodeCount) => {
    const canvas = document.querySelector("#graphCanvas");
    const svg = canvas?.querySelector("svg");
    if (!svg) return { count: nodeCount, durationMs: null };
    const fixture = document.createElementNS("http://www.w3.org/2000/svg", "g");
    fixture.id = "graph-v2-benchmark-fixture";
    for (let index = 0; index < nodeCount; index += 1) {
      const node = document.createElementNS("http://www.w3.org/2000/svg", "g");
      node.classList.add("graph-svg-node");
      node.dataset.graphNode = `benchmark-${index}`;
      fixture.append(node);
      if (index > 0) {
        const edge = document.createElementNS("http://www.w3.org/2000/svg", "path");
        edge.classList.add("graph-svg-edge");
        edge.dataset.graphEdge = `benchmark-edge-${index}`;
        edge.dataset.graphSource = `benchmark-${index - 1}`;
        edge.dataset.graphTarget = `benchmark-${index}`;
        fixture.append(edge);
      }
    }
    svg.append(fixture);
    const targets = [...fixture.querySelectorAll(".graph-svg-node")];
    const samples = [];
    for (let index = 0; index < Math.min(12, targets.length); index += 1) {
      const target = targets[(index * 37) % targets.length];
      const started = performance.now();
      target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      svg.getBoundingClientRect();
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)] || 0;
    fixture.remove();
    return { count: nodeCount, durationMs: Number(p95.toFixed(2)), samples: samples.map((value) => Number(value.toFixed(2))) };
  }, count);
}

async function run() {
  if (!fs.existsSync(path.join(root, "index.html"))) throw new Error(`Missing static frontend at ${root}`);
  let playwright;
  try {
    playwright = require("playwright");
  } catch (error) {
    throw new Error(`Playwright is required. Set NODE_PATH to the bundled dependencies. ${error.message}`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const server = await startServer();
  const browser = await playwright.chromium.launch({ headless: true });
  const results = [];
  try {
    for (const qaCase of cases) {
      const context = await browser.newContext({
        viewport: { width: qaCase.width, height: qaCase.height },
        colorScheme: qaCase.theme,
        reducedMotion: qaCase.name === "mobile-light" ? "reduce" : "no-preference",
      });
      const page = await context.newPage();
      await page.addInitScript((theme) => {
        localStorage.setItem("intellectualTwin.theme", theme);
        localStorage.setItem("intellectualTwin.landing.dismissed", "true");
      }, qaCase.theme);
      await page.goto(`http://${host}:${port}/?view=graph`, { waitUntil: "networkidle" });
      await restoreStaticGraph(page);
      const result = await inspectExplorer(page);
      const screenshotPath = path.join(outDir, `graph-explorer-v2-${qaCase.name}.png`);
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(80);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      const screenshot = path.relative(process.cwd(), screenshotPath).replaceAll("\\", "/");
      results.push({ ...qaCase, ...result, screenshot });
      await context.close();
    }

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("intellectualTwin.theme", "light");
      localStorage.setItem("intellectualTwin.landing.dismissed", "true");
    });
    await page.goto(`http://${host}:${port}/?view=graph`, { waitUntil: "networkidle" });
    await restoreStaticGraph(page);
    const benchmarks = [];
    for (const count of [100, 500, 1000]) benchmarks.push(await benchmarkSyntheticHover(page, count));
    await context.close();
    if ((benchmarks.find((entry) => entry.count === 500)?.durationMs ?? Infinity) >= 100) {
      results.push({ name: "500-node-hover-benchmark", failures: [`500-node hover exceeded 100 ms: ${JSON.stringify(benchmarks)}`], benchmarks });
    } else {
      results.push({ name: "hover-benchmarks", failures: [], benchmarks });
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  const reportPath = path.join(outDir, "graph-explorer-v2-qa.json");
  fs.writeFileSync(reportPath, `${JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2)}\n`);
  results.forEach((result) => {
    const status = result.failures?.length ? "FAILED" : "PASSED";
    console.log(`${status} ${result.name}${result.hoverMs !== undefined ? ` hover=${result.hoverMs}ms` : ""}`);
    (result.failures || []).forEach((failure) => console.log(`  - ${failure}`));
  });
  if (results.some((result) => result.failures?.length)) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
