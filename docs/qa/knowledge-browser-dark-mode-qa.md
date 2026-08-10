# Knowledge Browser Dark Mode QA

Date: 2026-08-09

Latest update: 2026-08-10

## Latest Local QA Pass For n8n URL Source Labels

- Added explicit n8n URL source labels to Chat contract badges, Production Cockpit URL readiness cards, and exported agent probe evidence.
- Source labels distinguish:
  - `runtime asset`
  - `browser-local UAT override`
  - `missing URL`
- This prevents browser-local UAT overrides from being mistaken for committed runtime asset readiness.
- Re-ran browser dark-mode QA after the label changes.
- Result: all 6 cases passed.
- Minimum measured contrast in this pass: `18.65`.
- Screenshot evidence:
  - `docs/visual-qa/screenshots-20260810-z4-url-source-labels/`

Validation commands:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-z4-url-source-labels`

## Latest Local QA Pass For Browser-Local n8n URL Overrides

- Added browser-local public UAT URL overrides for the three top-level agent runtime resolver.
- The override is stored under browser local storage and takes precedence over `frontend/assets/agent-runtime-config.json` for runtime routing in that browser only.
- Added compact `Browser-local UAT URL` controls to the Production Cockpit missing live URL cards.
- Preserved production boundary:
  - public UAT URLs only in browser override
  - private/production n8n endpoints must stay behind hosted backend secrets
  - committed runtime artifact still reports static `1/3` URL readiness until real URLs are added to the asset/build config
- Re-ran browser dark-mode QA after adding the controls.
- Result: all 6 cases passed.
- Screenshot evidence:
  - `docs/visual-qa/screenshots-20260810-z4-local-n8n-url-overrides/`

Validation commands:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-z4-local-n8n-url-overrides`

## Latest Browser QA Pass For Zielmodus 4 Dark Mode Surfaces

- Re-ran browser-level dark-mode QA for the current GitHub Pages frontend source.
- Covered desktop and mobile widths for:
  - Knowledge Browser
  - Knowledge Graph
  - Review/trace dashboard
- Result: all 6 cases passed.
- Minimum measured contrast in this pass: `18.65`.
- No new targeted CSS patch was required from this pass.
- Screenshot evidence:
  - `docs/visual-qa/screenshots-20260810-z4-followup-dark-qa/`

Validation command:

- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-z4-followup-dark-qa`

## Latest Runtime Artifact Refresh For n8n URL Gate

- Refreshed public-safe runtime readiness artifacts against `frontend/assets/agent-runtime-config.json`.
- Current n8n readiness remains `1/3` URLs configured:
  - Actor Twin configured for public UAT
  - Knowledge Fabric Agent awaiting live URL
  - Agentic Butler awaiting live URL
- Added an operator handoff document for the remaining live URL gate:
  - `docs/production/n8n-live-url-gate-status.md`
- OKF validation status remains passed.

Validation commands:

- `node scripts/write-n8n-runtime-readiness-status.cjs --write`
- `node scripts/write-okf-validation-status.cjs --write`
- `node --check frontend/app.js`

## Latest Local QA Pass For Graph Node Promotion Readiness

- Added a selected-node `Relation promotion readiness` panel in the Knowledge Graph detail view.
- The panel separates:
  - explicit relations
  - inferred relations
  - candidate relations
  - accepted relations
  - blocked relations
  - approved Knowledge Fabric handoffs linked to the node
- Added graph-to-Knowledge-Fabric handoff awareness so approved queue items can surface as promotion evidence.
- Preserved the rule that graph and vector promotion remain gated until knowledge repo PR approval and merge.
- Verified desktop and mobile dark-mode rendering with Playwright.
- Verified targeted behavior:
  - selecting a graph node renders the readiness panel
  - the panel includes explicit/inferred/candidate/approved-handoff counts
  - the panel stays within the graph detail width
- Screenshot and machine-readable QA output:
  - `docs/visual-qa/screenshots-20260810-graph-node-promotion-readiness/`

Validation commands:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-graph-node-promotion-readiness`

