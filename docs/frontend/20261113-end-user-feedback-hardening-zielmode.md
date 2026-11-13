# End-user feedback hardening Zielmode

Date: 2026-11-13

## Objective

Keep Actor Twin, Review and Graph focused on the end user's immediate task without changing backend, authorization, agent, graph or persistence contracts.

## Scope

1. Hide completed `Ready` background jobs from Actor Twin while returning newly completed results to the conversation.
2. Preserve natural Review card height inside a viewport-sized scrolling lane.
3. Remove the competing native SVG tooltip and place the compact Graph tooltip away from the hovered node.
4. Suppress secondary neighbor labels only when a hovered neighborhood is dense.
5. Replace repeated per-edge narratives with relationship groups, concise purpose text and selectable connected concepts.

## Safety boundaries

- No backend, database, Search, Blob, Entra, n8n or agent-routing changes.
- No graph-semantic, review-state or persistence changes.
- Graph V1 remains available through the existing runtime flag.
- Production promotion uses only protected pull-request and deployment pipelines.

## Acceptance gates

- Completed background jobs do not render `Ready` rows.
- Running and failed work remains visible; a newly completed result is returned once to chat.
- Review cards remain at least 100 px high and scroll without horizontal overflow.
- Graph V2 renders no native SVG `title` tooltip.
- Compact tooltip does not overlap the focused node.
- Dense neighborhoods do not reveal a wall of overlapping labels.
- Click detail keeps exactly one readiness percentage and no governance actions.
- Connections are grouped by relationship meaning and remain keyboard selectable.
- Desktop/mobile, light/dark, keyboard, reduced-motion and Graph V1 rollback tests pass.
