# Me.IDs Continuous PROD Readiness

Last updated: 2026-10-28

This document is the canonical, continuously maintained production-readiness backlog for Me.IDs. Every production fix, live finding, accepted risk, and release gate must be reconciled here. Detailed evidence remains in `docs/uat/` and the focused production runbooks.

## Current decision

**Release posture: CONDITIONAL / NOT YET FULLY PROD-READY**

The platform is suitable for controlled authenticated UAT. Public production promotion remains gated by the P0/P1 items below. No production data is modified by readiness probes unless a test explicitly declares a synthetic record and its cleanup policy.

## Verified baseline

| Area | Status | Evidence |
| --- | --- | --- |
| Backend contracts | Pass | `npm run check:backend`; 51 launch-critical routes |
| Agent contracts | Pass | `npm run check:agents`; routing, grounding, learning, Knowledge Fabric contracts |
| Vector/Search static readiness | Pass | Azure Search readiness artifacts report active semantic production |
| Backend deployed revision | Observed | App Service build `00cdb3145b2507d5f6148fb4456a7f357a206d28`, built 2026-10-27 13:11 UTC |
| Seven-agent execution history | Connected but stale | All seven workflows have successful historical executions; no execution fell inside the last-24-hour probe window on 2026-10-28 |
| Frontend unauthenticated probe | Expected auth gate | Azure Static Web App redirects protected API probes to Microsoft sign-in |
| Production candidate CI | Pass | PR #25, candidate `5af2fb98fc0c4cf592033fe3c188503158b74ce9`; delivery and PR validation runs `40705770372` and `40705770349` |

## Prioritized backlog

| ID | Priority | State | Finding / action | Exit evidence |
| --- | --- | --- | --- | --- |
| PROD-001 | P0 | Implemented locally; deployment gated | Replace in-process skill/audio promises with `runtime.background_job`, transactional enqueue, leases, retry backoff, idempotency keys, and payload cleanup. | Migration 016 applied; backend deployed; recycle-during-job UAT completes or retries without losing the job. |
| PROD-002 | P0 | Open privileged action | Apply migration `017_runtime_background_jobs.sql` after the graph migration and before deploying the worker-aware backend. The current GitHub deployment workflow does not execute migrations. | Migration ledger contains 017 and `runtime.background_job` exists with indexes/grants. |
| PROD-003 | P0 | Open | Run fresh, non-destructive live probes through Actor Twin and all six workflow-tool subagents. Current 0/7 result means stale, not failed; latest historical run for every workflow succeeded. | Seven fresh successful executions with durations and contract checks. |
| PROD-004 | P1 | Open | Verify restart/recycle recovery for queued approved-skill and audio jobs. | Synthetic jobs survive one controlled backend slot/process recycle; no production record is changed. |
| PROD-005 | P1 | Open | Return a graceful `blocked_auth_context` answer for stale embedded-chat sessions while retaining signed knowledge authorization. | Expired/missing token test prompts re-authentication and never weakens access control. |
| PROD-006 | P1 | Open | Complete Knowledge Fabric v4 soak; retire v3 only after callers and fresh executions prove v4 stable. | Caller inventory, fresh success sample, rollback export, v3 deactivated. |
| PROD-007 | P1 | Open | Add foreground and nested-agent latency/token budgets; keep Learning Agent post-turn. | P50/P95 by agent and chain; timeout/fallback evidence; no foreground wait on normal learning. |
| PROD-008 | P1 | Open | Run cross-user authorization UAT for private, twin-shared, group-shared, and owner/admin boundaries. | Positive and negative RLS tests for at least two employees and one guest. |
| PROD-009 | P2 | Open | Recalibrate duplicate and semantic-relation thresholds using reviewed samples. | Labeled sample set, precision/recall report, approved thresholds and rollback values. |
| PROD-010 | P2 | Open human/device validation | Complete Windows/macOS browser, microphone, M4A, PPTX, and mixed bulk-upload UAT. | Signed device matrix with upload/transcription evidence. |
| PROD-011 | P2 | Open privileged Azure action | Harden frontend deployment: custom domain, workload identity federation, deployment environment protection, and removal of direct worker URLs. | DNS/TLS verified, tokenless deployment, protected environment approval, backend-only API routes. |
| PROD-012 | P3 | Deferred | Modularize `frontend/app.js`, `frontend/styles.css`, and `backend/server.js` after runtime contracts freeze. | Stable runtime soak followed by bounded module extraction with parity tests. |

## Decisions

| Date | Decision | Reasoning | Consequence |
| --- | --- | --- | --- |
| 2026-10-28 | Reuse the existing PostgreSQL-backed runtime boundary for durable jobs. | It preserves tenant/twin context, supports transactional enqueue with the user-visible ledger, and avoids introducing a second queue service during launch hardening. | Migration 016 is a required release gate. Service Bus remains an option when throughput or cross-service fan-out justifies it. |
| 2026-10-28 | Store queued audio temporarily as `bytea`, then purge it on completion or dead-letter. | The current 25 MB limit is bounded and this closes recycle loss without exposing audio in audit JSON. | Monitor database growth. Move queued binary payloads to private quarantine Blob plus pointer before raising the audio limit or scaling volume. |
| 2026-10-28 | Keep Actor Twin as the only user-facing agent and preserve `Call n8n Workflow Tool` delegation. | Production hardening must not flatten the intended agent hierarchy. | Backend queues Actor Twin requests; n8n remains responsible for Butler, Skill Orchestrator, Task Agent, Critical Faculty, Learning, and Knowledge Fabric routing. |
| 2026-10-28 | Do not deploy schema-dependent code before its migration. | A pipeline-only code deployment would turn skill/audio requests into runtime 500s. | Database migration requires explicit privileged confirmation, then normal CI deployment may proceed. |

## Release sequence

1. Apply migrations through 017 with the Entra PostgreSQL administrator path.
2. Deploy the backend revision through the protected `main` pipeline.
3. Verify `/api/build-info`, worker startup logs, table/index state, and no dead letters.
4. Run controlled synthetic skill and audio jobs; recycle only the Me.IDs backend instance/slot if approved, never the shared n8n App Service.
5. Run fresh seven-agent probes and authorization-negative tests.
6. Promote remaining frontend/auth UX fixes through the Static Web App pipeline.
7. Close only evidence-backed items above; add every new defect here before release.

## Current promotion candidate

- Pull request: `https://github.com/florianliepe/meids-app/pull/25`
- Candidate revision: `5af2fb98fc0c4cf592033fe3c188503158b74ce9`
- CI evidence: delivery validation run `40705770372` and Me.IDs PR validation run `40705770349` passed after reconciling the candidate with current `main`.
- Promotion is intentionally paused before merge until migrations through 017 are confirmed applied.

## Human or privileged gates

- Entra PostgreSQL administrator execution of migrations through 017.
- Any Azure App Service restart, slot swap, custom-domain/DNS change, role assignment, or production app-setting change.
- Any n8n workflow activation/deactivation or credential mutation.
- Any rejection, deletion, or approval of real user knowledge, learning, twins, or review records.
