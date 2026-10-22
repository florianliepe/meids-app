# Me.IDs Full Platform Functional UAT - 2026-10-22

## Executive result

**Overall status: CONDITIONALLY BLOCKED / core application remediation passed, n8n publication evidence remains open.**

Authentication, first-twin onboarding, twin CRUD, active-twin persistence, picture upload, text/document intake, voice capture, knowledge review, graph projection, traces, SkillSpec creation, and Butler delegation now pass against the Azure-hosted application. The original missing-route failures were remediated and retested.

Public launch remains conditionally blocked only by the stale published Knowledge Fabric workflow and missing fresh execution evidence for Skill Orchestrator, Task Agent, and Learning Agent. The application does not bypass this problem with a direct Task Agent route.

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

This matrix records the current result after remediation. The original 404 baseline is retained in the root-cause section and Git history.

| ID | Area | Test | Result | Evidence |
|---|---|---|---|---|
| FT-01 | Authentication | Open authenticated workspace as Florian | PASS | Workspace and user-scoped twin registry loaded |
| FT-02 | Twin CRUD | Create a new synthetic twin | PASS | `Codex Platform UAT 20261022` created |
| FT-03 | Twin CRUD | Activate the new twin | PASS | Sidebar and active selector changed to the UAT twin |
| FT-04 | Twin CRUD | Update success metrics | PASS | `UAT update marker 20261022` persisted |
| FT-05 | Persistence | Reload browser and recover active twin/profile | PASS | Active twin and all edited profile fields survived reload |
| FT-06 | Profile quality | Compare setup readiness and profile completeness | PASS | Canonical persisted profile reports 100% completeness |
| FT-07 | Twin picture | Select PNG, preview, upload, adjust focus, reload | PASS | Synthetic PNG persisted with horizontal focus 60 and vertical focus 40 |
| FT-08 | Knowledge ingest | Paste synthetic note and auto-create concept | PASS | Concept staged as `review_needed`, then rejected after evidence capture |
| FT-09 | Document ingest | Upload synthetic Markdown fixture | PASS | `meids-uat-source-20261022.md` created a pending-review concept and evidence record |
| FT-10 | Voice capture | Start Persona Modeler from pasted transcript | PASS | Hosted assessment returned normalized scores, W-question coverage and follow-up state |
| FT-11 | Voice draft | Save and reload the open voice conversation | PASS | Draft `fadc22db-ce25-47e2-a270-4dd04c88d08a` persisted and displays 86% in the queue |
| FT-12 | Knowledge cockpit | Load active-twin concepts | PASS | Persisted text, voice and document concepts are visible under the active twin |
| FT-13 | Review cockpit | Load queues and quality signals | PASS | Review cockpit shows four concept items and one approval-gated skill |
| FT-14 | Graph | Load active-twin graph | PASS | Governed concepts project as truthful nodes; zero relations are reported rather than fabricated |
| FT-15 | Traces | Load answer, evidence, CRUD and ingest traces | PASS | RLS-scoped activity and evidence records load for the active twin |
| FT-16 | Skills | Create and decompose synthetic `CODEX UAT Evidence Triage` SkillSpec | PASS | Skill stays `pending_approval`; detail shows Skill Orchestrator, one Task Agent and two Actor checkpoints |
| FT-17 | Production | Exercise Persona Modeler production contract | PASS | The same authenticated hosted assessment/draft/commit contracts pass from Voice Capture |
| FT-18 | Actor Twin | Direct identity/status chat response | PASS | n8n answered successfully in about 4-8 seconds |
| FT-19 | Actor Twin | Verify selected-twin metadata reaches n8n | PASS | Actor Twin authorization-context bindings carry selected twin and signed scope into tool calls |
| FT-20 | Agent routing | Butler draft-only work artifact | PASS | Live validator routed to Agentic Butler and returned a draft |
| FT-21 | Agent routing | Knowledge Fabric handoff | FAIL | Routed correctly, then failed on authorization/tenant credentials |
| FT-22 | Agent routing | Skill-creation handoff/approval | PASS | Butler returns `approval_required` in about 14 seconds; no skill is auto-approved |
| FT-23 | Readiness UI | Compare system status with functional routes | PASS | Launch-critical manifest validates 46 hosted routes and the UI loads the enabled capabilities |

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
| `npm run uat:chat:n8n` | PASS for Actor Twin direct chat; delegated Knowledge Fabric remains blocked |
| `npm run uat:agents:live` | FAIL: 3 passed, 1 failed; only Knowledge Fabric fails |

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
| Voice quality display | CLOSED | Authenticated UAT showed 86% consistency, 86% eligibility, 48 words, and all five W-question dimensions. Draft-list reads show the persisted 86% assessment. |
| Voice preflight and handoff ledger | CLOSED IN CODE; LIVE DELEGATION BLOCKED BY N8N PUBLICATION | Hosted endpoints enforce Entra/twin scope and enter through Actor Twin with `call_n8n_workflow_tool_first`; live delegated proof waits for publication recovery. |
| Voice draft audit write | CLOSED | Migration `013` was applied with the PostgreSQL Entra administrator identity. Authenticated draft save and voice-to-`review_needed` concept commit both passed. |
| Skill creation | CLOSED | Live Actor Twin to Butler route returns `approval_required` within 14 seconds. |
| Frontend SkillSpec detail | CLOSED | The deployed detail contract has no undefined fields. Decomposition produced Skill Orchestrator -> one bounded Task Agent with two Actor checkpoints; approval remains manual. |
| Knowledge Fabric live handoff | OPEN P0 | Live Actor routing is correct, but production n8n still executes an older published HTTP scoring node and rejects its protected backend call. |
| Seven-agent fresh proof | OPEN P1 | Actor Twin, Butler, and Critical Faculty are fresh; Knowledge Fabric fails; Skill Orchestrator, Task Agent, and Learning Agent remain stale. |
| Picture browser upload | CLOSED | Synthetic PNG upload, focus update to 60/40, and persistence after reload passed. |
| Markdown document ingest | CLOSED | Synthetic Markdown source is visible in Knowledge and Review as pending-review with source evidence. |

