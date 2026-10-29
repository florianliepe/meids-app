const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const app = read("frontend/app.js");
const html = read("frontend/index.html");
const styles = read("frontend/styles.css");
const runtime = read("frontend/runtime-config.js");
const build = read("scripts/build-pages-static.cjs");

const checks = [
  [runtime.includes("graphExplorerV2: false"), "runtime default must keep graph_ui_v2 disabled"],
  [build.includes('envFlag("MEIDS_GRAPH_UI_V2", false)'), "build must expose the explicit graph_ui_v2 environment flag"],
  [html.includes('id="graphExplorerToolbar"'), "Graph Explorer toolbar is missing"],
  [html.includes('data-graph-depth="0"') && html.includes('data-graph-depth="1"') && html.includes('data-graph-depth="2"'), "All/1-hop/2-hop controls are incomplete"],
  [html.includes('data-graph-layer="trusted"') && html.includes('data-graph-layer="evidence"') && html.includes('data-graph-layer="candidates"'), "Trusted/Evidence/Candidates controls are incomplete"],
  [html.includes('data-graph-explorer-action="map"') && html.includes('data-graph-explorer-action="list"'), "Map/List alternatives are incomplete"],
  [app.includes("graphExplorerV2Enabled") && app.includes("graph-explorer-v2"), "feature flag is not bound to the UI"],
  [app.includes("applyGraphNeighborhoodHighlight") && app.includes("is-muted") && app.includes("is-connected"), "neighborhood emphasis is incomplete"],
  [app.includes("graphLocalDepth") && app.includes("graphFocusProjection"), "local graph projection is incomplete"],
  [app.includes("graphExplorerLayerProjection"), "knowledge layer projection is missing"],
  [styles.includes("body.graph-explorer-v2") && styles.includes("prefers-reduced-motion: reduce"), "feature-scoped or reduced-motion styles are missing"],
  [styles.includes(".graph-node-hit-target"), "large invisible node hit targets are missing"],
  [styles.includes(".graph-svg-node:focus-visible"), "visible keyboard focus styling is missing"],
  [app.includes("graphNodePresentationLayer") && app.includes("data-graph-presentation-layer"), "presentation-layer classification is missing"],
  [app.includes('return "evidence"') && app.includes('return "candidate"'), "trusted/evidence/candidate node classification is incomplete"],
  [app.includes('width: "0.65px"') && styles.includes("--graph-edge-trusted"), "compact edge styling is missing"],
  [styles.includes(".graph-svg-label-wrap.quiet-label rect") && styles.includes("opacity: 0"), "labels are not quiet at rest"],
];

const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length) {
  console.error("Graph Explorer V2 contract failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Graph Explorer V2 contract passed (${checks.length} checks).`);
