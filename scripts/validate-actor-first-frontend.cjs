const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const html = read("frontend/index.html");
const css = read("frontend/styles.css");
const app = read("frontend/app.js");
const adminHtml = read("frontend/admin/index.html");
const runtimeConfig = read("frontend/runtime-config.js");
const pagesBuild = read("scripts/build-pages-static.cjs");

assert.match(html, /<body class="actor-first-ui">/, "actor-first UI must be explicitly scoped");
assert.match(html, /id="n8nAgentPanel"/, "Actor Twin chat must remain the primary interaction surface");
assert.match(html, /id="actorVoiceBtn"/, "Actor Twin must keep direct voice input");
assert.match(html, /id="actorSourceBtn"/, "Actor Twin must keep direct source intake");
assert.match(html, /id="actorChatControls"/, "Actor Twin talk and source controls must share the chat composer");
assert.match(html, /id="dashboardQueueSelect"/, "Review must expose a compact queue selector");
assert.match(html, /id="dashboardLaneSelect"/, "Review must expose a compact issue selector");
assert.match(html, /data-view="quality"[^>]*hidden/, "Production must leave the daily navigation");
assert.match(html, /id="voiceTranscriptEditor"/, "Voice transcript correction must remain available");
assert.match(html, /id="voiceDraftSelect"/, "Voice drafts must remain resumable");
assert.match(html, /knowledge-fabric-ingest-contract" hidden/, "Internal ingest lifecycle must be hidden from daily intake");
assert.match(html, /profile-advanced-settings/, "Secondary twin configuration must use progressive disclosure");
assert.match(html, /<details class="panel setup-panel primary-cockpit-panel cockpit-disclosure">/, "Guided twin setup must remain a visible collapsed disclosure");
assert.match(html, /id="graphExplorerToolbar"/, "Graph explorer controls must remain available");
assert.doesNotMatch(html, /class="graph-cockpit-head" hidden/, "Graph rollback controls must not be hidden in source markup");
assert.doesNotMatch(html, /class="graph-command-surface" hidden/, "Graph advanced controls must not be hidden in source markup");
assert.match(adminHtml, /href="\.\.\/\?view=activity"/, "Traces must be reachable from Admin Cockpit");
assert.match(adminHtml, /href="\.\.\/\?view=quality&amp;quality=production"/, "Production must open its intended cockpit directly");
assert.match(app, /dashboardFilter: "concepts"/, "Review must open on the concept queue");
assert.match(app, /function placeActorChatControls/, "Actor controls must dock beside the n8n Send action");
assert.match(app, /controls\.parentElement === insertionParent/, "Actor control docking must be idempotent for direct and nested Send actions");
assert.match(app, /function parkActorChatControls/, "Actor controls must survive chat reconnects");
assert.match(app, /dashboardLaneTargetId/, "Targeted review navigation must select the intended lane");
assert.match(app, /aria-describedby/, "Knowledge hover detail must remain available to assistive technology");
assert.match(app, /voiceReadiness.*aria-label/s, "Compact voice readiness must retain an accessible label");
assert.match(app, /function actorChatReadableText/, "Actor chat must sanitize technical response payloads");
assert.match(app, /trace_chain\|adapter\|provider\|runtime\|budget_ms\|agent_id/, "Actor chat sanitizer must recognize runtime trace fields");
assert.doesNotMatch(app, /job\.status === "completed" && job\.result \? `<pre>/, "Background results must not expose raw result JSON");
assert.match(app, /\["queued", "processing", "failed"\]\.includes/, "Actor Twin must hide completed Ready jobs from the user surface");
assert.match(app, /previousActiveJobIds[\s\S]*nativeActorChatMessages/, "Completed background work must return its useful result to the conversation");
assert.match(css, /#chat\.view\.active[\s\S]*display: flex/, "Actor Twin view must use the actor-first layout");
assert.match(css, /#voiceReadiness[\s\S]*display: inline-flex/, "Voice readiness must keep concise visible text");
assert.match(css, /#voiceReadiness::before[\s\S]*width: 10px/, "Voice readiness must retain a compact redundant status dot");
assert.match(css, /#ingest \.source-capture-grid[\s\S]*repeat\(2/, "Source intake must use a balanced two-column layout");
assert.match(css, /knowledge-increment:hover/, "Knowledge rows must provide a clear hover state");
assert.match(css, /knowledge-hover-preview/, "Knowledge rows must reveal compact detail on hover or focus");
assert.match(css, /#dashboard \.dashboard-filterbar[\s\S]*grid-template-columns/, "Review must use compact queue and issue selectors");
assert.match(css, /review-lane-active \.activity-list[\s\S]*height: clamp\(420px/, "Review must expose a useful scrollable queue height");
assert.match(css, /review-lane-active \.activity-list[\s\S]*display: flex[\s\S]*flex-direction: column/, "Review cards must keep natural height inside the scroll lane");
assert.match(css, /graph-explorer-v2 \.graph-cockpit-head[\s\S]*display: none/, "Graph Explorer must place the map in the initial viewport");
assert.match(css, /skill-detail-grid > article:nth-child\(2\)/, "Skill approval must leave the daily skill page");
assert.match(runtimeConfig, /graphExplorerV2: false/, "Graph Explorer V2 must retain its rollback-safe source default");
assert.match(pagesBuild, /envFlag\("MEIDS_GRAPH_UI_V2", false\)/, "Static builds must retain the explicit Graph Explorer rollback flag");

for (const forbidden of ["frontend/api.js", "backend/server.js", "backend/workspaceApi.js"]) {
  assert.ok(fs.existsSync(path.join(root, forbidden)), `${forbidden} must remain present`);
}

console.log("Actor-first frontend contract validated.");