## Latest Local QA Pass For Knowledge Fabric Queue Filters And PR Handoff

- Added review-state filtering for the Knowledge Fabric queue:
  - all
  - pending
  - reviewed
  - approved
  - needs rework
  - rejected
  - graph candidates
  - repo ready
- Added an approved PR handoff preview for approved OKF source handoffs.
- Added `Copy approved PR handoff`, producing `meids.approved_okf_pr_handoff.v1` JSON for knowledge repo PR preparation.
- Verified the PR handoff remains non-mutating and keeps graph/vector promotion gated after knowledge repo merge.
- Verified desktop and mobile dark-mode rendering with Playwright.
- Verified targeted behavior:
  - approving one queue item creates at least one repo-ready handoff
  - repo-ready filter shows only approved handoffs
  - copied PR handoff includes schema, summary, target paths, graph candidates, and apply rules
  - queue filter does not overflow the viewport
- Screenshot and machine-readable QA output:
  - `docs/visual-qa/screenshots-20260810-knowledge-fabric-queue-filter-pr-handoff/`

Validation commands:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-knowledge-fabric-queue-filter-pr-handoff`

## Latest Local QA Pass For Knowledge Fabric Review Transitions

- Added an explicit review transition strip to each Knowledge Fabric queue card.
- Review state now shows the downstream vector boundary, graph curator state, and repo-sync eligibility in one compact handoff view.
- Same-state decisions are disabled after review while correction paths remain available.
- `Export OKF + graph` remains blocked until OKF approval, then becomes available after approval.
- Verified desktop and mobile dark-mode rendering with Playwright.
- Verified targeted queue behavior:
  - pending handoff starts with `Approve OKF` enabled
  - `Export OKF + graph` is disabled before approval
  - approving the handoff updates the transition to approved
  - `Approve OKF` becomes disabled after approval
  - `Export OKF + graph` becomes enabled after approval
  - review transition does not overflow the card
- Screenshot and machine-readable QA output:
  - `docs/visual-qa/screenshots-20260810-knowledge-fabric-review-transitions/`

Validation commands:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-knowledge-fabric-review-transitions`

## Latest Local QA Pass For Knowledge And Graph Trusted Presets

- Added Knowledge Browser retrieval presets for:
  - all fabric
  - trusted retrieval
  - review queue
  - source gaps
  - vector ready
- Added Knowledge Graph `Trusted retrieval` reasoning mode.
- Verified desktop `1440px` and mobile `390px` dark-mode rendering with Playwright.
- Verified Knowledge presets update the source filter to `approved` and `vector-ready`.
- Verified Graph trusted retrieval sets `approved` review state, hides drafts, and uses explicit relation layer.
- Verified no horizontal overflow.
- Screenshot and machine-readable QA output:
  - `docs/visual-qa/screenshots-20260810-knowledge-graph-trusted-presets/`

Validation commands:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`

## Latest Local QA Pass For Inline Chat Contract Badges

- Added inline contract health badges beside the Chat interaction mode selector for Actor Twin, Knowledge Fabric Agent, and Agentic Butler.
- Verified desktop `1440px` and mobile `390px` dark-mode rendering with Playwright.
- Verified badge clicks switch the interaction mode to `source_context` and `skill_activation`.
- Verified no horizontal overflow or clipped badge content.
- Screenshot and machine-readable QA output:
  - `docs/visual-qa/screenshots-20260810-chat-inline-contract-badges/`

Validation commands:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`

## Scope

Targeted QA for the Knowledge Browser dark-mode readability work in the MeIDs static frontend.

## Checks Performed

