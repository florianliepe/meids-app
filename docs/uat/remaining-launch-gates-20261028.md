# Remaining Launch Gates UAT

Date: 2026-10-28

Scope: fresh agent executions, durable runtime recovery, embedded-chat authentication expiry, cross-user/guest isolation, and Windows/macOS upload coverage.

## Result summary

| Gate | State | Evidence |
| --- | --- | --- |
| Seven-agent fresh executions | Passed | `n8n-seven-agent-live-probe-evidence.json` records 7/7 fresh successful workflows. |
| Queued-job process recycle | Passed | Synthetic no-write skill run `skill-mvsbk1ao-aea0f1` was queued before a recycle of only `meids-prod-backend-1853a19b`. It completed on attempt 2 after the 420-second lease boundary, without an error, and its payload was purged. See `runtime-job-recovery-uat.json`. |
| Expired embedded-chat auth | Passed locally; deploy pending | `validate-expired-chat-auth-contract.cjs` proves structured `blocked_auth_context`, automatic context renewal and chat reconnect, and no unsafe request replay. |
| Cross-user and guest isolation | Partially passed | Employee-A, employee-B, and guest Search-filter contracts passed. Azure edge rejected anonymous and forged-principal `/api/session` requests with 401. Existing PostgreSQL runtime-role evidence returned 19 permitted graph nodes and zero for a wrong tenant. Full real-session API/Search/Blob/graph traversal remains pending for two employees and one guest. |
| Device/upload matrix | Partially passed | M4A, PPTX slides/notes, macOS filename handling, native Pages/Keynote rejection guidance, 25 MB file limit, and 100 MB sequential batch buffer passed automated contracts. Physical Windows/macOS microphone UAT remains pending. |

## Defects found and fixes

### AUTH-EDGE-001: visibility prefilter broader than granted token scopes

The final Azure AI Search security clause already blocked ungranted team and organization scopes, but the candidate prefilter named those scopes for every identity. This was not an exposure because the final clause was conjunctive. It was nevertheless broader than necessary and made the filter harder to audit.

Fix: build the candidate prefilter from the token's granted `visibility_scopes`. A guest token limited to `private` and `twin_shared` no longer names `team_shared` or `org_shared` anywhere in its filter.

### N8N-LEARN-001: malformed webhook acknowledgement

The Learning Agent webhook returned the literal value `firstEntryJson` even though its internal run completed correctly.

Fix: remove the unsupported response-data literal from the live and canonical workflow, publish the workflow, and accept the immediate n8n acknowledgement contract. The direct webhook now returns `{"message":"Workflow was started"}`.

### PROBE-001: stale hard-coded workflow IDs

The seven-agent collector reported 0/7 because it followed superseded Knowledge Fabric and Butler workflow IDs.

Fix: discover workflow-tool targets from Actor Twin, Agentic Butler, and Skill Orchestrator definitions, with environment IDs only as fallback.

### RECOVERY-001: interrupted runtime job appeared queued during its lease

The controlled App Service recycle interrupted the worker after it had leased the synthetic skill job. The job correctly remained unavailable to another worker until the 420-second lease expired, so the UI continued to show it as queued during that safety interval.

Result: the replacement worker reclaimed the job, completed it on attempt 2, recorded no final error, and purged the payload. This is expected at-least-once recovery behavior rather than a lost job. The shared n8n service was not restarted.

## Decision log

| ID | Decision | Reason |
| --- | --- | --- |
| LG-001 | Use synthetic no-write prompts for all seven agent probes. | Proves routing and execution without creating knowledge, issues, schedules, or external side effects. |
| LG-002 | Never replay an interrupted request after renewing chat authorization. | Replaying could duplicate a write or tool action; reconnect and ask the user to submit again. |
| LG-003 | Respect the 420-second runtime-job lease after process recycle. | Immediate reclaim could duplicate an in-flight n8n call; expired leases are the safe recovery boundary. |
| LG-004 | Keep physical microphone validation separate from format-contract tests. | Browser permissions, device codecs, and Safari behavior cannot be truthfully certified by Node contract tests. |
| LG-005 | Do not accept filter-shape tests as final real-user RLS UAT. | Public launch still requires two employees and one accepted guest to prove end-to-end isolation across all stores. |
| LG-006 | Keep the runtime lease at 420 seconds for launch and expose the recovery state in operations evidence. | Reclaiming earlier risks duplicate agent execution; the controlled recycle proved safe recovery at the configured boundary. |

## Human validation still required

1. Employee B: create a private twin/concept; verify Employee A and the guest cannot list, retrieve, graph, or search it.
2. Guest: create or access only the explicitly assigned guest twin; verify no private employee knowledge appears.
3. Windows Chrome: record, transcribe, save draft, close, reopen, and save a concept.
4. macOS Safari and Chrome: repeat microphone flow and upload one M4A, one PPTX with notes, and one mixed batch under 100 MB.
5. Record browser, OS, file sizes, result IDs, and any console/network errors in `device-upload-launch-matrix.json` or a signed companion report.
