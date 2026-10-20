# Agent Interaction Hardening Open Points

## Target State

Frontend stays lean: Actor Twin is the only user-facing chat. All other agents
run as internal n8n workflow-tool subagents.

Primary runtime chain:

```text
User / voice / chat
  -> Actor Twin embedded n8n chat
  -> Knowledge Fabric Agent for knowledge retrieval, staging, OKF, graph, vector
  -> Agentic Butler for work artifacts, skill execution, skill proposals
  -> Skill Orchestrator for multi-step approved skill execution
  -> Task Agent for bounded execution steps
  -> Critical Faculty Agent for decision-quality challenge
  -> Learning Agent for trace-to-learning synthesis
  -> Knowledge Fabric Agent for review_needed learning documents and deltas
```

## Open Points

| Priority | Open point | Risk | Hardening step |
|---:|---|---|---|
| P0 | Production persistence for uploads, reviews, traces, approvals, OKF deltas, and learning documents is not fully proven end to end. | Browser-local or n8n-only state can be lost or diverge. | Run hosted backend with Postgres and route frontend/n8n persistence through backend APIs. |
| P0 | n8n workflow contracts need stable normalized output across every agent and subagent. | Frontend may show raw JSON, markdown fences, or incomplete trace context. | Add live contract probes for Actor Twin, Knowledge Fabric, Butler, Critical Faculty, Learning, Skill Orchestrator, and Task Agent. |
| P0 | Agent chain latency is high on nested runs. | Actor Twin chat can feel blocked; users may retry and duplicate workflow executions. | Keep default routes shallow, cap subagent calls, add async trace/learning jobs, and introduce timeouts/fallback summaries. |
| P1 | Approval boundary must remain precise. | Over-gating breaks interaction; under-gating risks external side effects or unapproved capability activation. | Validate approval cases with fixtures: draft, send, schedule, skill proposal, skill activation, graph promotion, vector refresh. |
| P1 | Learning Agent and Knowledge Fabric feedback loops need duplicate detection. | Repeated UAT lessons may create redundant concepts and noisy graph edges. | Add duplicate/merge check before staging learning deltas. |
| P1 | Critical Faculty should challenge important decisions but not every turn. | Excessive critique increases cost and latency. | Keep routing criteria strict: ambiguity, risk, weak evidence, generated capability, graph/vector/review boundary. |
| P1 | Voice transcription requires hosted backend or n8n voice workflow configuration. | Voice capture UI appears functional but transcription may fail. | Configure Eraneos AI Gateway/OpenAI-compatible transcription backend and run voice UAT. |
| P2 | `frontend/app.js` and `frontend/styles.css` are too large. | Future UI work is slow and regression-prone. | Split by views/modules after current UAT behavior is frozen. |
| P2 | `backend/server.js` mixes routing, storage, n8n proxy, voice, vector, and health concerns. | Production changes become riskier. | Split backend into route modules and adapters. |
| P2 | Historical `dist-pages-*`, visual QA, and n8n backups increase repository noise. | Deployment handoff is confusing. | Keep a clean deployable package map and exclude generated evidence from release packages. |

## Current Status - 2026-09-07

- Seven-agent n8n connectivity has fresh execution evidence:
  `docs/uat/n8n-seven-agent-live-probe-evidence.json` reports 7/7 connected.
- Fresh runtime audit excludes historical migration failures:
  `docs/uat/agent-runtime-performance-audit.json`.
- Skill Orchestrator fresh audit succeeded:
  `docs/uat/skill-orchestrator-fresh-runtime-audit.json`.
- Backend n8n proxy now has a timeout fallback controlled by
  `N8N_AGENT_TIMEOUT_MS`.
- Learning Agent is now instructed to run async/post-turn for routine trace
  learning.
- Knowledge Fabric is now instructed to perform duplicate/merge detection before
  creating new OKF concepts or learning deltas.

## Performance Improvements

1. Actor Twin should answer directly for identity, status, simple explanation,
   and routine Q&A.
2. Actor Twin should call only one specialist tool unless the user request
   clearly combines knowledge and work intent.
3. Agentic Butler should complete one-step no-write drafts itself.
4. Agentic Butler should call Skill Orchestrator only for multi-step execution.
5. Skill Orchestrator should default to one Task Agent call and stop after three.
6. Critical Faculty should run only for decision-quality risk, not routine work.
7. Learning Agent should run after completed traces/UAT/interviews, preferably
   async or post-turn when user-facing response speed matters.
8. Knowledge Fabric should stage learning as review-needed without trying to
   promote or vector-refresh trusted stores in the same user turn.

## Hardening Tests

Run these before each live UAT or deployment:

```powershell
npm run check:backend
npm run check:agents
npm run audit:agents
npm run probe:agents:live -- --since 2026-09-07T00:00:00.000Z
node scripts/build-pages-static.cjs --output dist-pages-check-hardening
```

When n8n API credentials are available, load persisted user env first:

```powershell
$env:N8N_API_BASE_URL=[Environment]::GetEnvironmentVariable('N8N_API_BASE_URL','User')
$env:N8N_API_KEY=[Environment]::GetEnvironmentVariable('N8N_API_KEY','User')
npm run audit:agents
npm run probe:agents:live -- --since 2026-09-07T00:00:00.000Z
```

## Next Refinement Order

1. Introduce async Learning Agent execution after traces rather than inline user
   chat for normal interactions.
2. Add n8n-node-level timeout and fallback handling around nested workflow-tool
   calls.
3. Back duplicate/merge detection with real vector and graph retrieval scores.
4. Split frontend code by view once current embedded Actor Twin UAT is stable.
5. Split backend server into route and adapter modules.
6. Promote production persistence through hosted backend plus Postgres.
