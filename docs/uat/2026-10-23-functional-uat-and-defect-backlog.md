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
| UAT-009 | P2 | Embedded Actor Twin answers do not appear in the Trace cockpit. | Embedded n8n chat bypassed the backend trace persistence path. | Added a deterministic n8n post-answer branch that writes a signed, twin-scoped trace and then returns the unchanged Actor answer. The same trace queues detached learning when enabled. | Fixed and live-tested |
| UAT-010 | P2 | Initial page load produces optional-endpoint 404 noise and serial latency. | `refreshAll()` eagerly called legacy and advanced cockpit endpoints even when the active view did not need them. | Core boot now refreshes only the active view. Each cockpit loads its own independent data in parallel through `Promise.allSettled` when opened. | Fixed and live-tested |
| UAT-011 | P3 | Queued skill submission toast says `completed`. | Frontend success copy assumes every accepted run is synchronous. | Show `Skill run queued` for HTTP 202 and `completed` only after the ledger status changes. | Fixed and deployed |
| UAT-012 | P1 | The final skill run remained `queued` although all n8n executions succeeded. | The application role could insert but could not update its own `audit.event` skill-run record; no scoped UPDATE grant or RLS policy existed. | Migration `015_audit_skill_run_update_policy.sql` grants narrowly scoped UPDATE access for the current tenant, current user, `agent.skill_run` resource type, and allowed run actions. | Fixed and live-tested |
| UAT-013 | P1 | Azure Search outbox embedding failed when extracted source text exceeded the provider's 8,192-token input boundary. | Full source text was sent to the embedding endpoint without a deterministic input bound. | Embedding input is now normalized and bounded to 24,000 characters before the provider call, while the complete source remains in PostgreSQL and Blob Storage. | Fixed and deployed; contract-tested |
| UAT-014 | P1 | Uploaded audio could not be transcribed in production. | The `/v1/models` response did not advertise input modalities, while the portal catalogue exposed Gemini audio-input capability through chat completions rather than `/audio/transcriptions`. | Added `chat_completions_audio` transport and selected `gemini-3.8-flash` through the server-side Eraneos Gateway credential. A synthetic WAV probe returned a correct transcript with audio-token accounting. | Fixed and live-tested |
| UAT-015 | P2 | A queued run can still be lost if the backend process is recycled between returning `202` and completing the detached promise. | The current queue is represented durably in the ledger, but execution is still launched in-process rather than claimed by a durable worker. | Move queued skill execution to a transactional outbox/worker with leases, retries, and idempotent completion. | Open hardening |
| UAT-016 | P0 | Actor Twin generated a plausible self-description instead of grounding it in reviewed knowledge. | Actor instructions explicitly allowed direct self-description and frontend metadata set `answerDirectFirst=true`. | Replaced this with an evidence-first routing contract: all personal, twin, organizational, decision, process, and experience claims require Knowledge Fabric retrieval; missing evidence returns `not_found`. | Fixed and live-tested |
| UAT-017 | P0 | A completed chat answer appeared briefly and then disappeared. | Five-minute token refresh and interaction-setting changes destroyed and recreated the embedded chat DOM. Simple Memory did not guarantee that the widget would reconstruct the transcript. | Token lifetime is one hour by default. Token and setting changes no longer reload chat automatically; reconnect is explicit so the visible answer is preserved. | Fixed and live-tested |
| UAT-018 | P1 | Voice Capture showed `Ready` although the configured model was rejected by the provider. | Readiness checked only for key/base/model strings and supplied an unverified default model. | Readiness now requires an explicit model and transport mode, exposes both in health status, and uses the live-probed Gateway configuration. | Fixed and live-tested |
| UAT-019 | P2 | Opening Voice Capture emitted two 404 warnings and left example/coverage controls without data. | The production frontend called `ui-uat-samples` and `real-coverage`, but the PostgreSQL workspace API did not expose those routes. | Added authenticated sample and twin-scoped real-coverage endpoints and pinned them in the audio-upload contract test. | Fixed and live-tested |
| UAT-020 | P1 | Selecting an ingested knowledge node displayed `Node detail failed: Not found`, although the node was present in the graph. | The frontend called `GET /api/okf/graph/node`, but the PostgreSQL workspace API implemented only the graph collection route. | Added the missing twin-scoped, RLS-backed node-detail route using the same projection as the graph overview. Added normalized evidence output and a frontend snapshot fallback for rolling-deployment skew. | Fixed and live-tested |
| UAT-021 | P0 | A 2:19 Voice Capture recording ended with `Audio ingest failed: Backend call failure`, although speech-to-text was configured. | The App Service completed the provider request successfully in 95.762 seconds, after the Azure Static Web Apps linked-backend request boundary had already closed the browser connection. | Voice uploads now return `202 queued`; an append-only, user/twin-scoped PostgreSQL ledger records processing, completion, or failure, and the frontend polls a scoped status endpoint before starting the Persona Modeler flow. | Fixed and live-tested; the browser retained the queued job and displayed backend progress beyond the SWA request boundary |
| UAT-022 | P1 | The first asynchronous rerun remained queued correctly but failed after three minutes with `The operation was aborted due to timeout`. | The multimodal Gateway request exceeded the backend's previous 180-second provider timeout. | Increased the bounded provider timeout to 360 seconds in App Service and Bicep. The browser's 12-minute job deadline and explicit failure state remain unchanged. | Fixed and live-tested; the final job completed in 2.413 seconds |
| UAT-023 | P1 | The timeout-adjusted rerun failed with no transcript despite an HTTP-successful Gateway response. | `gemini-3.8-flash` returned `finish_reason=content_filter` and `content=null` for the benign synthetic WAV; the backend previously collapsed that response into a generic empty-transcript error. | Use the live-proven `gemini-3.5-flash` audio model as primary, retain `3.8` as a bounded fallback, and expose empty/content-filter results explicitly. | Fixed, deployed, and live-tested |
| UAT-024 | P1 | A saved Voice Capture draft could neither be committed nor clearly closed; DevTools showed two `/api/sync/archive/*` 404 responses. | Draft persistence succeeded, but the UI immediately requested local-MVP-only archive telemetry. The quality gate correctly kept `Save concept` disabled, while no explicit finish-later action existed. | Skip archive-only telemetry during Voice Capture refreshes, show the quality-gate reason, and add a guarded Close/Finish later action that preserves saved drafts and confirms before discarding unsaved work. | Fixed in code; deployment and live regression pending |
| UAT-025 | P1 | A saved Voice Capture draft appeared in Resume draft but failed to reopen with `Voice concept draft not found`. | The draft-list route already returned the authorized complete record, but the UI made a redundant detail request and expected a flat response although the backend returns `{ draft }`. | Resume from the scoped list record first; retain the detail route as a fallback and normalize its response wrapper. | Fixed in code; deployment and live regression pending |

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
- On 2026-10-24, the authenticated Azure frontend uploaded a synthetic WAV through Source Upload. The Eraneos AI Gateway `gemini-3.8-flash` model returned `Dies ist ein MEIDs Audiotranskription Test`, Voice Capture reported backend speech-to-text as configured, and the Persona Modeler opened the expected clarification flow with review-gated transcript evidence.
- Backend and frontend deployments for commit `602243f` completed successfully. The production credential remained a Key Vault reference; no API key was sent to the browser.
- On 2026-10-24, commit `8e5311e` deployed the graph node-detail contract. Authenticated Azure UAT opened an approved concept and returned its content, evidence, governance state, and Actor-readiness data with no 404 and no snapshot fallback.
- On 2026-10-26, authenticated Azure UAT job `voice-transcription-mvp2rj58-061b3c17` completed in 2.413 seconds with `gemini-3.5-flash`. The frontend displayed the transcript, created evidence `voice-transcription:voice_evidence_mvp2rl06_8844568f`, and opened the Persona Modeler clarification flow without saving knowledge before its quality gate.

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

