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
| AZ-05 | P0 on write; P1 on correlation | Delay, disable and fail Learning; duplicate parent; stale/foreign parent; worker crash and retry; Nightly `dry_run`. | User answer never waits for Learning completion. Job is tenant/user/twin/trace correlated and deduplicated. Production `dry_run` completed once on attempt 1 with `proposed_no_write`/`not_persisted`; normal runs may stage only `review_needed`. |
| AZ-06 | P0 | Two real principals exchange tenant/user/twin IDs across chat, job read/cancel, Search, Blob and Graph; include expiry, wrong issuer/audience, role removal and twin switch. | No foreign data, existence leak, cache, trace or action. Invalid auth is 401; foreign valid scope follows the fixed 403/404 contract. |
| AZ-07 | P0 on leak; P1 on grounding | Search corpus with approved, review-needed, withdrawn, deleted, foreign and contradictory markers; manipulated filters; empty search and provider outage. | Only approved and authorized evidence appears. A miss is `not_found` plus one question. Provider outage is degraded/error, not a false no-hit. No marker leak. |
| AZ-08 | P1; P0 on duplicate effect | Failure before provider acceptance, unknown completion, 429/5xx, malformed output, late success and dual-provider failure. | Auth/policy failures never fall back. Unknown completion is not retried. The deterministic timeout contract is covered; controlled live provider acceptance/loss remains open. |
| AZ-09 | P1 | Isolated runtime rollback from Azure route to n8n and back with new and running jobs. | Contracts, IDs and scopes remain stable; running work is not duplicated; recovery target is measured. |
| AZ-10 | P0 | Prove DNS, TLS, private endpoint and managed identity from the App Service process; remove private reachability in an isolated environment. | No public Azure OpenAI route or embedded key. Missing private path fails closed or uses an explicitly accepted fallback. |
| AZ-11 | P1 | Browser progress with slow job, 401 before acceptance, auth expiry after acceptance, double submit, reload, navigation and twin switch. | Progress appears immediately; reconnect reads the existing job and never replays an uncertain submit; stale scope results are not rendered; queued cancellation stays scoped. |
| AZ-13 | P0 | Approval resume under duplicate, stale, foreign, expired and operation-modified requests. | Atomic owner/twin-scoped transaction; operation hash and expiry enforced; duplicate is 409; no duplicate concept or skill. PRs #68/#70/#72/#74/#76/#78/#80 cover mutation, crashes, persistence faults, lock/statement timeouts, deadlock, grant revocation, snapshot immutability and read-only reconciliation. PR #82 forwards COMMIT through a PostgreSQL wire proxy, drops the accepted response, fixes the resulting unhandled client error and proves one terminal effect. Pre-/post-read Reconciler kills and stale dual ordering do not replay or regress state. Foreign real-principal remains AZ-06/AZ-20; HTTP client deadline behavior remains AZ-11. |
| AZ-14 | P1 | Canonical legacy Knowledge Fabric and Butler aliases after n8n cutover. | Azure-native runtime, no fallback; Knowledge retrieval preserves evidence scope; bounded Butler bypasses Skill Orchestrator. Passed at 2,939 ms and 959 ms. |
| AZ-15 | P1 | Voice preparation with legacy target labels and invalid auth. | `mcp`/`n8n` labels normalize to governed knowledge preparation; no external execution; missing/forged token 401. Passed at 1,633 ms. |
| AZ-16 | P0 | Fallback-off route matrix. | Every enabled route is Azure-native; no trace contains n8n fallback. Passed before and after global Azure-native mode activation. |
| AZ-17 | P0 | Stable Entra subject versus internal owner key. | Resolve to an active canonical user, intersect current DB twin grants, and reject unknown/removed scope before persistence. Unit and live owner staging pass. |
| AZ-18 | P1 | Generated skill approval. | Exactly one `pending_approval` SkillSpec, never activated or executed; duplicate decision 409. Passed with synthetic proposal. |
| AZ-19 | P1 | n8n egress observation and retained-setting audit. | Reproducible gate active: App Service HTTP telemetry has Search positive control; 16 current/historical Me.IDs n8n workflows (15 active, one inactive) are inventoried with visible pre-cutover execution retention. Since `2026-11-12T16:27:00Z`, the active window shows zero n8n dependency calls and zero workflow executions. Browser assets publish no n8n URL. Window remains open. |
| AZ-20 | P0 | Full employee/guest RLS matrix after canonical identity mapping. | No cross-user/twin/group/Blob/Search/Graph leak or existence oracle. Open under AZ-06/PROD-008. |
| AZ-21 | P1 | Physical n8n retirement. | After rollback/audit gates, remove webhooks, credentials, workflow admin surfaces and workflows; production remains functional and rollback documentation changes to Azure-only recovery. Open. |
| AZ-22 | P1; P0 on false pass or data leak | Adversarial Azure-native Nightly: bare 202, queued/failed/hanging Learning, stale/foreign job and trace, wrong provider, missing role span, grant revoke during poll, dry-run write attempt and worker/provider uncertainty. | The harness fails closed for synthetic evidence. PR #89 passed PostgreSQL 16 same-worker lease reclaim and rejects stale completion/failure by attempt generation; provider timeout is unknown and non-retryable. Post-deploy UAT passed 5/5 scenarios and 7/7 roles on backend `11d5c944`. Real principal revocation and controlled live process/provider disruption remain open. |
| AZ-23 | P1 | Azure-native route soak across Direct, Retrieval, Sync Work, Async acknowledgement and detached Learning. | The first 10-sample serial window kept every failure in the denominator and exposed 4/50 HTTP 429 responses at 20 RPM. PR #97 and a 50 RPM/50k TPM deployment capacity corrected the bottleneck. The identical post-change window passed 50/50 with route p90 values of 573/2,121/586/52/8,427 ms and zero timeout, cancellation, unknown or 429. Isolated tests cover seconds/date Retry-After parsing, over-cap refusal, cancellation during wait, exhausted retry and 429-to-timeout unknown completion. Accumulate 100 samples per route across at least three windows before final SLO closure; do not combine pre/post-capacity windows without marking them. |
| AZ-24 | P1 | Azure AI Search transient timeout and user-visible retrieval degradation. | Window 2 retained one 4.5-second Search timeout as a Retrieval failure. Prove one deadline-bounded read-only retry, no whole-agent replay, no n8n fallback, and a governed `blocked/retrieval_unavailable` response after exhaustion. Repeat the next serial window only after deployment; preserve the failed sample in the aggregate. |

