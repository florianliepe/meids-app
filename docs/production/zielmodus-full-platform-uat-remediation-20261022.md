# Zielmodus: Full-platform UAT remediation

Date: 2026-10-22
Owner: Florian Liepe
Scope: Azure production UAT for the Me.IDs frontend, backend, data plane, and n8n agent hierarchy.

## Non-negotiable architecture decisions

1. The Actor Twin remains the only user-facing agent and routing authority.
2. Agent-to-agent delegation uses n8n `Call n8n Workflow Tool` nodes first. Direct webhooks are reserved for public entry points, backend entry points, health probes, and diagnostics.
3. All durable user data is authorized by Microsoft Entra identity, tenant, twin access, and PostgreSQL row-level security.
4. New or changed knowledge is staged as `review_needed` or `updated`; it is not trusted retrieval material until promoted.
5. Every launch-critical frontend request must have an explicit backend contract. A missing route is a release-blocking defect, not a static-mode fallback condition.

## Execution packages

### Package 1: Contract closure

- Add a machine-readable launch-critical API manifest and CI parity check.
- Implement persistent twin-picture, source-ingest, concept-review, skill-draft, voice-draft, activity, and review-dashboard contracts.
- Return bounded, structured errors for unsupported file types and unavailable capabilities.
- Expose capability health so the frontend can distinguish unavailable features from empty data.

Exit gate: every launch-critical route is registered and passes contract tests.

### Package 2: Data and authorization

- Add additive PostgreSQL tables for skill specifications and voice interview drafts.
- Apply tenant, owner, allowed-twin, and role checks on every read and write.
- Store knowledge through the existing Knowledge Fabric persistence/outbox path.
- Keep avatar payloads bounded and tenant-scoped; migrate them to Blob when profile-media volume requires it.

Exit gate: twin A cannot read or mutate twin B without an explicit access grant.

### Package 3: Agent hierarchy

- Actor Twin delegates Knowledge Fabric, Butler, Critical Faculty, and Learning work through `Call n8n Workflow Tool`.
- Agentic Butler delegates executable work through Skill Orchestrator; Skill Orchestrator delegates bounded operations to Task Agent.
- Knowledge Fabric delegates retrieval interviews and critical review through workflow tools.
- Propagate signed authorization context, selected twin, request/trace IDs, and normalized timeout/fallback responses through every tool call.

Exit gate: live traces prove the expected parent-child chain; no specialist is exposed as a second frontend chat.

### Package 4: Frontend resilience

- Calculate twin completeness from current profile fields when the backend does not provide a precomputed value.
- Keep failed capability panels actionable and independent so one failure cannot block workspace entry or unrelated views.
- Remove production reliance on browser-local persistence.

Exit gate: create, update, activate, reload, picture, ingest, review, skill draft, and voice draft/commit work after a clean sign-in.

### Package 5: Deploy and evidence

- Run static checks, API parity, backend contracts, n8n fixture tests, and live probes.
- Apply additive migrations before exposing new routes.
- Deploy backend and frontend through the existing Azure GitHub workflows.
- Repeat authenticated UAT and record evidence, residual risk, and rollback points.

Exit gate: all P0/P1 scenarios pass or have an explicitly accepted owner, mitigation, and review date.

## Decision log

| Decision | Reason | Consequence |
|---|---|---|
| Use a compatibility API module instead of adding more logic to the main server router | Keeps production contracts testable while the backend is later modularized | One explicit routing boundary is added now; broader refactoring remains deferred |
| Store bounded avatar data in the twin profile for this package | Avoids public Blob URLs and SAS issuance while preserving tenant/RLS enforcement | Enforce type and size limits; Blob migration remains a scale optimization |
| Persist skill drafts in PostgreSQL, not GitHub | User-owned drafts require RLS, review state, and transactional behavior | Approved version export to the agent-config repository remains a separate release action |
| Route interactive skill runs through Actor Twin | Preserves Actor Twin routing authority and n8n workflow-tool hierarchy | The backend must not call Task Agent or Butler directly |
| Reject unsupported binary document extraction explicitly | False-positive ingestion is worse than a clear capability error | PDF/DOCX extraction needs a dedicated worker before being marked supported |

## Human interaction policy

Human action is requested only for tenant consent, unavailable Azure capacity, secret creation/rotation, destructive data decisions, or explicit production-risk acceptance. Routine code, migration, deployment, and reversible configuration changes are executed autonomously.
