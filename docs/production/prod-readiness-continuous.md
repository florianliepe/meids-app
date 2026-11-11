# Me.IDs Continuous PROD Readiness

Last updated: 2026-11-11

This document is the canonical, continuously maintained production-readiness backlog for Me.IDs. Every production fix, live finding, accepted risk, and release gate must be reconciled here. Detailed evidence remains in `docs/uat/` and the focused production runbooks.

## Current decision

**Release posture: CONDITIONAL / NOT YET FULLY PROD-READY**

The platform is suitable for controlled authenticated UAT. Public production promotion remains gated by the P0/P1 items below. No production data is modified by readiness probes unless a test explicitly declares a synthetic record and its cleanup policy.

## Verified baseline

| Area | Status | Evidence |
| --- | --- | --- |
| Backend contracts | Pass | `npm run check:backend`; 58 launch-critical routes |
| Agent contracts | Pass | `npm run check:agents`; routing, grounding, learning, Knowledge Fabric contracts |
| Deterministic agent routing | Production v1 active | `meids.agent-routing.v1` classifies before Actor reasoning; synchronous Learning removed; async work is intercepted before the LLM and cannot fall through to an inline Butler chain |
| Generic background work | Authenticated E2E and visible Ready-state pass; queued-only cancellation open | `meids.agent-work.v1`, migration 019, owner/twin status polling, idempotency and bounded retry are deployed. Job `agent-work-50540f2f4d88f6388ffe7315ce4e5c2e` completed once through executions `103244`/`103245`. PR #49 fixed the uninitialized direct-entry view marker; production reload now initializes `activeView=chat` and renders the completed job as `Ready` without a navigation click. |
| Vector/Search static readiness | Pass | Azure Search readiness artifacts report active semantic production |
| Deployed revisions | Pass | Frontend `73245a4c7dbe7cae6b89b7b98a602cc456f11da7`; backend `66f80dc89a1c97dcc0155ab0eca1caa783f23c86` (no backend delta in PR #49) |
| Governed visual recall | Owner/anonymous boundary pass | Migration 018 applied; private Blob upload/read, SHA-256 parity, approval/rejection cascade and anonymous HTTP 401 verified; `docs/uat/governed-visual-recall-live-uat-20261030.json` |
| Seven-agent execution history | Pass | 2026-11-11 no-write UAT passed every scenario. Actor direct 9.6 s, reviewed retrieval 9.2 s, Critical Faculty 30.1 s, Butler/Skill/Task 61.9 s; Learning dispatch correlated to canonical execution `102895`. |
| Azure authentication edge | Pass | Anonymous and forged-principal `/api/session` probes both returned 401; `docs/uat/azure-auth-edge-probe.json` |
| Upload and microphone matrix | Pass | M4A, PPTX, macOS filenames/export guidance, 25 MB file and 100 MB batch boundaries passed; Windows Chrome and macOS Safari/Chrome microphone UAT confirmed; `docs/uat/device-upload-launch-matrix.json` |
| Frontend unauthenticated probe | Expected auth gate | Azure Static Web App redirects protected API probes to Microsoft sign-in |
| Production candidate CI | Pass | PR #25, candidate `5af2fb98fc0c4cf592033fe3c188503158b74ce9`; delivery and PR validation runs `40705770372` and `40705770349` |
| Lean daily-workspace refinement | Local candidate pass | Actor composer, Knowledge hover/focus, single-lane Review and first-viewport Graph passed 16 responsive browser cases plus Graph V1 rollback; `docs/visual-qa/actor-first-20261103/actor-first-qa.json` |

## Prioritized backlog

| ID | Priority | State | Finding / action | Exit evidence |
| --- | --- | --- | --- | --- |
| PROD-001 | P0 | Complete | Replace in-process skill/audio promises with `runtime.background_job`, transactional enqueue, leases, retry backoff, idempotency keys, and payload cleanup. | Migration 017 applied; recovery run `skill-mvsbk1ao-aea0f1` completed on attempt 2 after a controlled backend recycle, with no final error and payload cleanup. |
| PROD-002 | P0 | Complete | Apply migration `017_runtime_background_jobs.sql` after the graph migration and before deploying the worker-aware backend. | Applied 2026-10-28 14:34 UTC; ledger entry, table, five indexes, runtime CRUD grant, and empty initial queue verified from the App Service private network. |
| PROD-003 | P0 | Complete | Run fresh, non-destructive live probes through Actor Twin and all six workflow-tool subagents. | 2026-11-11 no-write UAT passed all scenarios; Learning acknowledgement was correlated to fresh canonical execution `102895`. The harness distinguishes transport loss from agent failure by recovering the exact child/parent execution pair and matching the Actor session ID. |
| PROD-004 | P1 | Complete for skill jobs; audio path covered by the same durable worker contract | Verify restart/recycle recovery for queued approved-skill and audio jobs. | Controlled recycle evidence in `docs/uat/runtime-job-recovery-uat.json`; job completed on attempt 2 and purged its payload. |
| PROD-005 | P1 | Complete | Return a graceful `blocked_auth_context` answer for stale embedded-chat sessions while retaining signed knowledge authorization. | Contract proves renewal, reconnect, friendly error, and no unsafe replay; PR #27 deployed successfully to backend and Azure Static Web Apps on 2026-10-28. |
| PROD-006 | P1 | Open | Complete Knowledge Fabric v4 soak; retire v3 only after callers and fresh executions prove v4 stable. | Caller inventory, fresh success sample, rollback export, v3 deactivated. |
| PROD-007 | P1 | Async latency boundary and positive background run complete; p50/p90 soak open | Add foreground and nested-agent latency/token budgets; keep Learning Agent post-turn. | `execute_work_async` is intercepted before Actor reasoning. Enqueue execution `100723` completed in 706 ms without Actor LLM or Butler; worker `100724` completed in 75.9 s. Latest no-write samples: direct 9.6 s, retrieval 9.2 s, critique 30.1 s, Butler/Skill/Task 61.9 s. Close after route-specific rolling p50/p90 SLO evidence. |
| PROD-008 | P1 | Automated/edge checks and second-employee admission pass; full RLS matrix open | Run cross-user authorization UAT for private, twin-shared, group-shared, and owner/admin boundaries. | A second Eraneos colleague successfully accessed the platform. Employee/guest filter contracts and edge spoofing pass; complete explicit private/twin/group denial tests with a guest before closing. |
| PROD-009 | P2 | Open | Recalibrate duplicate and semantic-relation thresholds using reviewed samples. | Labeled sample set, precision/recall report, approved thresholds and rollback values. |
| PROD-010 | P2 | Complete | Complete Windows/macOS browser, microphone, M4A, PPTX, and mixed bulk-upload UAT. | Automated format matrix plus manual Windows Chrome and macOS Safari/Chrome microphone validation passed. |
| PROD-011 | P2 | Open privileged Azure action | Harden frontend deployment: custom domain, workload identity federation, deployment environment protection, and removal of direct worker URLs. | DNS/TLS verified, tokenless deployment, protected environment approval, backend-only API routes. |
| PROD-012 | P3 | Deferred | Modularize `frontend/app.js`, `frontend/styles.css`, and `backend/server.js` after runtime contracts freeze. | Stable runtime soak followed by bounded module extraction with parity tests. |
| PROD-013 | P3 | Complete | Promote compact Graph Explorer V2 with smaller dots, thinner relations, quiet labels, layer-specific neutral colors, accessible focus, local depth and flag-only rollback. | Owner approved production promotion without preview login. PR #28 merged as `7b01867fd63f4617ef6a523a091f720487b596ae`; Azure deployment passed and live runtime verification returned `graphExplorerV2=true` with matching commit-revision assets. |
| PROD-014 | P0 | Complete for owner delete; cross-user denial remains under PROD-008 | Repair voice draft deletion and duplicate-resolution routes with scoped authorization. | Authenticated PostgreSQL smoke created draft `1b51e5da-1296-4aff-af68-72a1f84b68f5`, deleted it with HTTP 200, and confirmed HTTP 404 after deletion; `docs/uat/authenticated-postgres-outbox-skill-smoke-20261030.json`. |
| PROD-015 | P0 | Complete | Make voice transcripts and structured OKF review content editable while preserving the original transcript and revision history. | Authenticated concept `4dd1f7a4-a7f4-407a-93ae-1fb4864544f0` advanced from revision 1 to corrected revision 2 and returned to `needs-rework`; detailed evidence is retained in the UAT record. |
| PROD-016 | P1 | Deployed; live voice UAT pending | Stop repeated semantic clarification after the same dimension is asked twice. | Synthetic repeated-who test passed; confirm a real Voice Capture interview advances after the repeated question. |
| PROD-017 | P1 | Complete for new promotion events; one legacy stale item remains | Remove manual MCP routing from end-user views and rely on Knowledge Fabric promotion/outbox after approval. | Synthetic concept `6da1d842-1203-4f88-a62e-b9f954857a44` was promoted and the outbox pending count fell from 2 to 1 with zero failed entries. The disposable record was then rejected. Investigate the single pre-existing stale item separately. |
| PROD-018 | P1 | Live soak passed; queue-latency follow-up open | Apply a 90-second default approved-skill boundary and durable timeout fallback. | Three authenticated skill runs completed on attempt 1. The first completed in 39 seconds; two concurrent samples completed in 78 and 139 seconds wall time. The second sample exposes single-worker queue delay even though each n8n call remained inside its 90-second execution boundary. Add queue-age SLO/alerting before higher concurrency. |
| PROD-019 | P1 | Deployed; device UAT pending | Add Actor Twin microphone transcription and explicit single-source intake while preserving n8n as the only chat surface. | Production assets verified; complete Windows/macOS microphone and source-confirmation UAT with visible transcript delivery into n8n chat. |
| PROD-020 | P2 | Deployed; second-identity recall pass, malware scan and retention pending | Add governed visual-artifact storage and recall through private Blob, PostgreSQL metadata and optional OCR. | Owner upload/read, SHA-256 parity, approval/rejection cascade, private container posture, anonymous HTTP 401 and visual recall with a second identity passed. Defender for Storage malware-scanning and Blob retention/lifecycle evidence remain open. OCR remains optional. |
| PROD-021 | P1 | Nightly heartbeat and Admin summary active; live-browser assertions need expansion | Detect contract, routing, latency, expected-answer and frontend regressions every night without production mutations. | The runner now uses route-specific budgets, requires a fresh canonical Learning execution, and recovers delegated results only from an exact workflow, parent execution and Actor session match. Add queue/outbox drift thresholds and a reusable authenticated Playwright identity/session. |
| PROD-022 | P2 | Complete | Promote the actor-first frontend refinement: Actor Twin as the primary surface, compact Voice and Source intake, progressive Twin/Skill settings, lean Knowledge/Review, and operator-only Traces/Production links in Admin Cockpit. | The adversarial review found four P2 issues; Graph Advanced/rollback, Guided Setup, readable Voice status and direct Production routing were fixed. Sixteen responsive views plus Graph V1 rollback passed. PR #35 merged as `7aafabca5edb564b79dcd506c07730049522781b`; Azure Static Web Apps, backend and sandbox deployments passed. Live static verification confirms Actor-first markup, direct Voice/Source actions, visible Guided Setup, restored Graph controls and `graphExplorerV2=true`. |
| PROD-023 | P2 | Candidate validated; promotion pending | Complete the end-user refinement: reveal Knowledge detail on hover/focus, select one Review queue/lane at a time, make Graph fill its first viewport, and dock Talk/source actions in the n8n composer without duplicate chat branding. | Frontend contract, Graph contract, 16 responsive browser cases, Graph V1 rollback, backend, agent, access, Admin, API parity and upload/device suites pass. QA also found and fixed an idempotency defect in composer docking that could otherwise trigger a DOM mutation loop. Promote only through the protected PR pipeline. |
| PROD-024 | P1 | Authenticated lifecycle complete; queued-only cancellation open | Add a durable generic no-write background-work endpoint for long Actor Twin chat requests, with job ID, status polling, idempotency, cancellation boundary and frontend progress. | PR #46 raised the background-only budget to 180 seconds and made uncertain timeouts terminal/no-retry. PR #47 deployed scoped Bearer authorization. Authenticated job `agent-work-50540f2f4d88f6388ffe7315ce4e5c2e` completed once through enqueue `103244` and worker `103245` in about 81 seconds. PR #49 fixed direct-entry polling and deployed as `73245a4c7dbe7cae6b89b7b98a602cc456f11da7`; production reload showed `activeView=chat` and the job as `Ready`. |
| PROD-025 | P1 | Complete | Permit n8n to reach the token-verifying background-work endpoint without weakening other backend routes. | Protected OIDC run `42899200928` added only `/api/agents/work` to the EasyAuth exclusion and retained before/after artifacts. Missing and forged tokens return 401, side-effect language returns 409, and authenticated job execution completes. |

## Decisions

### Background lifecycle follow-up (2026-11-11)

The direct-entry Queued-to-Ready presentation defect under PROD-024 is resolved
by PR #49 and its reported authenticated production retest, documented by PR #50.
It does not close queued-only cancellation or the wider Nightly evidence gaps.

Prioritized open test definitions are consolidated in
[Background-job lifecycle test backlog](../uat/20261111-background-job-lifecycle-test-plan.md):

- **P1 BG-CANCEL-01 / PROD-024:** queued-only cancellation races and idempotency.
- **P1 BG-SLO-01 / PROD-018, PROD-021:** per-route rolling p50/p90 and queue-age drift.
- **P1 BG-SESSION-01 / PROD-021:** reusable least-privilege authenticated Nightly session.
- **P1 BG-LEARN-01 / PROD-021, PERF-07:** reject accepted dispatch without fresh,
  correctly correlated canonical Learning completion.

BG-LIFE-01 through BG-LIFE-12 add startup, polling lifecycle, view/scope changes,
out-of-order responses, auth refresh, error recovery and terminal-state coverage.
These cases are defined but not executed; no production mutation or deployment
was performed for this review. Potential races remain hypotheses until reproduced.

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
| 2026-11-03 | Make Actor Twin the default daily workspace and move operational detail behind progressive disclosure. | End users need one conversational entry point; governance and production diagnostics remain available without dominating normal work. | Voice and source intake stay accessible within one action, Graph V2 retains its rollback flag, Traces/Production move to Admin Cockpit, and no API, authorization, persistence or n8n contract changes. |
| 2026-11-04 | Treat progressive disclosure and feature-flag rollback as tested interactions, not markup assumptions. | The external review reproduced inaccessible Graph Advanced, Guided Setup and rollback controls even though the original static contract test passed. | Browser UAT now opens the disclosures, verifies all five setup steps, and runs Graph with both V2 enabled and disabled before promotion. |
| 2026-11-04 | Promote the reconciled actor-first refinement through protected PR #35. | All local suites, preview checks, protected PR validation and three production deployment workflows passed after the four P2 findings were fixed. | Production now serves the Actor-first frontend at commit `7aafabca5edb564b79dcd506c07730049522781b`; Graph rollback remains flag-only. |
| 2026-11-04 | Keep the end-user refinement strictly presentational and preserve the existing n8n composer contract. | The user needs a quieter daily workspace without changing agent routing, persistence, authorization or review semantics. | Talk and source controls are reparented idempotently into the rendered composer; Knowledge/Review/Graph use progressive disclosure; the protected pipeline remains the only production promotion path. |
| 2026-11-10 | Make routing a portable pre-LLM contract and remove Learning from Actor Twin's synchronous tools. | Prompt-only budgets did not prevent serial Butler, Skill, Critical Faculty and Learning chains. The same semantics must survive the planned n8n-to-Azure migration. | n8n and future Azure code consume `meids.agent-routing.v1`; Learning runs post-turn, Critical Faculty is gated, and Butler receives explicit worker budgets. |
| 2026-11-10 | Treat Actor-connected workflow IDs as deployment truth. | The persisted Butler environment variable referenced staging v2 while Actor called callable v3. | Publish tooling derives the Butler target from Actor's live workflow connection, warns on configuration drift, and backs up every update. |
| 2026-11-10 | Enforce async routing with a workflow branch before generative reasoning. | The Actor LLM received the correct `execute_work_async` contract but still selected Butler inline. Prompt and tool descriptions cannot provide a latency guarantee. | n8n switches on the portable routing contract, queues through `meids.agent-work.v1`, and returns before any LLM call. The future Azure implementation replaces this adapter, not its contract. |
| 2026-11-10 | Fail closed and recover visibly when background authorization expires. | A queue call with a rejected token previously surfaced as a generic workflow 500. | The Actor returns `auth_required` in about one second, starts no job, performs no replay, and asks the user to reconnect and resubmit. |
| 2026-11-11 | Correlate Nightly transport failures with canonical n8n executions before classifying an agent failure. | A locally interrupted HTTP client reported Critical Faculty as failed even though child `102473` and Actor parent `102472` both succeeded with a stored answer. | Delegated recovery requires an exact workflow ID, parent execution, Actor session ID and successful final answer; route-specific client budgets remain finite and transport recovery stays visible in the artifact. |

## Release sequence

1. Keep migrations through 018 applied; apply every future schema migration with the Entra PostgreSQL administrator path before schema-dependent code.
2. Deploy the backend revision through the protected `main` pipeline.
3. Verify `/api/build-info`, worker startup logs, table/index state, and no dead letters.
4. Run controlled synthetic skill and audio jobs; recycle only the Me.IDs backend instance/slot if approved, never the shared n8n App Service.
5. Run fresh seven-agent probes and authorization-negative tests.
6. Promote remaining frontend/auth UX fixes through the Static Web App pipeline.
7. Close only evidence-backed items above; add every new defect here before release.

## Current production release

- Pull request: `https://github.com/florianliepe/meids-app/pull/49`
- Frontend production revision: `73245a4c7dbe7cae6b89b7b98a602cc456f11da7`; backend remains `66f80dc89a1c97dcc0155ab0eca1caa783f23c86` because PR #49 had no backend delta.
- PR evidence: Me.IDs validation `43008611595`, delivery validation `43008611627`, and Static Web App preview `43008611598` passed.
- Deployment evidence: Azure Static Web Apps `43008806697` and GitHub Pages sandbox `43008806609` passed.
- Live build verification returned frontend revision `73245a4c7dbe7cae6b89b7b98a602cc456f11da7`; an authenticated direct-entry reload initialized `activeView=chat` and changed completed job `agent-work-50540f2f4d88f6388ffe7315ce4e5c2e` from the stale `Queued` presentation to `Ready` without a navigation click.

## Human or privileged gates

- Future Entra PostgreSQL administrator migrations after the currently applied migration 018.
- Any Azure App Service restart, slot swap, custom-domain/DNS change, role assignment, or production app-setting change.
- Any n8n workflow activation/deactivation or credential mutation.
- Any rejection, deletion, or approval of real user knowledge, learning, twins, or review records.