### D-08: Use governed multimodal transcription before an external fallback

Audio stays inside the Eraneos AI Gateway boundary. A chat-capable model may be used for speech-to-text only when its catalogue marks audio input and a live synthetic probe confirms the exact transport contract. Provider keys remain in Key Vault and never enter the browser. Direct OpenAI transcription is a dormant fallback, activated only by explicit server configuration.

### D-09: Personal claims are retrieval-first

Self-description is not ordinary conversation. Every personal, twin, organizational, process, and decision claim requires reviewed Knowledge Fabric evidence. Missing evidence is an explicit, recoverable state rather than permission to speculate.

### D-10: Preserve the visible chat over automatic context refresh

Authorization refresh and setup changes update local state without destroying the embedded chat. Reconnection is explicit because preserving a completed answer is more valuable than silently applying changed metadata mid-conversation.

### D-11: Persist traces after the answer without changing it

The n8n workflow writes the answer trace after the Actor completes and restores the Actor output as the terminal workflow item. Trace failure is observable but cannot replace the user-facing response.

### D-12: Decouple long audio transcription from the frontend request boundary

The authenticated upload request validates ownership, format, size, and twin scope, then returns a job ID immediately. Provider processing continues in the App Service and writes append-only job events under PostgreSQL RLS. The browser polls only its own twin-scoped job. This prevents Azure Static Web Apps proxy timeouts from being reported as provider failures. A job that survives neither completion nor failure for 12 minutes is shown as expired and can be retried; moving audio bytes to a durable queue remains a separate resilience improvement for process-recycle recovery.

### D-13: Prefer the live-proven audio model and bound fallback behavior

`gemini-3.5-flash` is the primary Eraneos AI Gateway transcription model because the controlled WAV probe completed in 2.410-2.413 seconds with audio-token accounting. `gemini-3.8-flash` remains a bounded fallback only for empty or content-filtered primary responses. The backend never retries authorization, transport, truncation, or timeout failures blindly, and it reports the final provider reason without exposing credentials or audio bytes.

## Release recommendation

Core document upload, review, retrieval, skill lifecycle, answer trace, Actor grounding, and authenticated audio-upload transcription paths passed controlled production UAT. Public-launch sign-off still requires a decision on UAT-015 (durable worker). A physical microphone recording remains a useful device/browser regression check, but it is no longer a provider-integration blocker.

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
- Azure Static Web Apps startup after commit `7bf57f1`: authenticated, Actor Twin chat connected, zero new browser console warnings/errors

## Grounding and trace rerun evidence

- Actor execution `34432` invoked Knowledge Fabric and returned `not_found` rather than inventing a professional biography.
- Knowledge Fabric returned two real approved-index matches, concept IDs `56d22e31-a1db-4c05-86dc-df0b1084a38d` and `09454f99-a0fc-4d06-a230-3d6be701ffae`, and Actor correctly identified that neither supported a professional identity claim.
- Actor execution `34435` completed through `Persist post-answer trace` and `Preserve Actor answer`.
- Trace `n8n_exec_34435` is stored with tenant `eraneos`, user/twin `florian`, the input/output summaries, and `post_turn_learning=queued`.
- The final chat answer remained `Trace persistence verified.`; the trace branch did not replace the response.
