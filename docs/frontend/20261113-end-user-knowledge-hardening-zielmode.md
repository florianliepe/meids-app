# Me.IDs End-User Knowledge Hardening

## Objective

Make Actor Twin, Review, and Graph understandable and usable for end users without changing APIs, authorization, persistence, graph semantics, review states, or production data.

## Safety Boundaries

- Work on `codex/frontend-hardening-20261113` until protected pipeline validation completes.
- Keep Graph Explorer V1 available through the existing `graph_ui_v2` rollback flag.
- Do not add graph governance actions to the end-user detail surface.
- Do not change backend routes, request payloads, storage, Azure resources, or agent routing.
- Use static fixtures and read-only browser interaction for UAT evidence.

## Implementation Order

1. Strip trace, runtime, adapter, provider, and raw job payloads from Actor Twin answers.
2. Extend the active Review lane to a viewport-sized, independently scrollable queue.
3. Replace technical graph labels with objective, topic, or knowledge-summary labels.
4. Keep hover and keyboard focus compact: topic, readiness, relation count, and source count.
5. Open a wide detail overlay on click or Enter.
6. Limit the detail overlay to meaning, one readiness percentage, sources, relations, and related knowledge.
7. Preserve Escape and explicit close behavior, responsive sizing, reduced motion, and Graph V1 rollback.
8. Validate contracts and browser behavior at 390, 1024, and 1440 pixels in light and dark mode.

## Acceptance Gates

- Actor Twin never renders raw trace or job-result JSON as conversational content.
- The selected Review queue uses available viewport height and has a stable scrollbar.
- Synthetic IDs, UUIDs, and timestamps do not dominate graph labels when semantic content exists.
- Hover/focus does not move nodes and responds below 100 ms at 500 visible nodes.
- Click/Enter opens at least a 600 px detail surface on desktop and a full-width surface on mobile.
- Detail contains exactly one readiness percentage and no accept, reject, promote, or governance controls.
- Escape and the close icon clear selection.
- Graph V1 remains available by disabling `graph_ui_v2`.
- No horizontal overflow or contract regression is introduced.

## Result

- Static Graph, Actor-first, and UAT hardening contracts pass.
- Graph browser matrix passes desktop light/dark, tablet light, and mobile light/dark.
- Hover response remained at or below 1 ms in the tested fixture; the 100/500/1,000-node benchmark passes.
- Actor-first browser matrix passes 16 desktop/mobile views and Graph V1 rollback.
- Evidence: `docs/visual-qa/frontend-hardening-20261113/`.

