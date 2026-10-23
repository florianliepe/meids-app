# Me.IDs Functional UAT and Defect Backlog

Date: 2026-10-23
Environment: Azure Static Web Apps frontend, Azure App Service backend, published n8n workflows
Tester: Codex using Florian Liepe's authorized production UAT workspace
Twin: Florian Liepe

## Scope and test data

The UAT used synthetic, non-sensitive records with these markers:

- `MEIDS-UAT-20261023-ESCALATION`
- `MEIDS-UAT-20261023-EVIDENCE`
- `MEIDS-UAT-20261023-SKILL`

Covered paths:

1. Sequential mixed-file upload and knowledge staging.
2. Concept review and approval.
3. Actor Twin retrieval through the Knowledge Fabric workflow tool.
4. Skill creation, decomposition, approval, execution, and run history.
5. Nested Actor Twin, Agentic Butler, Critical Faculty, and Knowledge Fabric routing.
6. Review metadata, provenance, trace, and startup-error visibility.

## Results

| ID | Priority | Finding | Root cause | Resolution | Status |
|---|---|---|---|---|---|
| UAT-001 | P0 | Approved skill execution failed with `Simple Memory: No session ID found`. | Backend skill and voice handoffs posted a custom envelope instead of the n8n Chat Trigger contract. | Backend now sends `action`, `sessionId`, `chatInput`, authenticated identity metadata, and a short-lived knowledge token while preserving the orchestration envelope. | Fixed and live-tested |
| UAT-002 | P0 | A successful nested run appeared as `Backend call failure` in the frontend. | The synchronous n8n run took about 70 seconds, longer than the frontend/proxy request boundary. | Skill execution now returns `202 queued`, completes after the response, and persists status in the run ledger. Frontend polls the ledger. Backend n8n timeout is five minutes. | Fixed and live-tested |
| UAT-003 | P1 | Read-only skill execution staged a new Knowledge Fabric concept. | The Actor saw the manual request but not a strong execution-mode instruction; it independently chose `operation=stage`. | The backend now supplies an explicit approved-skill prompt: route first to Agentic Butler and use Knowledge Fabric only with `operation=retrieve` unless the user explicitly requests a write. | Fixed; final retest recorded below |
| UAT-004 | P1 | Knowledge Fabric retrieval returned `connection aborted`, and the parent Actor still invoked a stale Butler snapshot after republishing the same workflow ID. | The Knowledge Fabric draft was not published, and n8n's parent workflow retained the referenced Butler version snapshot. | Published Knowledge Fabric and introduced a callable-only Butler workflow, then rebound and republished Actor Twin. No shared App Service restart was used. | Fixed and live-tested |
| UAT-005 | P1 | Skill run history was empty even after execution. | `/api/skills/runs` returned a static empty response and skill runs were not audited. | Queued, completed, and failed runs are stored in `audit.event` and returned by the scoped run-history endpoint. | Fixed and live-tested |
| UAT-006 | P1 | Approved concept drawer omitted reviewer, timestamp, and note. | Concept queries did not join the latest `knowledge.review_action`. | Concept reads now project the latest review action into list and detail contracts. | Fixed; deployed |
| UAT-007 | P1 | Uploaded evidence showed no source anchor, hash, consent, sensitivity, or curation method. | Document ingestion stored only a minimal citation and did not expose source metadata. | New uploads store and expose checksum, source anchor, capture details, sensitivity, consent scope, and curation method. | Fixed for new uploads; deployed |
| UAT-008 | P1 | Approved concepts could retain evidence labelled pending. | Concept promotion did not update linked evidence citation review metadata. | Promotion now marks linked evidence approved with reviewer, time, and note. | Fixed for new/re-reviewed concepts; deployed |
| UAT-009 | P2 | Embedded Actor Twin answers do not appear in the Trace cockpit. | Embedded n8n chat bypasses the backend trace persistence path and has no post-response callback wired. | Add an n8n post-answer trace branch or a supported chat completion callback that posts the normalized answer trace. | Open |
| UAT-010 | P2 | Initial page load produces optional-endpoint 404 noise and serial latency. | `refreshAll()` eagerly calls legacy and advanced cockpit endpoints even when the active view does not need them. | Split core boot from view-specific refreshes and load optional status panels on demand with `Promise.allSettled`. | Open |
| UAT-011 | P3 | Queued skill submission toast says `completed`. | Frontend success copy assumes every accepted run is synchronous. | Show `Skill run queued` for HTTP 202 and `completed` only after the ledger status changes. | Code fixed; frontend deployment pending in this change set |
| UAT-012 | P1 | The final skill run remained `queued` although all n8n executions succeeded. | The application role could insert but could not update its own `audit.event` skill-run record; no scoped UPDATE grant or RLS policy existed. | Migration `015_audit_skill_run_update_policy.sql` grants narrowly scoped UPDATE access for the current tenant, current user, `agent.skill_run` resource type, and allowed run actions. | Fixed and live-tested |
| UAT-013 | P1 | Azure Search outbox embedding failed when extracted source text exceeded the provider's 8,192-token input boundary. | Full source text was sent to the embedding endpoint without a deterministic input bound. | Embedding input is now normalized and bounded to 24,000 characters before the provider call, while the complete source remains in PostgreSQL and Blob Storage. | Fixed and deployed; contract-tested |
| UAT-014 | P1 | Uploaded audio cannot yet be transcribed in production. | The configured Eraneos AI Gateway model catalogue exposes chat and `text-embedding-3-large`, but no Whisper or other audio-transcription model. | Enable an OpenAI-compatible speech-to-text model in the gateway or provide a separately governed STT endpoint and credential. | Open external dependency |
| UAT-015 | P2 | A queued run can still be lost if the backend process is recycled between returning `202` and completing the detached promise. | The current queue is represented durably in the ledger, but execution is still launched in-process rather than claimed by a durable worker. | Move queued skill execution to a transactional outbox/worker with leases, retries, and idempotent completion. | Open hardening |

