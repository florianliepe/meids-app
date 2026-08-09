# Knowledge Browser Dark Mode QA

Date: 2026-08-09

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

## Browser QA Notes

The browser QA script requires Playwright. In the Codex desktop runtime, run it with the bundled Node package path:

```powershell
$env:NODE_PATH='C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/browser-dark-mode-qa.cjs frontend docs/visual-qa/screenshots-20260809-browser
```

## Open Integration Dependency

Live n8n URLs for `Knowledge Fabric Agent` and `Agentic Butler` are still required before the goal can be fully closed.