## Quality and SLO scenario

`AZ-12` is P2, upgraded to P1 if metrics could cause a false release decision. Capture success, error, timeout and cancellation separately for cold, warm, serial and concurrent windows. Report end-to-end, queue wait, provider time and fallback time. Never remove failed requests from percentiles. A route has no SLO verdict when sample size or timestamps are incomplete.

Current budgets remain: direct 20 s critical p90, retrieval 30 s, synchronous work 90 s, async acknowledgement 10 s, queued age 90 s and processing age 240 s. Detached Learning has separate dispatch and execution windows.

## Recovery and soak follow-up from issue tracking

PR #89 proves stale terminal writes cannot win, but attempt fencing alone does not prove that a reclaimed worker will avoid a second provider invocation after the original process dies. The remaining tests therefore distinguish database-state safety from external invocation safety:

1. **RW-01 - worker termination at provider acceptance (P0 on duplicate effect; complete):** `meids.runtime-worker-termination.v1` starts a real worker against PostgreSQL 16, observes provider receipt, kills the worker before response, expires the lease and starts a replacement. Evidence: one provider invocation, zero replacement claims and terminal reconciliation-required `unknown_completion`. Existing completion-generation tests separately cover late result and terminal non-regression.
2. **RW-02 - real principal and grant revocation while polling (P0):** use two dedicated employees, a guest and isolated twins. Revoke after the poll begins, switch twin scope while a response is delayed, and prove current grants remain authoritative without replay or existence leakage.
3. **RW-03 - measured zero-n8n egress (P1; P0 on egress; active):** `npm run n8n:egress:status` combines App Service dependency telemetry, hourly gap/freshness/sampling guards, explicit HTTP/Search positive controls, runtime fallback flags, browser artifact checks and the paginated inventory of 16 current/historical Me.IDs n8n workflows. It reports `observation_in_progress` until 168 hours have elapsed, even when both counters are zero. Public-safe evidence is `frontend/assets/n8n-egress-readiness-status.json`.
4. **RW-04 - isolated rollback rehearsal (P0 on replay):** switch Azure-native to n8n and back for queued, processing, unknown and terminal work. New work needs one linear cutover point; processing/unknown work remains provider-bound and is never redispatched by a global flag change.
5. **RW-05 - route soak including failures (P1):** report `n`, window, p50/p90, timeout, cancellation, unknown and error rates per route. Separate async acknowledgement, queue wait, provider time and completion; never remove failed or censored requests from the SLO verdict.