The live validator now treats delegated authorization and persistence failures as failures even when the outer n8n chat webhook returns HTTP 200. Latest result: 3/4 live interaction cases pass; only Knowledge Fabric fails.

Application deployment and authenticated browser retest are complete. The latest seven-agent probe is intentionally retained as evidence: it shows the Knowledge Fabric publication failure and missing fresh executions for Skill Orchestrator, Task Agent, and Learning Agent rather than claiming those paths passed.

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
| Audit activity | PASS | Migrations `012` and `013` protect runtime reads and scoped inserts; authenticated voice draft auditing passed |
| Knowledge graph | PASS | Graph read contract projects governed PostgreSQL concepts; recommendation/review collections return bounded empty contracts |
| Picture and focus persistence | PASS | Synthetic PNG survives reload and reports 60/40 focus |
| Markdown document ingestion | PASS | `meids-uat-source-20261022.md` is present in Knowledge and Review under the active twin |
| Skill detail and decomposition | PASS | Deployed root contract renders correctly; graph is Actor Twin -> Butler -> Skill Orchestrator -> bounded Task Agent |

### Updated decisions

| Decision | Reason |
|---|---|
| Keep rejected UAT records visible | Review rejection is an auditable state transition, not destructive deletion |
| Do not advertise binary document support | PDF, DOCX, and PPTX remain disabled until a dedicated extraction worker exists |
| Build the first graph projection from governed OKF concepts | A truthful node-only projection is preferable to fabricated relations; edges remain empty until relation persistence is implemented |
| Grant audit reads only through RLS | The runtime needs activity visibility, but only for its tenant, user, and assigned twins |
| Preserve `Call n8n Workflow Tool` as the internal hierarchy primitive | Actor Twin remains the only frontend agent; Butler, Knowledge Fabric, and subordinate agents remain internal workflow tools |
| Apply schema migrations with a privileged deployment identity | The runtime managed identity correctly lacks schema DDL privileges; startup remains `npm start` and migration `013` was applied with a short-lived Entra PostgreSQL administrator token |