- `node --check frontend/app.js`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260809-browser`

## UI Areas Covered By This Pass

- Knowledge card review-state contrast:
  - `approved`
  - `pending-review`
  - `candidate`
  - `draft`
  - `needs-rework`
  - `rejected`
- Knowledge card density and readability in dark mode.
- Source affordances on each concept card:
  - open concept
  - copy source reference
- Mobile containment for source action buttons.
- Knowledge Graph dark-mode readability:
  - desktop graph cockpit
  - mobile graph cockpit
  - page-level containment
  - graph demo flow step wrapping
  - graph canvas command bars allowed to scroll internally without creating page overflow

## Result

Static validation passed. Browser-level QA now also passes for:

- Knowledge Browser desktop dark mode
- Knowledge Browser mobile dark mode
- Knowledge Graph desktop dark mode
- Knowledge Graph mobile dark mode

Screenshots and machine-readable QA output are stored in `docs/visual-qa/screenshots-20260809-browser/`.

Additional deployed checks on 2026-08-10 confirmed:

- Knowledge Browser actor-use badges render on GitHub Pages without overflow.
- Review/Production cockpit loads live probe evidence and exposes Knowledge Fabric / Agentic Butler URL blockers.
- Knowledge Browser actor-use lanes render in desktop and mobile dark mode:
  - `Trusted`
  - `Review before trust`
  - `Source gap`
  - `Needs rework`
- Current deployed app URL: `https://florianliepe.github.io/meids-app/`
- Latest verified deployment commit for credential-boundary documentation: `e5e2a92`.

Latest local QA pass for review-lane grouping:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-knowledge-review-lanes`
- Targeted Playwright DOM assertions for `#knowledgeReviewLanes` at `390px` and `1440px`.

Screenshots for this pass are stored in `docs/visual-qa/screenshots-20260810-knowledge-review-lanes/`.

Latest local QA pass for graph actor-use lanes:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-graph-actor-use-lanes`
- Targeted Playwright DOM assertions for `#graphActorUseLanes` at `390px` and `1440px`.

Screenshots for this pass are stored in `docs/visual-qa/screenshots-20260810-graph-actor-use-lanes/`.

Latest local QA pass for graph node source/evidence contract:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-graph-node-source-contract`
- Targeted Playwright DOM assertions select a graph node and verify `.graph-node-source-contract` at `390px` and `1440px`.

Screenshots for this pass are stored in `docs/visual-qa/screenshots-20260810-graph-node-source-contract/`.

Latest local QA pass for graph promotion decision polish:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-graph-promotion-decision-polish`
- Targeted Playwright DOM assertions select the pending candidate relation and verify `.graph-promotion-decision-summary` plus three promotion decision actions at `390px` and `1440px`.

Screenshots for this pass are stored in `docs/visual-qa/screenshots-20260810-graph-promotion-decision-polish/`.

Latest local QA pass for the Production agent handoff timeline:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-agent-handoff-timeline`
- Targeted Playwright DOM assertions open the Production tab and verify `.agent-trace-handoff-timeline` renders Actor Twin, Knowledge Fabric Agent, and Agentic Butler without overflow at `390px` and `1440px`.

Screenshots for this pass are stored in `docs/visual-qa/screenshots-20260810-agent-handoff-timeline/`.

Latest local QA pass for the Knowledge Browser source contract strip:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-knowledge-source-contract-strip`

This pass adds a per-concept source contract strip for review state, source linkage, evidence readiness, and Actor Twin use policy. Screenshots are stored in `docs/visual-qa/screenshots-20260810-knowledge-source-contract-strip/`.

Latest local QA pass for n8n live-probe fixture coverage:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-agent-config-export.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/replay-n8n-fixtures.cjs --write`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-n8n-live-probe-fixtures`

This pass makes `live_probe` a required replay case for Actor Twin, Knowledge Fabric Agent, and Agentic Butler. The public replay artifact now reports 15 fixture cases. Screenshots are stored in `docs/visual-qa/screenshots-20260810-n8n-live-probe-fixtures/`.

Latest local QA pass for n8n live-probe payload affordances:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-agent-config-export.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/replay-n8n-fixtures.cjs --write`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-live-probe-payload-affordance`

This pass exposes the public-safe `live_probe` envelopes in the replay artifact, uses the same envelopes for cockpit live probes, and adds copy affordances for n8n workflow testing. The public replay artifact reports three agents with probe payloads and 15 replay cases. Screenshots are stored in `docs/visual-qa/screenshots-20260810-live-probe-payload-affordance/`.

