# Background-job lifecycle: consolidated issue and test backlog

Review date: 2026-11-11. Source reviewed: main at `3bc1d5c`.
Scope: test definitions and backlog feedback only. No production requests,
job creation/cancellation, data changes, deployments or privileged actions.

## Resolved defect under PROD-024

An authenticated direct entry displayed a completed background job as Queued.
The missing `body.dataset.activeView` caused the polling callback to stop at its
first tick. PR #49 initializes the visible workspace and resolves the current view
from explicit marker, active navigation, then active view. PR #50 consolidates the
release record. The development chat reports 15 passing background tests, protected
deployment success and authenticated direct-entry Ready without navigation.
The canonical main backlog corroborates the recorded fix/retest. This review did
not repeat authenticated production verification. No production job identifiers or
user content are copied into these test definitions.

Keep this specific presentation defect resolved. Do not mark all of PROD-024
complete: queued cancellation and the lifecycle coverage below remain open.

The frontend test file now covers token-header construction, view resolution,
out-of-order request rejection, old-scope rejection and timer shutdown after a
view change. It still does not prove all startup, auth-refresh, browser suspension,
terminal rendering or accessibility behavior below.

## Four prioritized open work items

| ID / parent | Priority / state | Non-destructive test definition | Acceptance and evidence |
| --- | --- | --- | --- |
| BG-CANCEL-01 / PROD-024 | P1 / Open; cancellation capability not assumed | In an in-memory queue/transaction fixture, race queued cancellation against worker claim in both orders; repeat same cancellation; test already processing, completed, failed and unknown jobs. Include unauthorized tenant/owner/twin requests. | Atomic winner: cancellation-first prevents worker start; claim-first returns not-cancelled/already-running without claiming work stopped. Repeated cancel is idempotent; no duplicate enqueue, worker run or terminal overwrite. Existing processing job remains untouched. Preserve current API until an explicitly reviewed cancellation contract exists. Evidence: deterministic scheduler/transaction log and exact call counts, no live cancel. |
| BG-SLO-01 / PROD-018 + PROD-021 | P1 / Open | Feed synthetic timestamped route records into the metrics evaluator: cold/warm, queue delay, completed, failed, timeout, missing timestamps and low volume; replay identical windows for drift comparison. | Separate enqueue-to-claim queue age, claim-to-terminal execution, and submit-to-visible-answer duration. Rolling p50/p90 by route show sample count/window and incomplete/failure counts. Never add overlapping child durations or omit unfinished oldest queued work. Missing/low-volume data means insufficient evidence. Queue-age warning thresholds must be configured and tested at below/equal/above boundaries; this review does not invent a production threshold or claim SLO compliance. |
| BG-SESSION-01 / PROD-021 | P1 / Open; authenticated Nightly coverage gap | Define a dedicated least-privilege test identity/session lifecycle; use local browser auth fixtures for valid/expired/revoked/refresh-denied sessions and account switching. Later live Nightly assertions are GET/UI-only and require an approved session. | No state file, tokens or authenticated screenshots in repository/artifacts. Expiry yields blocked-authentication with actionable recovery, never a green UI pass. No silent real-user session reuse, bypass, interactive-login loop or mutation. Repeated Nightly starts are isolated and cannot inherit another principal's cached job list. Record revision and safe test outcome only. |
| BG-LEARN-01 / PROD-021 + PERF-07 | P1 / Open regression gate | Synthetic execution-history fixtures: HTTP 200/202 with no canonical run, stale run, wrong workflow/parent/session, reused run, failed/running canonical run, and a correctly correlated fresh success. | Only fresh canonical completion with expected workflow, parent and Actor-session correlation and required review-needed outcome passes. Accepted dispatch is pending, not success; absence at bounded deadline fails. Late success cannot erase prior deadline breach. Dispatch/canonical latency and user-answer independence remain separate assertions. Never query or create real Learning work in this test-definition task. |

## Additional lifecycle regression matrix

Use fake clocks, controllable promises, isolated DOM/Playwright fixtures and fake
authenticated responses. Tests must call the real startup/navigation/polling code,
not only manually set the final DOM state. Expected wire statuses come from the
current contract; future cancellation states are conditional on that contract.

