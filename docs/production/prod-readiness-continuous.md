# Me.IDs Continuous PROD Readiness

Last updated: 2026-10-30

This document is the canonical, continuously maintained production-readiness backlog for Me.IDs. Every production fix, live finding, accepted risk, and release gate must be reconciled here. Detailed evidence remains in `docs/uat/` and the focused production runbooks.

## Current decision

**Release posture: CONDITIONAL / NOT YET FULLY PROD-READY**

The platform is suitable for controlled authenticated UAT. Public production promotion remains gated by the P0/P1 items below. No production data is modified by readiness probes unless a test explicitly declares a synthetic record and its cleanup policy.

## Verified baseline

| Area | Status | Evidence |
| --- | --- | --- |
| Backend contracts | Pass | `npm run check:backend`; 58 launch-critical routes |
| Agent contracts | Pass | `npm run check:agents`; routing, grounding, learning, Knowledge Fabric contracts |
| Vector/Search static readiness | Pass | Azure Search readiness artifacts report active semantic production |
| Backend deployed revision | Observed | App Service build `a7145204f86d2448ee2ca6249b5ff50ceb699cda`; controlled recycle retained the same deployed revision |
| Seven-agent execution history | Pass | 7/7 fresh successful workflows, including Actor Twin and six workflow-tool subagents; `docs/uat/n8n-seven-agent-live-probe-evidence.json` |
| Azure authentication edge | Pass | Anonymous and forged-principal `/api/session` probes both returned 401; `docs/uat/azure-auth-edge-probe.json` |
| Upload format contracts | Pass; physical device checks pending | M4A, PPTX, macOS filenames/export guidance, 25 MB file and 100 MB batch boundaries passed; `docs/uat/device-upload-launch-matrix.json` |
| Frontend unauthenticated probe | Expected auth gate | Azure Static Web App redirects protected API probes to Microsoft sign-in |
| Production candidate CI | Pass | PR #25, candidate `5af2fb98fc0c4cf592033fe3c188503158b74ce9`; delivery and PR validation runs `40705770372` and `40705770349` |

## Prioritized backlog

