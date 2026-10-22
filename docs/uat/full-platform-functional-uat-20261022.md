# Me.IDs Full Platform Functional UAT - 2026-10-22

## Executive result

**Overall status: CONDITIONALLY BLOCKED / core application remediation passed, n8n publication evidence remains open.**

Authentication, first-twin onboarding, twin CRUD, active-twin persistence, direct Actor Twin chat, and a normal Agentic Butler drafting route work. Most production workspace functions do not: the Azure frontend calls API routes that are not implemented by the linked production backend.

The hosted application API, persistence, identity onboarding, knowledge review, graph projection, trace visibility, profile completeness, and skill-creation approval route have since been remediated. Public launch remains blocked by the stale published Knowledge Fabric workflow and missing fresh execution evidence for three subordinate workflows.

## Test context

| Item | Value |
|---|---|
| Frontend | `https://victorious-flower-0f10a8303.6.azurestaticapps.net/` |
| Azure Static Web App | `intellectual-twin` (`Standard`) |
| Linked backend | `meids-prod-backend-1853a19b.azurewebsites.net` |
| Linked-backend state | `Succeeded` |
| Test identity | Florian Liepe, authenticated through Entra ID |
| Synthetic twin | `codex-platform-uat-20261022` |
| Data policy | Synthetic data only, marked `CODEX-UAT-20261022` |
| Browser | Chrome, authenticated production-like session |
| Repository commit at test start | `e777ea7` |

## Coverage boundary

The UAT exercised every primary cockpit and the first meaningful write/read action of each requested workflow. Downstream approval, promotion, graph and execution steps could not be reached where the first required API call returned 404; those tests are blocked by UAT-001 rather than omitted. A real microphone recording was not captured because pasted-transcript assessment already proved the hosted voice-conversation route unavailable; browser microphone permission was therefore unnecessary for this run.

## Functional test matrix

| ID | Area | Test | Result | Evidence |
|---|---|---|---|---|
| FT-01 | Authentication | Open authenticated workspace as Florian | PASS | Workspace and user-scoped twin registry loaded |
| FT-02 | Twin CRUD | Create a new synthetic twin | PASS | `Codex Platform UAT 20261022` created |
| FT-03 | Twin CRUD | Activate the new twin | PASS | Sidebar and active selector changed to the UAT twin |
| FT-04 | Twin CRUD | Update success metrics | PASS | `UAT update marker 20261022` persisted |
| FT-05 | Persistence | Reload browser and recover active twin/profile | PASS | Active twin and all edited profile fields survived reload |
| FT-06 | Profile quality | Compare setup readiness and profile completeness | FAIL | UI reports `5/5 setup domains ready` and `0% profile completeness` |
| FT-07 | Twin picture | Select PNG, preview, upload | FAIL | `Upload picture failed: Not found` |
| FT-08 | Knowledge ingest | Paste synthetic note and auto-create concept | FAIL | `Text ingest failed: Not found` |
| FT-09 | Document ingest | Upload synthetic Markdown fixture | FAIL | `Document ingest failed: Not found` |
| FT-10 | Voice capture | Start Persona Modeler from pasted transcript | FAIL | `Assessment failed: Not found` |
| FT-11 | Voice draft | Save the open voice conversation as draft | FAIL | `Draft save failed: Not found` |
| FT-12 | Knowledge cockpit | Load active-twin concepts | FAIL | Empty cockpit; `/api/concepts` returns `Not found` |
| FT-13 | Review cockpit | Load queues and quality signals | FAIL | Cards remain at `Loading...`; no actionable error state |
| FT-14 | Graph | Load active-twin graph | FAIL | `Graph not loaded yet`; backing routes unavailable |
| FT-15 | Traces | Load answer, evidence, CRUD and ingest traces | FAIL | Sections remain empty despite successful twin CRUD |
| FT-16 | Skills | Create synthetic `CODEX UAT Evidence Triage` SkillSpec | FAIL | `Skill elicitation failed: Not found` |
| FT-17 | Production | Run Persona Modeler from Production cockpit | FAIL | `Persona Modeler failed: Not found` |
| FT-18 | Actor Twin | Direct identity/status chat response | PASS | n8n answered successfully in about 4-8 seconds |
| FT-19 | Actor Twin | Verify selected-twin metadata reaches n8n | FAIL | Agent reported no selected twin name/purpose metadata |
| FT-20 | Agent routing | Butler draft-only work artifact | PASS | Live validator routed to Agentic Butler and returned a draft |
| FT-21 | Agent routing | Knowledge Fabric handoff | FAIL | Routed correctly, then failed on authorization/tenant credentials |
| FT-22 | Agent routing | Skill-creation handoff/approval | FAIL | Timed out after 45 seconds; normalized result fell back to Actor Twin/direct answer |
| FT-23 | Readiness UI | Compare system status with functional routes | FAIL | UI reports `Backend ok` while core routes return 404 |