RW-01 is complete. RW-03 is running passively in parallel; RW-02 remains the next P0 identity gate, RW-04 follows the explicit recovery policy, and RW-05 runs within a predeclared cost and request budget. Successful single probes remain canary evidence, not soak evidence.

## Post-cutover adversarial status

The Project Issue Tracking review classifies AZ-13 through AZ-21 as partial or open despite the successful cutover canaries. Deployment and positive route evidence are not substitutes for fault injection.

1. **P0 identity and RLS:** two real employees plus guest; wrong tenant/audience/issuer/expiry; changed email at stable object ID; revoked grants; scope swapping across Search, Blob, Graph, Queue, Approval and Learning; pooled-connection scope reset.
2. **P0 Approval resume:** concurrent approve/deny, action rollback, client payload mutation, real worker termination before/after commit, per-write Knowledge/Skill fault injection, lock/statement timeout, deadlock abort, deterministic grant revocation/ABA, stored-snapshot mutation, lost COMMIT transport acknowledgement, in-flight reconciliation, pre-/post-read Reconciler interruption and stale dual-Reconciler ordering are complete. Foreign real-principal isolation remains under AZ-06/AZ-20; full browser/API client-deadline UX remains under AZ-11.
3. **P0 unknown completion:** provider acceptance followed by connection loss, effect-before-commit worker death, lease expiry and late stale completion. Reconcile; never replay automatically.
4. **P0/P1 fallback boundary:** every legacy alias/method/version plus Azure 429/5xx, timeout, malformed response, DNS and managed-identity failures with fallback disabled. Instrument n8n egress rather than inferring zero from missing logs.
5. **P1 Skill/Critic budgets:** task failure, malformed/late task, attempted third task, retry, Critic outage and combined Retrieval/Butler/Critic delay under one end-to-end deadline.
6. **P0/P1 media:** Voice and Document from upload through scan, parse/transcribe, confirmation, review, Blob visibility, indexing and retention/deletion. Prepare-only evidence is not full lifecycle evidence.
7. **P1 Learning/Nightly:** correlate fresh Azure root trace, job, approval, provider and revision. A transport acknowledgement or stale n8n execution cannot pass.
8. **P1 rollback/retirement:** define owner, trigger, RTO and end date; rehearse native-only to n8n and back with queued, processing, approval-required and unknown work before deleting n8n assets.

The production observation started at the global Azure-native cutover, `2026-11-12T16:27:00Z`. The latest public-safe artifact has outbound HTTP/Search telemetry, zero n8n App Service dependencies and zero executions across 16 current/historical Me.IDs n8n workflows. This remains an in-progress gate until the full 168-hour window elapses.

## Promotion rule

No P0 may remain open. Every enabled candidate route must pass its P1 cases; otherwise that route stays disabled. n8n credentials and workflows remain available only for the measured rollback window and are retired after provider parity, audit retention and live two-principal isolation are complete.