Latest local QA pass for Production live-gate evidence board:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-agent-config-export.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/replay-n8n-fixtures.cjs --write`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-agent-live-gate-board`
- Targeted Playwright assertions open `?view=quality&quality=production`, expand the production repository stage, and verify `.production-agent-live-gate-board` at `390px` and `1440px`.

This pass adds a Production Cockpit live-gate evidence board that distinguishes contract fixture readiness, configured URL, live probe, and non-demo trace evidence for Actor Twin, Knowledge Fabric Agent, and Agentic Butler. The board exposes three public-safe probe payload copy actions and remains contained in dark mode. Screenshots are stored in `docs/visual-qa/screenshots-20260810-agent-live-gate-board/`.

Latest local QA pass for the Knowledge Graph relation review queue:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-agent-config-export.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/replay-n8n-fixtures.cjs --write`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-graph-relation-review-queue`
- Targeted Playwright assertions open `?view=graph` and verify `.graph-relation-review-head`, review bands, candidate flags, action buttons, and zero horizontal overflow at `390px` and `1440px`.

This pass broadens the graph governance queue from duplicate/contradiction-only review to a visible relation review queue for candidate, inferred, duplicate, and contradiction edges. Candidate relations remain explainable but untrusted until accepted. Screenshots are stored in `docs/visual-qa/screenshots-20260810-graph-relation-review-queue/`.

Latest local QA pass for Knowledge Fabric ingest path status:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-agent-config-export.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/replay-n8n-fixtures.cjs --write`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-knowledge-fabric-ingest-path-status`
- Targeted Playwright assertions open `?view=ingest` and verify `.knowledge-fabric-path-panel`, six lifecycle gates, three boundary cards, dark mode, and zero horizontal overflow at `390px` and `1440px`.

This pass adds a Source Upload ingest-path status panel for source intake, pending OKF, evidence/CRUD, human review, graph curator, and vector boundary. The panel keeps local/static operation explicit until the live Knowledge Fabric and Butler n8n URLs are configured. Screenshots are stored in `docs/visual-qa/screenshots-20260810-knowledge-fabric-ingest-path-status/`.

Latest local QA pass for Chat contract health badges:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-agent-config-export.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/replay-n8n-fixtures.cjs --write`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-chat-contract-health-badges`
- Targeted Playwright assertions open `?view=chat`, expand Interaction setup, and verify Actor Twin, Knowledge Fabric Agent, Agentic Butler, contract stage pills, dark mode, and zero horizontal overflow at `390px` and `1440px`.

This pass adds explicit Chat contract health stages beside the interaction modes: Documented, Fixture, Tested, and n8n. Public fixture replay remains contract-tested for all three top-level agents; live n8n connection remains a separate gate until webhook URLs are configured. Screenshots are stored in `docs/visual-qa/screenshots-20260810-chat-contract-health-badges/`.

Latest local QA pass for Knowledge source panel dark-mode polish:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-agent-config-export.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/replay-n8n-fixtures.cjs --write`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-knowledge-source-panel-polish`
- Targeted Playwright assertions open `?view=concepts` and verify the Knowledge source panel, source contract strip, source-use labels, dark mode, and zero horizontal overflow at `390px` and `1440px`.

This pass widens the Knowledge source column, stacks source-use metadata into a contained single column, and moves the source panel beneath the increment on narrower layouts. Source readiness, evidence, actor-use, decision-interface, and vector labels remain visible without clipping in dark mode. Screenshots are stored in `docs/visual-qa/screenshots-20260810-knowledge-source-panel-polish/`.

Latest local QA pass for GitHub Pages n8n runtime injection:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-agent-config-export.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/replay-n8n-fixtures.cjs --write`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-pages-runtime-injection`