## Root-cause analysis

### RC-01: Frontend/backend API contract is incomplete

The Static Web App is successfully linked to the App Service, so this is not an Azure routing-link failure. Requests reach the linked backend and receive its normalized JSON 404 response: `{ "status": "failed", "error": "Not found" }`.

The production frontend calls routes including:

- `/api/twins/picture`
- `/api/ingest/text`
- `/api/ingest/document`
- `/api/concepts*`
- `/api/skills*`
- `/api/voice/concepts/assess`
- `/api/voice/concepts/draft`
- graph, review, activity and quality endpoints

The current `backend/server.js` router implements twin CRUD plus a narrower production surface for agent proxying, traces/approvals, transcription, vector operations, knowledge stage/promote/reject/backfill, and learning increments. It does not implement the UI routes above.

**Impact:** most of the platform looks available but cannot perform or display its core work.

### RC-02: Live Knowledge Fabric authorization is not aligned

The live n8n test routed to Knowledge Fabric but returned an authorization/tenant-context failure. The browser chat also stalled when asked to retrieve trusted knowledge.

**Impact:** knowledge retrieval and staging are unavailable even if the frontend API parity issue is fixed.

### RC-03: Selected twin metadata is not consumed by n8n

`frontend/app.js` builds metadata with `activeTwin`, `twinName`, tenant/user identity, allowed twin IDs, retrieval flags, and an opaque knowledge-access token. The live Actor Twin said no selected-twin name or purpose was present. This indicates the n8n Chat Trigger/workflow or AI Agent prompt does not forward/consume the metadata envelope.

**Impact:** cross-twin leakage and incorrect routing are possible; responses cannot reliably be grounded in the selected twin.

### RC-04: Readiness checks validate infrastructure, not feature parity

`npm run check:entra-onboarding`, `npm run check:backend`, and `npm run check:agents` all passed. The live n8n checks failed, and browser E2E failed across the main functional paths. The frontend still reports `Backend ok` because the health contract does not advertise required route capabilities.

**Impact:** CI and the UI can be green while the product is functionally unavailable.

## Defect backlog

| Defect | Priority | Component | Summary | Acceptance criteria |
|---|---|---|---|---|
| UAT-001 | P0 | Backend/API | Restore complete frontend/backend route parity for non-static Azure mode | Picture, text/document ingest, concepts, review, skills, voice drafts/assessment, graph, traces and quality return non-404 contracts in authenticated UAT |
| UAT-002 | P0 | n8n Knowledge Fabric | Fix Knowledge Fabric credential, tenant and user authorization context | Live `knowledge_fabric_handoff` completes and persists a `review_needed` synthetic record under the active twin |
| UAT-003 | P0 | Release engineering | Add authenticated end-to-end smoke tests to the Azure deployment gate | Deployment fails when any required production capability is missing; route parity is checked before release |
| UAT-004 | P1 | n8n Actor Twin | Preserve and consume active-twin metadata in embedded chat | Agent can state active twin ID/name/purpose from metadata; tenant/user/twin scope is passed to every tool call |
| UAT-005 | P1 | n8n orchestration | Repair skill-creation routing and nested tool timeout behavior | Skill creation routes to Butler, returns `approval_required`, and completes within the agreed timeout or returns a normalized fallback |
| UAT-006 | P1 | Frontend/status | Replace generic `Backend ok` with capability-level readiness | System status separately reports twins, ingest, knowledge, voice, skills, graph/traces and agents; unavailable capabilities are visibly disabled |
| UAT-007 | P1 | Review/Knowledge UI | Stop indefinite loading states and expose actionable failures | Cockpits show a bounded error with retry and correlation ID after timeout/404 |
| UAT-008 | P2 | Twin profile | Correct profile completeness calculation | A fully populated profile reports 100% and agrees with the five readiness cards |
| UAT-009 | P2 | Observability | Add request/trace correlation IDs to UI errors and n8n tool calls | Every failed operation shows a safe correlation ID linked to App Insights/n8n execution evidence |
| UAT-010 | P2 | Actor Twin UX | Provide visible timeout/retry for an unanswered nested-agent chat turn | After the defined SLO the user receives a normalized retry/fallback summary instead of a silent pending message |
| UAT-011 | P3 | Navigation | Keep the page title consistent after reload | Reloading Actor Twin shows `Actor Twin`, not the generic `Chat` title |

