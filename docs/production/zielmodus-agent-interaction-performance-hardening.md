# Zielmodus: Agent Interaction Performance Hardening

Date: 2026-09-07

## Objective

Close the next robustness gaps for the Me.IDs agent runtime while keeping the frontend lean and preserving Actor Twin as the only user-facing chat.

## Operating Assumptions

- Actor Twin remains the routing authority and visible chat interface.
- Knowledge Fabric, Agentic Butler, Skill Orchestrator, Task Agent, Critical Faculty, and Learning Agent run as n8n workflow-tool subagents.
- Internal analysis, drafting, retrieval, critique, and learning do not require human approval.
- Human approval is required for generated capability activation and real external side effects.
- Public GitHub Pages remains a static UI boundary; durable production persistence belongs in hosted backend/API storage.

## Package 1: Fresh Live Probes For Seven Workflows

Goal: prove the current runtime state for all seven workflows/subagents with fresh evidence, not historical screenshots.

Actions:

1. Ensure `N8N_API_BASE_URL` and `N8N_API_KEY` are available only in backend/operator environment.
2. Run live n8n chat or workflow-tool probes that cover:
   - Actor Twin
   - Knowledge Fabric Agent
   - Agentic Butler
   - Skill Orchestrator
   - Task Agent
   - Critical Faculty Agent
   - Learning Agent
3. Record public-safe execution evidence with:
   - `npm run probe:agents:live -- --since <ISO timestamp>`
   - `npm run audit:agents -- --since <ISO timestamp>`
4. Store results under `docs/uat/`.

Acceptance:

- `docs/uat/n8n-seven-agent-live-probe-evidence.json` exists.
- Fresh successful executions are visible for every workflow, or stale/missing workflows are listed explicitly.
- No API keys, bearer tokens, or raw secrets are written to repo artifacts.

## Package 2: Learning Agent Async/Post-Turn

Goal: prevent normal Actor Twin answers from waiting on learning synthesis.

Actions:

1. Update Actor Twin instruction to prefer post-turn Learning Agent handoff for routine trace learning.
2. Update Learning Agent instruction to return compact inline summaries only when inline execution is explicitly required.
3. In n8n, place normal Learning Agent calls after the user answer path, or run them via a detached workflow execution.

Acceptance:

- Routine chat answers are not blocked by Learning Agent.
- Learning outputs still route to Knowledge Fabric as `review_needed` or `updated_review_needed`.

## Package 3: Timeout And Fallback Summaries

Goal: avoid frontend hangs when nested n8n workflow-tool chains run long or fail.

Actions:

1. Add backend timeout handling for n8n proxy calls with `N8N_AGENT_TIMEOUT_MS`.
2. Return a contract-shaped fallback summary on timeout.
3. In n8n, keep nested tool calls to the minimum required path and add timeout-aware fallback responses where the node supports it.

Acceptance:

- Backend contract validation passes.
- Timeout fallback includes `status`, `agent_id`, `output.answer`, `trace.timeout`, and no secret data.

## Package 4: Knowledge Fabric Duplicate/Merge Detection

Goal: prevent uncontrolled OKF concept duplication.

Actions:

1. Update Knowledge Fabric instruction to check existing concepts before creating a new concept.
2. Return `duplicate_check.status` and `merge_candidates`.
3. Prefer `updated_review_needed` deltas when new content extends an existing concept.
4. Escalate ambiguous or high-impact merge decisions to Critical Faculty.

Acceptance:

- Knowledge Fabric returns merge candidates for overlapping knowledge.
- New concepts are created only when overlap is low or deliberately accepted.

## Package 5: Fresh Skill Orchestrator Audit

Goal: evaluate Skill Orchestrator health using fresh executions only.

Actions:

1. Run a current skill orchestration probe that reaches Skill Orchestrator and Task Agent.
2. Run:
   - `npm run audit:agents -- --agent skill_orchestrator --since <ISO timestamp>`
   - `npm run audit:agents -- --agent task_agent --since <ISO timestamp>`
3. Treat historical failed executions as migration evidence, not current health.

Acceptance:

- Fresh Skill Orchestrator and Task Agent runs are either successful or documented with exact failure cause.
- Runtime p90 from fresh sample stays within the configured UAT budget once enough samples exist.

## Package 6: Modularize Large Code Files

Goal: improve maintainability after runtime behavior is stable.

Actions:

1. Split `frontend/app.js` by responsibility:
   - n8n embedded chat/runtime config
   - local staging storage
   - twin profile UI
   - knowledge/review/trace cockpit UI
   - voice capture UI
2. Split `frontend/styles.css` into layout, components, forms, cockpit, and embedded chat styles.
3. Split `backend/server.js` into route registration, n8n proxy, trace store, approval store, vector endpoints, and static hosting.
4. Keep public contracts stable during extraction.

Acceptance:

- Existing backend, agent, static build, and UAT smoke tests pass after each extraction.
- No unrelated UI redesign is bundled into modularization.

## Current Execution Notes

- Repo-side changes implemented in this package:
  - backend n8n timeout fallback;
  - seven-agent live probe evidence script;
  - fresh-execution filters for runtime audit;
  - Learning Agent async/post-turn instructions;
  - Knowledge Fabric duplicate/merge instruction.
- n8n UI changes still requiring operator verification:
  - detached/post-turn Learning Agent placement;
  - workflow-tool timeout fallback configuration where supported;
  - fresh Skill Orchestrator and Task Agent probes through the live Actor Twin path.

## Test Command Set

```powershell
npm run check:backend
npm run check:agents
$env:N8N_API_BASE_URL=[Environment]::GetEnvironmentVariable('N8N_API_BASE_URL','User'); $env:N8N_API_KEY=[Environment]::GetEnvironmentVariable('N8N_API_KEY','User'); npm run audit:agents
$env:N8N_API_BASE_URL=[Environment]::GetEnvironmentVariable('N8N_API_BASE_URL','User'); $env:N8N_API_KEY=[Environment]::GetEnvironmentVariable('N8N_API_KEY','User'); npm run probe:agents:live -- --since 2026-09-07T00:00:00.000Z
node scripts/build-pages-static.cjs --output dist-pages-check-hardening
```

## Next Refinement Order

1. Produce fresh live probes through the embedded Actor Twin chat for all seven workflows.
2. Publish n8n post-turn Learning Agent routing.
3. Validate timeout behavior against a deliberately slow/stalled n8n test workflow.
4. Implement Knowledge Fabric merge UX in the review cockpit if duplicate candidates become frequent.
5. Run fresh Skill Orchestrator and Task Agent audit with old execution history excluded.
6. Start modularization only after the above runtime behavior is stable.