This pass applies the GitHub Pages workflow runtime config boundary for all three top-level agents. Repository secrets can now populate Actor Twin, Knowledge Fabric Agent, and Agentic Butler webhook slots at deploy time, while the UI still reports `awaiting_url` until the corresponding public UAT URLs exist. Screenshots are stored in `docs/visual-qa/screenshots-20260810-pages-runtime-injection/`.

Latest local QA pass for Knowledge Graph trust legend:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-agent-config-export.cjs`
- `node scripts/replay-n8n-fixtures.cjs --write`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-graph-trust-legend`
- Targeted Playwright assertions open `?view=graph` and verify the trust-boundary legend, five-step relation promotion lifecycle, relation review queue, dark mode, and zero horizontal overflow at `390px` and `1440px`.

This pass makes graph use policy explicit: trusted edges are safe for Actor Twin reasoning, inferred edges are explainable-only, and candidate/duplicate/contradiction/rework edges remain review-gated. Screenshots are stored in `docs/visual-qa/screenshots-20260810-graph-trust-legend/`.

Latest local QA pass for Knowledge Graph selected-edge actions:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-agent-config-export.cjs`
- `node scripts/replay-n8n-fixtures.cjs --write`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-graph-selected-edge-actions`
- Targeted Playwright assertions open `?view=graph`, select a graph edge, and verify `.graph-selected-edge-brief`, `.graph-selected-edge-actions`, `Use relation`, `Govern relation`, dark mode, and zero horizontal overflow at `390px` and `1440px`.

This pass separates selected-edge actions into usage and governance groups so users can distinguish actor/skill reuse from relation promotion decisions before relying on inferred graph context. Screenshots are stored in `docs/visual-qa/screenshots-20260810-graph-selected-edge-actions/`.

Latest local QA pass for Knowledge/Graph agent boundary strips:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-agent-config-export.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/replay-n8n-fixtures.cjs --write`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-agent-boundary-strips`
- Targeted Playwright assertions open `?view=concepts` and `?view=graph`, verify visible `.agent-runtime-boundary-strip`, Knowledge Fabric Agent, Actor Twin on graph, fixture/live URL wording, dark mode, and zero horizontal overflow at `390px` and `1440px`.

This pass makes the fixture/live boundary visible directly in the Knowledge Fabric and Graph panels: OKF validation and fixture replay can be green while live n8n ingest/curation remains gated by missing Knowledge Fabric Agent and Agentic Butler URLs. Screenshots are stored in `docs/visual-qa/screenshots-20260810-agent-boundary-strips/`.

Latest local QA pass for Knowledge Fabric lifecycle trace:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-agent-config-export.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/replay-n8n-fixtures.cjs --write`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-knowledge-lifecycle-trace`
- Targeted Playwright assertions open `?view=quality`, activate the Production tab, and verify visible `.knowledge-fabric-lifecycle-trace`, source capture, pending OKF concept, evidence/CRUD, graph curator, vector boundary, live n8n handoff, dark mode, and zero horizontal overflow at `390px` and `1440px`.

This pass adds a visible Knowledge Fabric lifecycle trace in the Review/Production cockpit. It shows the route from upload/transcript/source context to pending OKF concept, evidence storage, CRUD audit, graph curator handoff, vector boundary, and live n8n gate. Screenshots are stored in `docs/visual-qa/screenshots-20260810-knowledge-lifecycle-trace/`.

Latest local QA pass for Knowledge Browser card state ribbon:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-agent-config-export.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/replay-n8n-fixtures.cjs --write`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-knowledge-card-state-ribbon`
- Targeted Playwright assertions open `?view=concepts` and verify visible `.knowledge-card-state-ribbon`, Review, Evidence, Actor use, Vector, dark mode, and zero horizontal overflow at `390px` and `1440px`.

This pass adds a compact review-state ribbon to every Knowledge Browser concept card. It makes review status, evidence readiness, Actor Twin use policy, and vector readiness scannable without relying on the larger source panel. Screenshots are stored in `docs/visual-qa/screenshots-20260810-knowledge-card-state-ribbon/`.