## Prioritized bug-fix plan

1. **Freeze public launch and define the production API manifest.** Extract every `/api/*` call from the non-static frontend, classify it as required/optional, and map each required route to a backend handler, persistence store, auth rule and test.
2. **Implement or consciously remove unsupported capabilities.** Preferred: port the required twin-picture, ingest, concepts/review, skill, voice, graph/activity and quality handlers to the hosted backend with PostgreSQL/Blob/Search persistence. Do not silently fall back to browser-local storage in production.
3. **Make capability parity a release gate.** Add an authenticated post-deploy smoke job and a source-level route-parity validator. Remove advisory handling for launch-critical live checks.
4. **Repair Knowledge Fabric authorization.** Bind the correct n8n credentials, forward the signed tenant/user/twin scope, and verify staging plus retrieval with a synthetic record.
5. **Repair n8n metadata and nested-call contracts.** Map Chat Trigger metadata explicitly into Actor Twin input and every `Call n8n Workflow Tool` payload. Add node-level timeout and normalized failure summaries.
6. **Improve status and error UX.** Report capability-specific availability, disable impossible actions, end loading states, and surface safe correlation IDs.
7. **Fix profile completeness and small UI inconsistencies.** Recompute completeness from the canonical persisted fields or persist `profile_completeness` transactionally.
8. **Rerun this UAT and then test tenant isolation.** Repeat all cases for Florian, a standard employee, and an invited guest; verify RLS prevents cross-user/twin access.

## Automated validation evidence

| Command | Result |
|---|---|
| `npm run check:entra-onboarding` | PASS |
| `npm run check:backend` | PASS |
| `npm run check:agents` | PASS |
| `npm run uat:chat:n8n` | FAIL |
| `npm run uat:agents:live` | FAIL: 2 passed, 2 failed |

Live-agent details are recorded in `docs/uat/agent-interaction-uat-results.json`.

## Decision log

| Decision | Rationale |
|---|---|
| Keep the Azure frontend in non-static mode | Production must use shared, governed persistence and must not hide failures with browser-local staging |
| Treat missing API parity as P0 | It blocks the core product promise across knowledge, skills, voice and governance |
| Keep the Actor Twin as the only user-facing chat | The direct chat works; specialist agents remain internal workflow tools |
| Block launch until active-twin metadata is enforced | Tenant/user/twin scope is a data-isolation boundary, not an optional UX field |
| Require authenticated post-deploy UAT | Source/fixture tests cannot detect linked-backend drift, credentials or n8n publication state |

## Retest entry criteria

- Required API manifest is implemented and deployed.
- Capability health endpoint reports all launch-critical capabilities ready.
- Knowledge Fabric live handoff passes with the active tenant/user/twin context.
- Actor Twin proves it received selected-twin metadata without inferring it from the prompt.
- Skill creation returns a normalized approval-required contract within timeout.
- Authenticated browser smoke tests are part of the Azure deployment pipeline.

## Remediation execution update

The 2026-10-22 Zielmodus remediation implements the code-side entry criteria as follows:

- `contracts/backend/launch-critical-api.json` defines 39 launch-critical contracts.
- `scripts/validate-launch-critical-api.cjs` fails CI when a required route disappears and validates the circular-interview and review-state boundaries.
- `backend/workspaceApi.js` adds authenticated contracts for twin pictures, text/document intake, concepts/review, skill drafts and Actor-Twin-routed skill runs, voice assessment/drafts/commit, activity, and review summaries.
- `backend/migrations/011_workspace_interaction_contracts.sql` adds RLS-protected skill and voice-draft storage.
- Twin completeness is now computed by the backend from canonical persisted fields.
- Live Actor Twin authorization-context bindings were refreshed. Knowledge Fabric and Butler canonical workflows were republished; internal delegation remains `Call n8n Workflow Tool` first.

### Final remediation delta

