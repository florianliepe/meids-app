# Actor-first frontend refinement report

Date: 2026-11-03  
Source: `visual refinement 03.11.2026.pdf`

## Outcome

The daily Me.IDs experience now starts with Actor Twin and keeps specialist surfaces available without making them the default journey.

- Actor Twin is the primary workspace with direct Talk and Add source actions.
- Voice Capture removes the instructional hero and represents readiness with concise text plus a redundant status dot.
- Source Upload presents four equal intake lanes and hides pipeline diagnostics from end users.
- Twin setup and advanced profile fields use progressive disclosure.
- Skill execution remains available while approval operations move to Review Cockpit.
- Knowledge defaults to a compact searchable browser.
- Review defaults to concept review instead of trace diagnostics.
- Graph V2 opens as a large explorer with its rollback-safe feature flag preserved.
- Traces and Production are removed from daily navigation and linked from Admin Cockpit Operations.

## Contract boundary

No backend API, payload, persistence, Entra, RLS, Search, vector, n8n, review-state or graph-semantic contract changed.

## Automated evidence

- `npm run check:backend`
- `npm run check:agents`
- `npm run check:knowledge-access`
- `npm run check:entra-onboarding`
- `npm run check:admin-cockpit`
- `npm run check:graph-explorer`
- `npm run check:uat-hardening`
- `npm run check:visual-artifacts`
- `npm run check:api-parity`
- `npm run uat:device-matrix`
- `npm run check:frontend-actor-first`
- `npm run uat:frontend-actor-first`

The actor-first browser suite covers sixteen desktop/mobile views plus a dedicated Graph V1 rollback case. It verifies no horizontal overflow, visible primary Actor Twin controls, compact voice and source intake, concept-first review, progressive Twin settings, operator-only Production navigation, Graph Advanced disclosure, five-step Guided Setup, and flag-off restoration of legacy Graph controls.

## Adversarial review reconciliation

The anonymized candidate summary was reviewed in the project issue-tracking chat on 2026-11-04. No P0 or P1 finding was established. Four P2 findings were reproduced and fixed before promotion:

- Graph Advanced and flag-off rollback controls were inaccessible because their source containers carried `hidden`.
- Guided Setup was removed from the focus order instead of being a collapsed disclosure.
- Voice readiness relied on hover and color rather than concise visible status text.
- Admin Cockpit opened the Persona subview instead of Production.

The regression suite now exercises both Graph feature-flag states and the affected interactions directly.

Visual evidence is stored in `docs/visual-qa/actor-first-20261103/`.

## Release gate

The project issue-tracking review is reconciled. The candidate remains branch-only until the protected pull-request pipeline passes. Production promotion must preserve `MEIDS_GRAPH_UI_V2=true`; rollback remains a flag-only operation.