Latest local QA pass for lifecycle graph handoff actions:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-agent-config-export.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/replay-n8n-fixtures.cjs --write`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-lifecycle-graph-handoff-actions`
- Targeted Playwright assertions open `?view=dashboard&dashboard=traces` and verify visible `.knowledge-fabric-lifecycle-actions`, Open graph, Export graph history, Export OKF + graph package, Copy repo sync JSON, dark mode, and zero horizontal overflow at `390px` and `1440px`.

This pass adds graph-curator handoff actions directly to the Knowledge Fabric lifecycle trace. Reviewers can now move from lifecycle evidence to graph inspection, graph promotion history export, OKF+graph package export, or repo-sync JSON without hunting through lower dashboard panels. Screenshots are stored in `docs/visual-qa/screenshots-20260810-lifecycle-graph-handoff-actions/`.

Latest local QA pass for trusted retrieval readiness:

- `node --check frontend/app.js`
- `node scripts/pages-smoke-check.cjs frontend`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- Targeted Playwright assertions open `?view=quality&quality=production`, expand the Production/Repository cockpit disclosures, and verify visible `.trusted-retrieval-readiness`, five readiness cards, dark mode, and zero horizontal overflow at `390px` and `1440px`.

This pass adds a compact trusted retrieval readiness panel to the Production/Review Cockpit. It ties OKF source trust, graph relation promotion, vector adapter boundary, Postgres graph projection, and live n8n handoff state into one operator-readable signal. Screenshots are stored in `docs/visual-qa/screenshots-20260810-trusted-retrieval-readiness/`.

Latest local QA pass for Chat live URL setup actions:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- Targeted Playwright assertions open `?view=chat`, verify visible `.chat-runtime-missing-card`, Knowledge Fabric Agent and Agentic Butler missing URL labels, setup/copy actions, open Interaction setup drawer, dark/light containment, and zero horizontal overflow at `390px` and `1440px`.

This pass moves the missing live n8n URL action from the collapsed setup drawer into the primary Chat workspace. Actor Twin remains configured; Knowledge Fabric Agent and Agentic Butler remain fixture-tested but blocked from live routing until public UAT webhook URLs are added. Screenshots are stored in `docs/visual-qa/screenshots-20260810-chat-live-url-setup/`.

Latest local QA pass for Production URL resolution checklist:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- Targeted Playwright assertions open `?view=quality&quality=production`, activate the Production tab, verify visible `.production-agent-url-resolution-checklist`, three agent rows, fixture-to-live columns, Knowledge Fabric Agent and Agentic Butler missing URL steps, copy checklist action, and zero horizontal overflow at `390px` and `1440px`.

This pass adds a compact operator checklist in the Production Cockpit that maps each top-level agent from fixture contract to live n8n URL, probe, trace, and approval evidence. It makes the remaining live URL blocker explicit before production trace review. Screenshots are stored in `docs/visual-qa/screenshots-20260810-production-url-resolution-checklist/`.

Latest local QA pass for Production n8n workflow handoff packet:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- Targeted Playwright assertions open `?view=quality&quality=production`, activate the Production tab, verify visible `.production-n8n-handoff-packet`, Knowledge Fabric Agent and Agentic Butler workflow briefs, public UAT secret keys, ingest/approval language, copy actions, and zero horizontal overflow at `390px` and `1440px`.

This pass adds a copyable n8n workflow handoff packet to the Production Cockpit. It gives the n8n builder the missing workflow briefs, fixture contracts, runtime keys, GitHub secret names, probe payloads, and post-creation sequence required before Knowledge Fabric Agent and Agentic Butler can move from fixture-ready to live UAT. Screenshots are stored in `docs/visual-qa/screenshots-20260810-production-n8n-handoff-packet/`.

