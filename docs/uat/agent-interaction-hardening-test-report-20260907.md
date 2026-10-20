# Agent Interaction Hardening Test Report - 2026-09-07

## Scope

Validate the current repository state for robust and performant agent
interaction hardening.

## Test Plan

```powershell
npm run check:backend
npm run check:agents
npm run audit:agents
npm run probe:agents:live -- --since 2026-09-07T00:00:00.000Z
npm run audit:agents -- --since 2026-09-07T00:00:00.000Z
npm run audit:agents -- --agent skill_orchestrator --since 2026-09-07T00:00:00.000Z --output docs/uat/skill-orchestrator-fresh-runtime-audit.json
node scripts/build-pages-static.cjs --output dist-pages-check-hardening
```

## Expected Result

- Backend contract checks pass.
- Agent fixture and routing checks pass.
- Agent runtime audit writes current prompt/runtime metrics.
- Static Pages artifact builds and passes smoke checks.

## Actual Result

| Check | Result | Evidence |
|---|---|---|
| Backend contracts | Passed | `npm run check:backend` |
| Agent fixtures/routing | Passed | `npm run check:agents` |
| Agent runtime audit | Passed | `docs/uat/agent-runtime-performance-audit.json` |
| Seven-agent live probe evidence | Passed | `docs/uat/n8n-seven-agent-live-probe-evidence.json` shows 7/7 fresh connected |
| Fresh Skill Orchestrator audit | Passed | `docs/uat/skill-orchestrator-fresh-runtime-audit.json` |
| Fresh Task Agent audit | Passed | `docs/uat/task-agent-fresh-runtime-audit.json` |
| Static Pages build smoke | Passed | `node scripts/build-pages-static.cjs --output dist-pages-check-hardening` |

## Runtime Findings

Measured through `scripts/audit-agent-runtime-performance.cjs` using persisted
n8n API environment variables.

| Agent | Sample | Success | Failures | p50 | p90 | Max |
|---|---:|---:|---:|---:|---:|---:|
| Actor Twin | 10 | 10 | 0 | 29.1s | 89.5s | 142.4s |
| Knowledge Fabric Agent | 10 | 10 | 0 | 11.2s | 55.2s | 79.0s |
| Agentic Butler | 10 | 9 | 1 | 46.1s | 150.2s | 238.0s |
| Skill Orchestrator | 10 | 2 | 8 | 0.3s | 111.0s | 217.9s |
| Task Agent | 8 | 8 | 0 | 14.3s | 54.9s | 54.9s |
| Critical Faculty | 2 | 2 | 0 | 27.4s | 51.8s | 51.8s |
| Learning Agent | 1 | 1 | 0 | 132.9s | 132.9s | 132.9s |

Fresh audit after 2026-09-07 live probes:

| Agent | Fresh sample | Success | Failures | p50 | p90 | Max |
|---|---:|---:|---:|---:|---:|---:|
| Actor Twin | 5 | 5 | 0 | 44.6s | 186.2s | 186.2s |
| Knowledge Fabric Agent | 3 | 3 | 0 | 65.1s | 171.0s | 171.0s |
| Agentic Butler | 1 | 1 | 0 | 36.8s | 36.8s | 36.8s |
| Skill Orchestrator | 1 | 1 | 0 | 26.4s | 26.4s | 26.4s |
| Task Agent | 1 | 1 | 0 | 7.0s | 7.0s | 7.0s |
| Critical Faculty | 4 | 4 | 0 | 17.2s | 34.2s | 34.2s |
| Learning Agent | 2 | 2 | 0 | 81.4s | 112.9s | 112.9s |

After next-refinement SLO probes:

| Agent | Fresh sample | Success | Failures | p50 | p90 | Max |
|---|---:|---:|---:|---:|---:|---:|
| Skill Orchestrator | 3 | 3 | 0 | 26.4s | 26.7s | 26.7s |
| Task Agent | 3 | 3 | 0 | 10.2s | 10.9s | 10.9s |

Interpretation:

- Seven-agent connectivity is verified with fresh live n8n executions.
- Actor Twin and Knowledge Fabric are stable enough for UAT, but still slow in
  nested routes.
- Agentic Butler and Learning Agent should not run long nested chains inline for
  routine chat turns.
- Skill Orchestrator historical failures are no longer current-health evidence;
  the fresh sample succeeded in 26.4s.
- Static Pages readiness still reports pending direct URLs/probe traces for two
  internal agents. This is expected under the current architecture because those
  agents are internal n8n tools behind Actor Twin.

## Applied Hardening

- Added runtime-budget guardrails to source prompts.
- Applied live n8n runtime-budget guardrails to Actor Twin, Agentic Butler, and
  Knowledge Fabric.
- Resynced Skill Orchestrator, Task Agent, Critical Faculty, and Learning Agent
  live workflows from source-controlled prompts.
