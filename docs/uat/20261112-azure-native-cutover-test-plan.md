# Azure-native agent cutover test plan

Last updated: 2026-11-12

This plan consolidates the adversarial review from the Project Issue Tracking chat. Tests use synthetic no-write inputs unless a disposable record and cleanup policy are declared. Every result must record candidate SHA, route, synthetic case, request/job/parent ID, provider, attempt, timestamps, elapsed milliseconds and a redacted trace reference. Tokens, prompts and production knowledge are never written to the artifact.

## Existing evidence

- Direct route: 20/20 serial Azure-primary responses, p50 814 ms, p90 1,044 ms, max 1,402 ms.
- Authorization edge: missing and forged knowledge tokens return `401 blocked_auth_context`.
- Retrieval: Azure shadow and primary paths complete; an approved-evidence miss returns `not_found` plus one targeted question.
- Private model path: three Azure-primary responses passed after Azure OpenAI public network access was disabled.
- Local candidate: Azure runtime, backend, agent, access, Entra, frontend and API parity suites pass; 29 lifecycle/background/identity tests pass.
- Production cutover: `MEIDS_AGENT_RUNTIME=azure_native`, shadow disabled and fallback false. Direct, retrieval, bounded Butler, queued Skill/Task, conditional Critical Faculty, approval resume, skill proposal, tacit interview, clarification and Voice preparation passed without fallback.
- Approval: synthetic knowledge staged once as `review_needed`; synthetic skill staged once as `pending_approval`; duplicate resumes returned 409. PR #66 made claim, bounded action and terminal state atomic. Ephemeral PostgreSQL CI passed approve-wins, reject-wins and action rollback. PR #72 then injected failures into all seven Knowledge and both Skill proposal persistence steps; every case restored retryable pending with zero domain writes, while success traces used one backend process and transaction. Production marker `AZ-NATIVE-APPROVAL-RACE-1794502145031` returned reject 200 / approve 409 and therefore created no knowledge write.
- Identity: the signed Entra object ID resolves to the canonical application user and current twin grants before Search or persistence.

These are route smokes, not proof for queued work, Learning, concurrency or two-principal isolation.

Queued work and detached Learning now have production evidence. Concurrency, complete two-principal/guest isolation, rollback rehearsal and the no-egress observation window remain separate gates.

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
| AZ-13 | P0 | Approval resume under duplicate, stale, foreign, expired and operation-modified requests. | Atomic owner/twin-scoped transaction; operation hash and expiry enforced; duplicate is 409; no duplicate concept or skill. PRs #68/#70/#72/#74 cover client mutation, process termination, every persistence failpoint, lock timeout and deadlock abort. PR #76 establishes the current-grant security linearization point. PR #78 and migration 021 reject stored-snapshot mutation before claim and after waiting on an in-flight claim. Foreign real-principal, statement/request timeout and reconciliation-interruption cases remain. |
| AZ-14 | P1 | Canonical legacy Knowledge Fabric and Butler aliases after n8n cutover. | Azure-native runtime, no fallback; Knowledge retrieval preserves evidence scope; bounded Butler bypasses Skill Orchestrator. Passed at 2,939 ms and 959 ms. |
| AZ-15 | P1 | Voice preparation with legacy target labels and invalid auth. | `mcp`/`n8n` labels normalize to governed knowledge preparation; no external execution; missing/forged token 401. Passed at 1,633 ms. |
| AZ-16 | P0 | Fallback-off route matrix. | Every enabled route is Azure-native; no trace contains n8n fallback. Passed before and after global Azure-native mode activation. |
| AZ-17 | P0 | Stable Entra subject versus internal owner key. | Resolve to an active canonical user, intersect current DB twin grants, and reject unknown/removed scope before persistence. Unit and live owner staging pass. |
| AZ-18 | P1 | Generated skill approval. | Exactly one `pending_approval` SkillSpec, never activated or executed; duplicate decision 409. Passed with synthetic proposal. |
| AZ-19 | P1 | n8n egress observation and retained-setting audit. | No runtime egress during the agreed window; retained settings are documented rollback-only and inaccessible to browser code. Open. |
| AZ-20 | P0 | Full employee/guest RLS matrix after canonical identity mapping. | No cross-user/twin/group/Blob/Search/Graph leak or existence oracle. Open under AZ-06/PROD-008. |
| AZ-21 | P1 | Physical n8n retirement. | After rollback/audit gates, remove webhooks, credentials, workflow admin surfaces and workflows; production remains functional and rollback documentation changes to Azure-only recovery. Open. |

## Quality and SLO scenario

`AZ-12` is P2, upgraded to P1 if metrics could cause a false release decision. Capture success, error, timeout and cancellation separately for cold, warm, serial and concurrent windows. Report end-to-end, queue wait, provider time and fallback time. Never remove failed requests from percentiles. A route has no SLO verdict when sample size or timestamps are incomplete.

Current budgets remain: direct 20 s critical p90, retrieval 30 s, synchronous work 90 s, async acknowledgement 10 s, queued age 90 s and processing age 240 s. Detached Learning has separate dispatch and execution windows.

## Post-cutover adversarial status

The Project Issue Tracking review classifies AZ-13 through AZ-21 as partial or open despite the successful cutover canaries. Deployment and positive route evidence are not substitutes for fault injection.

1. **P0 identity and RLS:** two real employees plus guest; wrong tenant/audience/issuer/expiry; changed email at stable object ID; revoked grants; scope swapping across Search, Blob, Graph, Queue, Approval and Learning; pooled-connection scope reset.
2. **P0 Approval resume:** concurrent approve/deny, action rollback, client payload mutation, real worker termination before/after commit, per-write Knowledge/Skill fault injection, lock timeout, deadlock abort, deterministic post-Approval grant revocation/ABA and privileged stored-snapshot mutation are complete. Remaining: foreign real principal, statement/request timeout around commit and interruption during a separate reconciliation attempt.
3. **P0 unknown completion:** provider acceptance followed by connection loss, effect-before-commit worker death, lease expiry and late stale completion. Reconcile; never replay automatically.
4. **P0/P1 fallback boundary:** every legacy alias/method/version plus Azure 429/5xx, timeout, malformed response, DNS and managed-identity failures with fallback disabled. Instrument n8n egress rather than inferring zero from missing logs.
5. **P1 Skill/Critic budgets:** task failure, malformed/late task, attempted third task, retry, Critic outage and combined Retrieval/Butler/Critic delay under one end-to-end deadline.
6. **P0/P1 media:** Voice and Document from upload through scan, parse/transcribe, confirmation, review, Blob visibility, indexing and retention/deletion. Prepare-only evidence is not full lifecycle evidence.
7. **P1 Learning/Nightly:** correlate fresh Azure root trace, job, approval, provider and revision. A transport acknowledgement or stale n8n execution cannot pass.
8. **P1 rollback/retirement:** define owner, trigger, RTO and end date; rehearse native-only to n8n and back with queued, processing, approval-required and unknown work before deleting n8n assets.

The initial read-only egress observation from `2026-11-12T16:27:00Z` through `16:33:28Z` found zero n8n executions. This six-minute sample is recorded only as a sensor smoke, not as the required observation window.

## Promotion rule

No P0 may remain open. Every enabled candidate route must pass its P1 cases; otherwise that route stays disabled. n8n credentials and workflows remain available only for the measured rollback window and are retired after provider parity, audit retention and live two-principal isolation are complete.