Latest local QA pass for Knowledge source status polish:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-knowledge-source-status-polish`
- Browser QA covers Knowledge Browser, Knowledge Graph, and trace dashboard in dark mode at `1440px` and `390px`; all six cases passed with no horizontal overflow.

This pass tightens Knowledge Browser card density and source readability. Concept cards now carry a card-level source state, expose a compact `Source linked` / `Source needed` action status beside Open/Copy actions, and use stronger dark-mode source-state contrast. The same QA pass also fixed Graph demo-step label containment so desktop graph labels no longer overflow. Screenshots are stored in `docs/visual-qa/screenshots-20260810-knowledge-source-status-polish/`.

Latest local QA pass for Knowledge Graph legend/detail polish:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-graph-legend-detail-polish`
- Browser QA covers Knowledge Browser, Knowledge Graph, and trace dashboard in dark mode at `1440px` and `390px`; all six cases passed with no horizontal overflow.

This pass adds a compact Graph legend use-policy strip for `Answer`, `Explore`, and `Gate`. It makes Actor Twin graph behavior explicit: approved/explicit fabric can ground answers, inferred relations remain exploration context with citation, and draft/candidate relations stay review-gated. Dark-mode styling was added for the new policy strip and verified in the graph cockpit. Screenshots are stored in `docs/visual-qa/screenshots-20260810-graph-legend-detail-polish/`.

Latest local QA pass for Knowledge Graph selected-relation lifecycle:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-graph-selected-relation-lifecycle`
- Targeted Playwright assertion opens `?view=graph`, selects a graph edge, verifies visible `.graph-selected-edge-lifecycle`, confirms four lifecycle steps, dark mode, and zero horizontal overflow.
- Browser QA covers Knowledge Browser, Knowledge Graph, and trace dashboard in dark mode at `1440px` and `390px`; all six cases passed with no horizontal overflow.

This pass adds a selected-relation lifecycle trace for graph edges. It shows `Captured`, `Evidence`, `Review`, and `Actor use` so reviewers can see whether a relation is ready for trusted Actor Twin reasoning, citation-only exploration, or governance before skill reuse. Screenshots are stored in `docs/visual-qa/screenshots-20260810-graph-selected-relation-lifecycle/`.

Latest local QA pass for Chat agent route cards:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-chat-agent-route-cards`
- Targeted Playwright assertion starts a local static server, opens `?view=chat`, injects public-safe fixture responses for Actor Twin, Knowledge Fabric Agent, and Agentic Butler, verifies three `.agent-response-route-card` elements, confirms the Agentic Butler approval-required route card, and checks zero text overflow.

This pass clarifies Chat output cards for the three-agent model. Agent responses now show route purpose, interaction mode, knowledge-fabric use, governance boundary, next action, and contract stage chips directly inside the result card. This keeps Chat focused while still making agent behavior auditable. Screenshots are stored in `docs/visual-qa/screenshots-20260810-chat-agent-route-cards/`.

Latest local QA pass for Chat contract-health cards:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-chat-contract-health-cards`
- Targeted Playwright assertion starts a local static server, opens `?view=chat`, injects public-safe fixture responses for Actor Twin, Knowledge Fabric Agent, and Agentic Butler, verifies three `.agent-response-contract-health` blocks, verifies stage rows are visible, and checks zero text overflow.

This pass adds active contract health directly inside Chat agent result cards. Each result now carries the same contract state model as the mode badges: stage readiness, runtime boundary, gate count, fixture/live state, and next action. Screenshots are stored in `docs/visual-qa/screenshots-20260810-chat-contract-health-cards/`.

Latest local QA pass for probe evidence timestamps:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-probe-evidence-timestamps`
- Targeted Playwright assertion starts a local static server, records blocked probes through `probeAgentContract`, verifies Chat `.agent-response-probe-evidence`, verifies dashboard `.dashboard-agent-probe-evidence`, confirms checked timestamp and last-error text, and checks zero text overflow.

This pass makes live probe evidence more auditable. Blocked, configured, fixture, connected, and failed probe results now carry `checked_at`, `trace_id` when available, `runtime`, and `last_error`. Chat cards and the cockpit probe strip render timestamp and failure evidence without inventing trace ids for blocked probes. Screenshots are stored in `docs/visual-qa/screenshots-20260810-probe-evidence-timestamps/`.

