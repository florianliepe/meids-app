# Azure-native agent cutover test plan

Last updated: 2026-11-12

This plan consolidates the adversarial review from the Project Issue Tracking chat. Tests use synthetic no-write inputs unless a disposable record and cleanup policy are declared. Every result must record candidate SHA, route, synthetic case, request/job/parent ID, provider, attempt, timestamps, elapsed milliseconds and a redacted trace reference. Tokens, prompts and production knowledge are never written to the artifact.

## Existing evidence

- Direct route: 20/20 serial Azure-primary responses, p50 814 ms, p90 1,044 ms, max 1,402 ms.
- Authorization edge: missing and forged knowledge tokens return `401 blocked_auth_context`.
- Retrieval: Azure shadow and primary paths complete; an approved-evidence miss returns `not_found` plus one targeted question.
- Private model path: three Azure-primary responses passed after Azure OpenAI public network access was disabled.
- Local candidate: Azure runtime, backend, agent, access, Entra, frontend and API parity suites pass; 26 lifecycle/background tests pass.

These are route smokes, not proof for queued work, Learning, concurrency or two-principal isolation.

## Release-blocking scenarios

| ID | Priority | Scenario | Exit criteria |
| --- | --- | --- | --- |
| AZ-01 | P1; P0 on authorization bypass | Versioned routing fixtures cover direct identity/status, reviewed retrieval, unknown fact, one bounded artifact, dependent multi-step work, ambiguity, negation, quotation and prompt-injection text. | Security-sensitive routes are 100% correct; user text cannot lower authorization or effect gates; ambiguity asks for clarification. |
| AZ-02 | P1 | Single bounded task under success, provider error, timeout and duplicate idempotency input. | Exactly one logical Butler call, zero Skill/Task calls, explicit unknown completion, no hidden second chain. |
| AZ-03 | P1; P0 on duplicate effect | PostgreSQL queue claim race, lease expiry, stale worker completion, restart, cancel-before-claim and cancel-after-claim. | One valid claim; stale lease writes rejected; pending/failed cancellation is atomic and purges payload; processing cancellation remains 409; terminal jobs do not revive. Maximum two logical Task Agents per job. |
| AZ-04 | P0 | Harmless versus high-risk requests, risk-lowering prompt injection, Critical Faculty timeout/failure. | Harmless work has no critic; high-risk or uncertain evidence-dependent work requires the critic; review cannot replace authorization; unsafe uncertainty fails closed. |
| AZ-05 | P0 on write; P1 on correlation | Delay, disable and fail Learning; duplicate parent; stale/foreign parent; worker crash and retry. | User answer never waits for Learning completion. Job is tenant/user/twin/trace correlated and deduplicated. Only `review_needed` increments may be staged; no approved knowledge/profile/graph write. |
| AZ-06 | P0 | Two real principals exchange tenant/user/twin IDs across chat, job read/cancel, Search, Blob and Graph; include expiry, wrong issuer/audience, role removal and twin switch. | No foreign data, existence leak, cache, trace or action. Invalid auth is 401; foreign valid scope follows the fixed 403/404 contract. |
| AZ-07 | P0 on leak; P1 on grounding | Search corpus with approved, review-needed, withdrawn, deleted, foreign and contradictory markers; manipulated filters; empty search and provider outage. | Only approved and authorized evidence appears. A miss is `not_found` plus one question. Provider outage is degraded/error, not a false no-hit. No marker leak. |
| AZ-08 | P1; P0 on duplicate effect | Failure before provider acceptance, unknown completion, 429/5xx, malformed output, late success and dual-provider failure. | Auth/policy failures never fall back. Unknown completion is not retried. Allowed fallback is bounded and visible in the trace. |
| AZ-09 | P1 | Isolated runtime rollback from Azure route to n8n and back with new and running jobs. | Contracts, IDs and scopes remain stable; running work is not duplicated; recovery target is measured. |
| AZ-10 | P0 | Prove DNS, TLS, private endpoint and managed identity from the App Service process; remove private reachability in an isolated environment. | No public Azure OpenAI route or embedded key. Missing private path fails closed or uses an explicitly accepted fallback. |
| AZ-11 | P1 | Browser progress with slow job, 401 before acceptance, auth expiry after acceptance, double submit, reload, navigation and twin switch. | Progress appears immediately; reconnect reads the existing job and never replays an uncertain submit; stale scope results are not rendered; queued cancellation stays scoped. |

## Quality and SLO scenario

`AZ-12` is P2, upgraded to P1 if metrics could cause a false release decision. Capture success, error, timeout and cancellation separately for cold, warm, serial and concurrent windows. Report end-to-end, queue wait, provider time and fallback time. Never remove failed requests from percentiles. A route has no SLO verdict when sample size or timestamps are incomplete.

Current budgets remain: direct 20 s critical p90, retrieval 30 s, synchronous work 90 s, async acknowledgement 10 s, queued age 90 s and processing age 240 s. Detached Learning has separate dispatch and execution windows.

## Promotion rule

No P0 may remain open. Every enabled candidate route must pass its P1 cases; otherwise that route stays disabled. n8n credentials and workflows remain available only for the measured rollback window and are retired after provider parity, audit retention and live two-principal isolation are complete.
