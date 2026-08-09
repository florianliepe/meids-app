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

## Result

Static validation passed. The Knowledge Browser now has final dark-theme overrides that preserve review-state color coding after broad theme rules are applied.

## Remaining QA Gap

Automated browser screenshot QA is not available in the current repo/runtime because Playwright is not installed. A future pass should add a lightweight browser visual QA runner for:

- Knowledge Browser desktop
- Knowledge Browser mobile
- Knowledge Graph desktop
- Knowledge Graph mobile

## Open Integration Dependency

Live n8n URLs for `Knowledge Fabric Agent` and `Agentic Butler` are still required before the goal can be fully closed.