Latest local QA pass for Knowledge Fabric item lifecycle preview:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-knowledge-fabric-item-lifecycle`
- Targeted Playwright assertion starts a local static server, opens `?view=ingest`, verifies one visible `#ingest .knowledge-fabric-item-lifecycle`, confirms six lifecycle steps, dark mode, and zero horizontal overflow.

This pass adds a per-handoff Knowledge Fabric lifecycle preview to pending OKF queue cards. Reviewers can see the path from `Source` to `Pending OKF`, `Evidence + CRUD`, `Graph Curator`, `Human Review`, and `Repo + Vector` before deciding whether a handoff can become trusted knowledge. Screenshots are stored in `docs/visual-qa/screenshots-20260810-knowledge-fabric-item-lifecycle/`.

Latest local QA pass for Knowledge Fabric repo-sync eligibility:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-knowledge-fabric-repo-sync-eligibility`
- Targeted Playwright assertion starts a local static server, opens `?view=ingest`, verifies visible `#ingest .knowledge-fabric-repo-sync-eligibility`, confirms six eligibility cells, confirms repo/vector language, dark mode, and zero horizontal overflow.

This pass adds a repo-sync eligibility strip to the Knowledge Fabric queue preview. Operators can see approved handoffs eligible for knowledge-repo PR, pending handoffs, needs-rework items, rejected audit-only items, candidate graph edges, and the vector refresh boundary before exporting reviewed bundles. Screenshots are stored in `docs/visual-qa/screenshots-20260810-knowledge-fabric-repo-sync-eligibility/`.

Latest local QA pass for Knowledge Fabric candidate graph preview:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-knowledge-fabric-candidate-preview`
- Targeted Playwright assertion starts a local static server, opens `?view=ingest`, verifies visible `#ingest .knowledge-fabric-candidate-preview`, confirms candidate relation cards, confirms Graph Curator and confidence language, dark mode, and zero horizontal overflow.

This pass promotes candidate graph relations from a compact tag list into a visible per-handoff Graph Curator preview. Queue reviewers can inspect relation type, source-target direction, confidence, review implication, and graph-curator state before opening the graph cockpit or exporting a reviewed artifact. Screenshots are stored in `docs/visual-qa/screenshots-20260810-knowledge-fabric-candidate-preview/`.

Latest local QA pass for approved OKF + graph handoff export:

- `node --check frontend/app.js`
- `node scripts/validate-n8n-fixtures.cjs`
- `node scripts/validate-okf-fixtures.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/validate-vector-adapter.cjs`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/pages-smoke-check.cjs frontend`
- `NODE_PATH=<bundled-node-modules> node scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260810-knowledge-fabric-okf-graph-export`
- Targeted Playwright assertion starts a local static server, opens `?view=ingest`, verifies `Export OKF + graph` is disabled before approval, approves the handoff, verifies the button is enabled, captures the downloaded JSON, confirms `meids.okf_graph_promotion_package.v1`, confirms one scoped handoff, confirms repo-sync plan presence, and checks zero button overflow.

This pass adds a one-click approved handoff export for the combined OKF + graph promotion package. It keeps trusted promotion approval-gated: pending queue items export as audit artifacts, while approved items can produce a scoped repo-sync package with matching graph candidate decisions and vector refresh boundary. Screenshots are stored in `docs/visual-qa/screenshots-20260810-knowledge-fabric-okf-graph-export/`.

## Browser QA Notes

The browser QA script requires Playwright. In the Codex desktop runtime, run it with the bundled Node package path:

```powershell
$env:NODE_PATH='C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260809-browser
```

## Open Integration Dependency

Live n8n URLs for `Knowledge Fabric Agent` and `Agentic Butler` are still required before the goal can be fully closed.

GitHub Pages workflow-secret injection is active for all three top-level agents. Actor Twin is configured in the deployed runtime config; Knowledge Fabric Agent and Agentic Butler remain `awaiting_url` until their live n8n webhook/status URLs are available as repository secrets.