| ID | Priority | State | Finding / action | Exit evidence |
| --- | --- | --- | --- | --- |
| PROD-001 | P0 | Complete | Replace in-process skill/audio promises with `runtime.background_job`, transactional enqueue, leases, retry backoff, idempotency keys, and payload cleanup. | Migration 017 applied; recovery run `skill-mvsbk1ao-aea0f1` completed on attempt 2 after a controlled backend recycle, with no final error and payload cleanup. |
| PROD-002 | P0 | Complete | Apply migration `017_runtime_background_jobs.sql` after the graph migration and before deploying the worker-aware backend. | Applied 2026-10-28 14:34 UTC; ledger entry, table, five indexes, runtime CRUD grant, and empty initial queue verified from the App Service private network. |
| PROD-003 | P0 | Complete | Run fresh, non-destructive live probes through Actor Twin and all six workflow-tool subagents. | 7/7 fresh successful executions with durations and contract checks on 2026-10-28. |
| PROD-004 | P1 | Complete for skill jobs; audio path covered by the same durable worker contract | Verify restart/recycle recovery for queued approved-skill and audio jobs. | Controlled recycle evidence in `docs/uat/runtime-job-recovery-uat.json`; job completed on attempt 2 and purged its payload. |
| PROD-005 | P1 | Complete | Return a graceful `blocked_auth_context` answer for stale embedded-chat sessions while retaining signed knowledge authorization. | Contract proves renewal, reconnect, friendly error, and no unsafe replay; PR #27 deployed successfully to backend and Azure Static Web Apps on 2026-10-28. |
| PROD-006 | P1 | Open | Complete Knowledge Fabric v4 soak; retire v3 only after callers and fresh executions prove v4 stable. | Caller inventory, fresh success sample, rollback export, v3 deactivated. |
| PROD-007 | P1 | Open | Add foreground and nested-agent latency/token budgets; keep Learning Agent post-turn. | P50/P95 by agent and chain; timeout/fallback evidence; no foreground wait on normal learning. |
| PROD-008 | P1 | Automated/edge checks pass; real-user matrix open | Run cross-user authorization UAT for private, twin-shared, group-shared, and owner/admin boundaries. | Employee/guest filter contracts and edge spoofing pass; real sessions for at least two employees and one guest remain required. |
| PROD-009 | P2 | Open | Recalibrate duplicate and semantic-relation thresholds using reviewed samples. | Labeled sample set, precision/recall report, approved thresholds and rollback values. |
| PROD-010 | P2 | Format contracts pass; physical device validation open | Complete Windows/macOS browser, microphone, M4A, PPTX, and mixed bulk-upload UAT. | Automated matrix is recorded; Windows Chrome plus macOS Safari/Chrome microphone evidence remains required. |
| PROD-011 | P2 | Open privileged Azure action | Harden frontend deployment: custom domain, workload identity federation, deployment environment protection, and removal of direct worker URLs. | DNS/TLS verified, tokenless deployment, protected environment approval, backend-only API routes. |
| PROD-012 | P3 | Deferred | Modularize `frontend/app.js`, `frontend/styles.css`, and `backend/server.js` after runtime contracts freeze. | Stable runtime soak followed by bounded module extraction with parity tests. |
| PROD-013 | P3 | Complete | Promote compact Graph Explorer V2 with smaller dots, thinner relations, quiet labels, layer-specific neutral colors, accessible focus, local depth and flag-only rollback. | Owner approved production promotion without preview login. PR #28 merged as `7b01867fd63f4617ef6a523a091f720487b596ae`; Azure deployment passed and live runtime verification returned `graphExplorerV2=true` with matching commit-revision assets. |
| PROD-014 | P0 | Complete for owner delete; cross-user denial remains under PROD-008 | Repair voice draft deletion and duplicate-resolution routes with scoped authorization. | Authenticated PostgreSQL smoke created draft `1b51e5da-1296-4aff-af68-72a1f84b68f5`, deleted it with HTTP 200, and confirmed HTTP 404 after deletion; `docs/uat/authenticated-postgres-outbox-skill-smoke-20261030.json`. |
| PROD-015 | P0 | Complete | Make voice transcripts and structured OKF review content editable while preserving the original transcript and revision history. | Authenticated concept `4dd1f7a4-a7f4-407a-93ae-1fb4864544f0` advanced from revision 1 to corrected revision 2 and returned to `needs-rework`; detailed evidence is retained in the UAT record. |
| PROD-016 | P1 | Deployed; live voice UAT pending | Stop repeated semantic clarification after the same dimension is asked twice. | Synthetic repeated-who test passed; confirm a real Voice Capture interview advances after the repeated question. |
| PROD-017 | P1 | Complete for new promotion events; one legacy stale item remains | Remove manual MCP routing from end-user views and rely on Knowledge Fabric promotion/outbox after approval. | Synthetic concept `6da1d842-1203-4f88-a62e-b9f954857a44` was promoted and the outbox pending count fell from 2 to 1 with zero failed entries. The disposable record was then rejected. Investigate the single pre-existing stale item separately. |
| PROD-018 | P1 | Live soak passed; queue-latency follow-up open | Apply a 90-second default approved-skill boundary and durable timeout fallback. | Three authenticated skill runs completed on attempt 1. The first completed in 39 seconds; two concurrent samples completed in 78 and 139 seconds wall time. The second sample exposes single-worker queue delay even though each n8n call remained inside its 90-second execution boundary. Add queue-age SLO/alerting before higher concurrency. |
| PROD-019 | P1 | Deployed; device UAT pending | Add Actor Twin microphone transcription and explicit single-source intake while preserving n8n as the only chat surface. | Production assets verified; complete Windows/macOS microphone and source-confirmation UAT with visible transcript delivery into n8n chat. |
| PROD-020 | P2 | Candidate implemented; migration/deploy/live isolation pending | Add governed visual-artifact storage and recall through private Blob, PostgreSQL metadata and optional OCR. | Migration 018, managed-identity private Blob storage, signature allowlist, PostgreSQL metadata/RLS, review-gated server recall, provenance links and frontend review controls are implemented. Apply migration before code deployment, then run authorized/unauthorized recall, rejection, retention and Defender malware-scanning UAT. OCR remains optional and out of this package. |

## Decisions