- Added `npm run audit:agents`.
- Added `npm run probe:agents:live`.
- Added backend n8n timeout fallback through `N8N_AGENT_TIMEOUT_MS`.
- Added fresh-execution filtering to the runtime audit.
- Added Learning Agent async/post-turn guidance.
- Added Knowledge Fabric duplicate/merge detection guidance.
- Applied live n8n next-refinement guardrails:
  `exports/n8n-live-backups/20260907T193412Z-next-refinement-guardrails`.
- Added next-refinement execution doc:
  `docs/production/zielmodus-next-refinement-runtime-hardening.md`.
- Added production hardening docs:
  - `docs/production/agent-interaction-hardening-open-points.md`
  - `docs/production/zielmodus-agent-interaction-performance-hardening.md`
  - `docs/production/codebase-review-refactoring-zielmodus.md`
  - `docs/production/azure-installation-playbook.md`
  - `docs/production/deployable-codebase-map.md`

## Notes

- n8n live performance metrics require `N8N_API_BASE_URL` and `N8N_API_KEY` in
  the executing environment.
- Static Pages build folders are generated evidence and should not be treated as
  deployable source.
- Production hardening still requires backend/Postgres persistence and stable
  live contract probes for every internal workflow tool.

## Next Refinement

1. Publish n8n Learning Agent placement as a detached/post-turn branch where the
   workflow runtime supports it.
2. Add n8n-node-level timeout/fallback summaries for workflow-tool calls that
   can exceed the backend timeout.
3. Back Knowledge Fabric duplicate/merge detection with real vector and graph
   retrieval scores.
4. Add a second fresh Skill Orchestrator/Task Agent sample before setting a
   production runtime SLO.
5. Split `frontend/app.js` and `frontend/styles.css` after embedded Actor Twin
   UAT behavior is frozen.
6. Split `backend/server.js` into routes/adapters before production persistence
   expansion.

## Boundary Solving Path - 2026-09-07

Applied:

- Added backend `POST /api/learning/post-turn` for detached Learning Agent
  dispatch.
- Added backend `POST /api/knowledge/duplicate-check` for score-backed
  duplicate/merge preflight.
- Added live n8n Learning Agent webhook entrypoint:
  `POST /webhook/meids/learning/dispatch`.
- Added Knowledge Fabric duplicate-score input contract.
- Added `npm run n8n:boundaries:apply`.

Validation:

- Local `POST /api/learning/post-turn` returned `202 accepted`.
- Direct n8n `POST /webhook/meids/learning/dispatch` returned successfully.
- Local `POST /api/knowledge/duplicate-check` returned
  `duplicate_check.status=insufficient_evidence` because Azure AI Search
  secrets were not configured locally. This is the intended safe fallback.
- `npm run check:backend` passed.
- `npm run check:agents` passed.
- `npm run probe:agents:live -- --since 2026-09-07T00:00:00.000Z` passed with
  7/7 fresh connected.

Remaining runtime work:

- Wire the Knowledge Fabric n8n workflow to call the hosted backend
  `/api/knowledge/duplicate-check` before the AI Agent node and pass the result
  as `duplicate_score_evidence`.
- Add the actual post-turn caller after Actor Twin answers: backend trace-store
  event hook, scheduled n8n trace poller, or frontend callback if embedded chat
  exposes completed-message events.

## Boundary Retest - 2026-09-08

Applied:

- Backend trace-store hook now dispatches Learning Agent post-turn work when a
  stored trace contains `trace_learning_recommended`.
- Knowledge Fabric workflow now has pre-agent duplicate evidence topology.
- Live n8n workflows were republished from the source workflow JSON through the
  n8n API.

Observed root cause:

- n8n blocks `$env` reads inside node expressions in the current runtime
  (`N8N_BLOCK_ENV_ACCESS_IN_NODE`). The first HTTP scoring node failed when it
  attempted to read `$env.MEIDS_BACKEND_URL`.

Mitigation applied:

- Republished Knowledge Fabric with a fallback scoring node because no hosted
  backend URL was available locally. This returns
  `duplicate_check.status=insufficient_evidence` and keeps UAT from failing.
- The publish script now materializes a static backend URL when
  `MEIDS_BACKEND_URL`, `AGENT_BACKEND_BASE_URL`, or `GH_PAGES_API_BASE_URL` is
  provided at publish time.

Validation:

- `npm run check:backend` passed.
- `npm run check:agents` passed.
- Static Pages build passed:
  `dist-pages-check-boundary-20260908`.
- Knowledge Fabric live UAT returned HTTP 200 and explained the fallback
  duplicate evidence boundary.
- Direct `POST /api/learning/post-turn` created Learning Agent execution
  `19798`.
- Backend trace hook created detached Learning Agent execution `19799`.