## Passed acceptance evidence

- Two files uploaded in one batch: two staged, zero failed, each isolated in its own request.
- A staged protocol concept was reviewed and approved.
- Actor Twin answered the protocol question correctly through Knowledge Fabric and cited the approved source.
- A bounded read-only skill was created, decomposed into Skill Orchestrator plus Task Agent, and approved with human checkpoints.
- The repaired Actor run reached Agentic Butler first and returned a conservative `PAUSE` decision without accepting residual risk.
- Signed read-only retrieval used Actor execution `34368`, Knowledge Fabric execution `34369`, Butler execution `34370`, Skill Orchestrator execution `34371`, Task Agent execution `34372`, and Critical Faculty execution `34374`.
- Final authenticated skill UAT used Actor execution `34386`, callable-only Butler `34387`, Skill Orchestrator `34388`, Task Agent `34389`, and Critical Faculty `34390`/`34391`; every execution succeeded.
- Final run `skill-mvl6uo34-03299b` moved from `queued` to `completed` after migration 015 was applied.
- The final Actor response cited `MEIDS-UAT-20261023-escalation-protocol`, returned `NEEDS REVIEW / PAUSE`, and did not create or modify knowledge.
- Butler classified the call as an approved completed skill run with `approval.required=false`, so normal execution no longer encounters the creation approval gate.

## Decision log

### D-01: Keep Actor Twin as the only user-facing agent

Approved skill execution continues to enter through Actor Twin. The backend strengthens context but does not call Butler directly. Actor Twin remains routing authority and delegates through `Call n8n Workflow Tool`.

### D-02: Queue long skill runs

Nested agent workflows can legitimately exceed browser/proxy request limits. The user-facing request therefore returns after durable queue creation, while run state is read from the scoped ledger. Five minutes is the bounded backend wait for the n8n response.

### D-03: Retrieval must be side-effect free

Knowledge Fabric may write only for explicit remember, save, ingest, create, update, attach, or stage intent. Skill execution and decision checks use `operation=retrieve` unless the original user request explicitly asks to persist knowledge.

### D-04: Publish workflow versions without restarting shared n8n

When `versionId != activeVersionId`, use the n8n workflow activation API to publish the saved version. Restarting the shared Eraneos n8n App Service is not an accepted remediation.

### D-05: Use callable-only subagent workflows

The production Butler subworkflow is `elbiGicaFmQQW4w8`. It starts only with `When Executed by Another Workflow`; it has no public webhook entry. Actor Twin remains the user-facing routing authority and invokes the Butler through `Call n8n Workflow Tool`. Rebinding the parent is required when n8n has retained an older referenced subworkflow snapshot.

### D-06: Keep run-ledger mutation narrowly scoped

The application role may update only its own tenant/user skill-run audit rows and only the run lifecycle actions. General audit-event mutation remains prohibited. Database migrations continue to run through the Entra PostgreSQL administrator path, not the runtime managed identity.

### D-07: Keep original content outside the embedding payload

The search embedding request receives a deterministic bounded representation. PostgreSQL and Blob Storage remain the sources of truth for full content. This prevents provider-limit failures without silently truncating the governed source record.

### D-08: Do not substitute a chat model for speech-to-text

Audio upload stays enabled as an intake format, but transcription remains blocked until the governed gateway exposes a supported transcription model. The application must not send audio to an unapproved endpoint or place a provider key in the browser.

## Release recommendation

Core document upload, review, retrieval, and skill lifecycle paths passed controlled production UAT. Public-launch sign-off should still require UAT-009 (answer trace persistence) and a decision on UAT-015 (durable worker). UAT-010 is performance and operability hardening. Audio transcription remains unavailable until UAT-014 is resolved by the gateway owner.

## Final rerun evidence

- Frontend run: `skill-mvl6uo34-03299b`
- Actor Twin: execution `34386`, succeeded in 164 seconds
- Agentic Butler: execution `34387`, succeeded
- Skill Orchestrator: execution `34388`, succeeded
- Task Agent: execution `34389`, succeeded
- Critical Faculty: executions `34390` and `34391`, succeeded
- Butler route: `activate_skill`
- Butler handoff: `completed_autonomous`
- Approval gate: not required for approved normal skill execution
- Knowledge mutation: none
- Result: `NEEDS REVIEW / PAUSE`, with evidence citation and explicit residual uncertainty
- Run ledger: `completed`