| Date | Decision | Reasoning | Consequence |
| --- | --- | --- | --- |
| 2026-10-28 | Reuse the existing PostgreSQL-backed runtime boundary for durable jobs. | It preserves tenant/twin context, supports transactional enqueue with the user-visible ledger, and avoids introducing a second queue service during launch hardening. | Migration 016 is a required release gate. Service Bus remains an option when throughput or cross-service fan-out justifies it. |
| 2026-10-28 | Store queued audio temporarily as `bytea`, then purge it on completion or dead-letter. | The current 25 MB limit is bounded and this closes recycle loss without exposing audio in audit JSON. | Monitor database growth. Move queued binary payloads to private quarantine Blob plus pointer before raising the audio limit or scaling volume. |
| 2026-10-28 | Keep Actor Twin as the only user-facing agent and preserve `Call n8n Workflow Tool` delegation. | Production hardening must not flatten the intended agent hierarchy. | Backend queues Actor Twin requests; n8n remains responsible for Butler, Skill Orchestrator, Task Agent, Critical Faculty, Learning, and Knowledge Fabric routing. |
| 2026-10-28 | Do not deploy schema-dependent code before its migration. | A pipeline-only code deployment would turn skill/audio requests into runtime 500s. | Database migration requires explicit privileged confirmation, then normal CI deployment may proceed. |
| 2026-10-28 | Build Search candidate prefilters from granted visibility scopes. | A narrow prefilter is easier to audit and avoids naming team/org scopes for a private guest token. | The final security clause remains authoritative; the candidate set is now least-privilege too. |
| 2026-10-28 | Reconnect but never replay after embedded-chat token expiry. | Automatic replay could duplicate a write or tool call. | Users receive a renewed chat context and resubmit intentionally. |
| 2026-10-28 | Treat the 420-second lease as the recovery boundary after process loss. | Early reclaim could execute the same n8n chain twice. | The controlled recycle passed with attempt 2 after lease expiry; operators should inspect status and lease timestamps before intervening. |
| 2026-10-29 | Keep Graph Explorer V2 disabled in production and evaluate it only in an Azure pull-request preview. | Frontend refinement must not alter the current launch candidate, API traffic, persistence, or governance behavior. | Promotion and rollback are runtime-flag decisions; current production remains unchanged. |
| 2026-10-29 | Promote Graph Explorer V2 after explicit owner approval. | Automated V1/V2 regressions, graph contracts, accessibility interactions, responsive visual checks and synthetic performance gates passed. The owner accepted promotion without preview authentication UAT. | `MEIDS_GRAPH_UI_V2=true` is set in the protected GitHub environment. Rollback sets it to `false` and reruns the Azure Static Web App workflow. |
| 2026-10-30 | Keep original speech-to-text output as evidence and save human corrections as a new knowledge revision. | Intake errors must be correctable without weakening provenance. | Reviewers can correct transcript and OKF fields; corrected knowledge returns to review. |
| 2026-10-30 | Remove MCP mechanics from normal user journeys. | Users approve knowledge and skills, not transport internals. | Knowledge approval drives the existing outbox; diagnostics remain an operator concern. |
| 2026-10-30 | Defer visual binary recall until private Blob storage is wired. | The existing source path extracts text but does not durably store original files. | Do not put images into PostgreSQL JSON or claim recall support before artifact authorization exists. |
| 2026-10-30 | Store governed source binaries only in private Blob and keep recall server-mediated. | Browser-visible SAS URLs would weaken revocation and leak storage topology; PostgreSQL is the correct metadata and RLS authority, not a binary store. | The backend managed identity writes/reads Blob, responses omit Blob URIs, pending artifacts are visible only to their owner/reviewers, and ordinary recall starts only after approval. |
| 2026-10-30 | Preserve the 90-second per-execution skill boundary and track queue age separately. | Concurrent jobs are intentionally processed sequentially by the current durable worker, so end-to-end wall time can exceed the n8n request timeout without violating it. | Add queue-age telemetry and scale worker concurrency only after idempotency and n8n capacity are measured; do not raise the interactive n8n timeout to hide queue delay. |
| 2026-10-30 | Release the UAT intake and review hardening through protected PR #30. | Backend, agent hierarchy, admin, graph, API parity, and browser contract checks passed without production-data writes. | Merge `1bdcb7832d856ae26d8c64d8292082b91c3b5dcc` deployed successfully to Azure Static Web Apps and the backend App Service; the remaining gates are explicit authenticated/device smoke tests above. |

## Release sequence

1. Apply migrations through 017 with the Entra PostgreSQL administrator path.
2. Deploy the backend revision through the protected `main` pipeline.
3. Verify `/api/build-info`, worker startup logs, table/index state, and no dead letters.
4. Run controlled synthetic skill and audio jobs; recycle only the Me.IDs backend instance/slot if approved, never the shared n8n App Service.
5. Run fresh seven-agent probes and authorization-negative tests.
6. Promote remaining frontend/auth UX fixes through the Static Web App pipeline.
7. Close only evidence-backed items above; add every new defect here before release.

## Current promotion candidate

- Pull request: `https://github.com/florianliepe/meids-app/pull/27`
- Candidate revision: `03d6585cb79a48ae873900944319c24446f069f8`
- CI evidence: delivery validation run `40727350870` and Me.IDs PR validation run `40727351116` passed.
- Migration 017 and controlled recovery are verified. Promotion may proceed after the documentation-only candidate update passes the same protected checks.

## Human or privileged gates

- Entra PostgreSQL administrator execution of migrations through 017.
- Any Azure App Service restart, slot swap, custom-domain/DNS change, role assignment, or production app-setting change.
- Any n8n workflow activation/deactivation or credential mutation.
- Any rejection, deletion, or approval of real user knowledge, learning, twins, or review records.