| ID | Priority | Setup / transition | Expected result |
| --- | --- | --- | --- |
| BG-LIFE-01 | P1 | Authenticated direct chat startup, no body marker, queued then processing then completed responses. | Initial GET and polling start without a click; Ready renders within one active poll interval plus controlled request/render time. Exactly one timer chain; no enqueue or chat send. |
| BG-LIFE-02 | P2 | Explicit non-chat marker conflicts with stale chat navigation; then nav-only, visible-view-only and missing-all states. | Explicit marker wins; defined fallback order remains stable. Non-chat startup does not start chat polling. Missing-all behavior is intentional and tested rather than silently counted as visible chat. |
| BG-LIFE-03 | P1 | Chat -> Graph while poll pending; resolve response; return Chat repeatedly. | Old callback cannot resurrect a timer chain outside Chat. Return performs fresh GET and one timer only. Test rapid switches and repeated initialization. |
| BG-LIFE-04 | P1 | Poll A slow, refresh B newer; deliver B completed before A queued. | Stale result cannot regress Ready to Queued; at most one active polling request or explicit stale-response rejection. Test independent manual refresh and navigation refresh too. |
| BG-LIFE-05 | P1 | Switch twin/account or sign out while old request is pending; deliver old response afterward. | Old-scope jobs never render in new scope or after logout; cached jobs clear/invalidate and pending callback cannot repopulate them. No backend permission change required. |
| BG-LIFE-06 | P1 | GET status -> 401 -> successful token refresh -> successful GET; repeat with failed refresh/second 401. | One bounded auth recovery per attempt; new scoped headers used; no enqueue/replay. Failed renewal gives auth-required/stale status, no Ready claim and no tight refresh loop. |
| BG-LIFE-07 | P1 | Network loss, 429/5xx, malformed payload or rejected poll promise; recover later. | No unhandled rejection; bounded retry cadence with no overlapping polls. Preserve last-known job only as stale, never interpret unknown response as success. Recovery resynchronizes once. |
| BG-LIFE-08 | P1 | queued -> processing -> completed, queued -> completed between polls, processing -> failed, duplicate terminal response, uncertain timeout. | Correct Ready/Failed labels and result visibility; no automatic resubmit/retry of uncertain work, no success telemetry for failed/unknown work. Repeated terminal responses are idempotent. |
| BG-LIFE-09 | P2 | Completed-only and empty lists; subsequently new queued job. | Current 3-second active / 15-second idle schedule transitions correctly. Terminal jobs stop being treated as active, while idle discovery remains possible; no requirement to stop all polling permanently. |
| BG-LIFE-10 | P2 | Hidden tab, browser suspend/resume, offline/online and history back/forward. | Resume resynchronizes without accumulated catch-up requests or duplicate timer chains; stale state is not presented as fresh. Do not assume background timers meet foreground latency budgets. |
| BG-LIFE-11 | P2 | Keyboard focus inside job details during repeated same-state polls and a terminal update. | Focus/expanded state retained where practical; terminal change announced once, not every 3 seconds; no content overlap/layout jump. |
| BG-LIFE-12 | P2 | More than three jobs with an older active job outside the visible limit. | Define whether this is a latest-three summary or complete work list. Do not claim all work complete from a truncated list; ensure a documented discoverability path for hidden active jobs. |

## Source-review follow-up, not reproduced production defects

The source review found that `refreshActorBackgroundWork()` previously assigned
each arriving response directly to shared state and the timer could schedule again
after the user left Chat. The implementation now rejects stale request generations
and old tenant/user/twin scopes, and rechecks the active view before rescheduling.
Controlled promise/timer tests validate BG-LIFE-03/04/05 without a live request.
No corresponding production data leak or status regression was observed.

## Evidence discipline and next execution order

1. Add deterministic cancellation/correlation fixtures and the remaining polling lifecycle tests.
2. Run them locally without external network calls; record exact revision/results.
3. Implement only separately accepted fixes and rerun the failing fixtures.
4. Plan authenticated read-only Nightly UI assertions after session provisioning.

BG-LIFE-03/04/05 are **implemented and passing**; the other newly listed cases
remain defined but not executed. The current aggregate is 18 passing Background
Job tests. Existing cancellation, SLO, authenticated Nightly, KG isolation,
revocation, recovery and Learning evidence gaps remain unchanged.
