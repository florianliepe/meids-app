# Me.IDs Actor-First Frontend Refinement

## Objective

Make the Me.IDs frontend feel like one calm interaction with the Actor Twin. Keep all production contracts, authorization, persistence, graph semantics, n8n routing, review states, and data unchanged.

## Safety Boundaries

- Work on `codex/frontend-actor-first-20261103` until validation is complete.
- Do not change backend, database, Search, vector, n8n, Entra, or API contracts.
- Do not mutate production data during visual or interaction tests.
- Preserve every existing function, but move diagnostics and production operations into Admin or Review contexts.
- Keep rollback limited to reverting the frontend commit.

## Implementation Order

1. Capture the current visual and DOM baseline.
2. Make Actor Twin the first and dominant workspace.
3. Keep voice and single-source intake directly beside the chat.
4. Remove explanatory heroes, lifecycle diagrams, and internal routing language from daily views.
5. Reduce Voice Capture to recording, editable transcript, clarification, drafts, and save.
6. Reduce Source Upload to four equal intake options and one concise result area.
7. Keep Knowledge focused on search and readable increments; keep advanced signals collapsed.
8. Make Review concept-first and move traces and production operations to Admin Cockpit.
9. Simplify Twins and Skills to registry/profile and authoring/catalog respectively.
10. Expand Graph canvas and retain details only after selection.
11. Validate desktop/mobile, light/dark, keyboard, overflow, and unchanged network contracts.
12. Ask the project issue-tracking chat for adversarial test cases, run them, and refine before production promotion.

## Acceptance Gates

- Actor Twin, Talk, and Add source are visible without scrolling on desktop.
- Daily pages have one primary task and no internal n8n/MCP/production instructions.
- Voice transcript remains editable and drafts remain resumable.
- Production and trace functions remain reachable from Admin Cockpit within two interactions.
- No API URL, request payload, authorization, storage, or n8n workflow changes.
- No horizontal overflow at 390, 1024, or 1440 pixels.
- Existing backend, agent, knowledge, Entra, Admin, Graph, UAT, visual-artifact, and API-parity checks remain green.