| Finding | State | Evidence or mitigation |
|---|---|---|
| Frontend/backend route parity | CLOSED | The launch-critical manifest now validates 46 authenticated routes, including voice preflight and handoff-ledger contracts. |
| Twin/profile persistence | CLOSED | Create, activate, update, reload, and canonical completeness were verified in authenticated UAT. |
| Text knowledge ingest and review | CLOSED | Synthetic knowledge was staged as `review_needed` and rejected after evidence capture. |
| Graph and activity traces | CLOSED | Governed concept projection and RLS-scoped activity events load for the active twin. |
| Voice quality display | CLOSED; FINAL DEPLOY PENDING | Authenticated UAT showed 86% consistency, 86% eligibility, 48 words, and all five W-question dimensions. Draft-list reads now flatten the persisted assessment fields. |
| Voice preflight and handoff ledger | CLOSED IN CODE; DEPLOY/RETEST REQUIRED | New hosted endpoints enforce Entra/twin scope and route handoffs through Actor Twin with `call_n8n_workflow_tool_first`. |
| Voice draft audit write | CLOSED | Migration `013` was applied with the PostgreSQL Entra administrator identity. Authenticated draft save and voice-to-`review_needed` concept commit both passed. |
| Skill creation | CLOSED | Live Actor Twin to Butler route returns `approval_required` within 14 seconds. |
| Frontend SkillSpec detail | CLOSED IN CODE; DEPLOY/RETEST REQUIRED | Skill creation persisted and stayed approval-gated. Detail reads now return the root contract plus a backward-compatible nested skill and the Butler-to-Skill-Orchestrator task graph. |
| Knowledge Fabric live handoff | OPEN P0 | Live Actor routing is correct, but production n8n still executes an older published HTTP scoring node and rejects its protected backend call. |
| Seven-agent fresh proof | OPEN P1 | Actor Twin, Butler, and Critical Faculty are fresh; Knowledge Fabric fails; Skill Orchestrator, Task Agent, and Learning Agent remain stale. |
| Picture browser upload | RETEST REQUIRED | The authenticated endpoint contract exists; browser file-chooser automation did not yield a reliable evidence capture in this run. |

The live validator now treats delegated authorization and persistence failures as failures even when the outer n8n chat webhook returns HTTP 200. Latest result: 3/4 live interaction cases pass; only Knowledge Fabric fails.

Deployment and authenticated retest remain required before defects can be closed. The latest seven-agent probe is intentionally retained as evidence: it shows the pre-retest Knowledge Fabric failure and missing fresh executions for Skill Orchestrator, Task Agent, and Learning Agent rather than claiming those paths passed.

## Authenticated remediation retest

Retest time: 2026-10-22 after commit `1998bc4` was deployed to the linked Azure backend and Static Web App.

| Scenario | Result | Evidence |
|---|---|---|
| Backend and SWA deployment | PASS | Backend, Azure Static Web App, and GitHub Pages workflows completed successfully |
| Active twin/profile reload | PASS | `Codex Platform UAT 20261022` and persisted profile loaded from PostgreSQL |
| Text ingestion | PASS | Created concept `d9645089-c2b5-4013-b2d7-707774be5816` with `review_needed` state and two evidence references |
| Human review rejection | PASS | Synthetic concept changed to `rejected` with the UAT evidence-capture note; trusted retrieval remained blocked |
| Concepts read contract | PASS | Authenticated `/api/concepts` returned persisted active-twin concepts |
| Knowledge Fabric authorization bindings | APPLIED, LIVE RETEST PENDING | Actor Twin authorization-context workflow bindings refreshed; Knowledge Fabric and Butler republished |
| Audit activity | FIX PREPARED | Runtime SELECT is now protected by tenant/user/twin RLS in migration `012_audit_runtime_read_policy.sql` |
| Knowledge graph | FIX PREPARED | Graph read contract projects governed PostgreSQL concepts; recommendation/review collections return bounded empty contracts |

### Updated decisions

| Decision | Reason |
|---|---|
| Keep rejected UAT records visible | Review rejection is an auditable state transition, not destructive deletion |
| Do not advertise binary document support | PDF, DOCX, and PPTX remain disabled until a dedicated extraction worker exists |
| Build the first graph projection from governed OKF concepts | A truthful node-only projection is preferable to fabricated relations; edges remain empty until relation persistence is implemented |
| Grant audit reads only through RLS | The runtime needs activity visibility, but only for its tenant, user, and assigned twins |
| Preserve `Call n8n Workflow Tool` as the internal hierarchy primitive | Actor Twin remains the only frontend agent; Butler, Knowledge Fabric, and subordinate agents remain internal workflow tools |
