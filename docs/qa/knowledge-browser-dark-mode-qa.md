# Knowledge Browser Dark Mode QA

Date: 2026-08-09

Latest update: 2026-08-10

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

## Browser QA Notes

The browser QA script requires Playwright. In the Codex desktop runtime, run it with the bundled Node package path:

```powershell
$env:NODE_PATH='C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260809-browser
```

## Open Integration Dependency

Live n8n URLs for `Knowledge Fabric Agent` and `Agentic Butler` are still required before the goal can be fully closed.

GitHub Pages workflow-secret injection is prepared in `docs/production/github-pages-agent-runtime-workflow-patch.md`, but updating `.github/workflows/*` is currently blocked by the active GitHub credential lacking `workflow` scope. Until that credential boundary is resolved, use `frontend/assets/agent-runtime-config.json` for intentionally public UAT webhook URLs.
