# Graph Explorer V2: visual refinement iteration 2

Date: 2026-10-29
Branch: `feature/graph-explorer-v2`
Deployment boundary: Azure Static Web App pull-request preview only

## Objective

Refine the V2 topology into a quieter, Obsidian-inspired knowledge explorer without changing graph data, semantics, APIs, persistence, authorization, n8n workflows, review states, or the production default.

## Reference behavior

The official Obsidian Graph View uses circles for nodes, lines for links, hover to highlight connections, configurable node size and link thickness, text fading, colored groups, and depth-controlled local graphs. Me.IDs adopts those interaction principles while retaining fixed positions and explicit governance semantics.

Reference: <https://obsidian.md/help/plugins/graph>

## Zielmode instructions

1. Continue on the existing feature branch and preview deployment. Do not merge or deploy production.
2. Keep `graphExplorerV2` disabled by default and leave V1 untouched.
3. Render degree-scaled dots with 5.5-14 px visible radii and 28-36 px invisible targets.
4. Render resting relations at approximately 0.65-1.35 px, preserving solid explicit, dashed inferred, and dotted candidate semantics.
5. Hide labels at rest except for locked or active-path context. Reveal the hovered or keyboard-focused neighborhood without moving nodes.
6. Use neutral grey as the base, muted teal for trusted knowledge, blue-grey for evidence, amber for candidates, and red only for rework or contradiction.
7. Keep tooltip delay, selection drawer, local depth, layer controls, List view, keyboard operation, reduced motion, and all governance actions.
8. Extend contract and Playwright tests for compact geometry, quiet labels, layer distinction, hover reveal, hit targets and edge thickness.
9. Re-run V1 regression, V2 interaction and visual matrices, synthetic 100/500/1,000-node benchmarks, and CI.
10. Publish only the updated pull-request preview and retain flag-only rollback.

## Acceptance gates

- No changed API paths, requests, payloads or persistence behavior.
- Production remains `graphExplorerV2=false`.
- Visible node radius does not exceed 14 px in V2.
- Invisible node targets remain 28-36 px.
- At-rest labels remain below 20% of visible nodes, with a small allowance for active-path context.
- Resting edge width does not exceed 1.7 px.
- Hover and focus reveal labels, neighbors and connecting edges without layout shift.
- The 500-node hover benchmark remains below 100 ms p95.
- V1 graph regression and all graph contract tests remain green.

## Decisions

- Stable deterministic layout remains preferable to continuous force animation.
- Color never carries meaning alone; line style and review state remain available.
- Node initials are hidden in compact V2 dots. Titles and metadata remain available through hover, focus, selection and List view.
- Presentation layers are derived client-side from existing node type and review state; no graph semantics are rewritten.

## Verification results

| Gate | Result |
| --- | --- |
| Maximum visible dot radius | Passed: 7.9 px in the current fixture; hard cap 14 px |
| Invisible target size | Passed: 32 px diameter |
| Labels visible at rest | Passed: 2 of 4, both from active-path context |
| Maximum resting edge width | Passed: 1.41 px |
| Desktop/tablet/mobile, light/dark | Passed: 5 of 5 cases |
| Keyboard, tooltip, selection and List view | Passed |
| Existing V1 dark-mode regression | Passed: 6 of 6 cases |
| Existing V2 governance and promotion actions | Passed: 6 of 6 regression cases |
| Graph schema, promotion and persistence contracts | Passed |
| Adjacent API, knowledge access, Entra and admin contracts | Passed |
| 100-node hover p95 | 1.2 ms |
| 500-node hover p95 | 2.7 ms |
| 1,000-node hover p95 | 4.9 ms |

No `/api/` literal changed in this iteration. The production feature flag remains disabled.
