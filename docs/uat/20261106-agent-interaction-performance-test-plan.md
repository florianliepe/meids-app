# Agent Interaction Performance UAT

## Test Scenarios

| ID | Scenario | Expected route | Performance gate | Answer-quality gate |
| --- | --- | --- | --- | --- |
| PERF-01 | Greeting, identity, or status | Actor Twin direct | target under 10s | no unnecessary tool call |
| PERF-02 | Retrieve one reviewed fact | Knowledge Fabric | target under 25s | cites reviewed evidence |
| PERF-03 | Ask for an unknown personal fact | Actor Twin or Knowledge Fabric | target under 25s | `not_found`, no speculation, one targeted question |
| PERF-04 | One-step internal draft | Agentic Butler | target under 30s | no Skill Orchestrator call |
| PERF-05 | Approved multi-step skill | Butler, Skill Orchestrator, one Task Agent | target under 60s | grounded output and trace |
| PERF-06 | Material decision critique | Critical Faculty only when risk criteria apply | target under 35s | three prioritized findings and clear recommendation |
| PERF-07 | Normal trace learning | detached Learning Agent | dispatch under 2s; canonical run under 60s | does not delay answer; output remains `review_needed` |
| PERF-08 | Expired chat authentication | reconnect without replay | feedback within 2s of detection | no duplicate execution |
| PERF-09 | Double submit while busy | existing frontend guard | second submit blocked | one workflow execution only |
| PERF-10 | Long route feedback | staged frontend status | first feedback immediate; no layout shift | no fabricated node status |

## Viewport And Accessibility Checks

- 390, 1024, and 1440 pixels in light and dark mode.
- Keyboard-only submit and focus visibility.
- Screen reader announces busy and ready states without repeated chatter.
- Reduced-motion mode has no animated progress dependency.
- Progress copy does not overlap the composer or docked Talk/Add source controls.

## Measurement contract and SLO decision (review 2026-11-06)

Treat 10/25/30/60 seconds as provisional route-specific p90 budgets. Define the
SLI as the proportion of eligible turns producing a correct, complete visible
answer strictly below the route budget. Report numerator and denominator as well
as p50/p90/p95, failure, cancellation and timeout counts. Fast errors are not good
turns. Timeouts must not disappear because they lack a completion timestamp.
Keep raw component timings separate: nested parent/child durations overlap and
cannot be added to infer the critical path. The ten-execution agent audit is
diagnostic evidence, not route-specific SLO acceptance or proof of causation.

Recommended initial reporting window: rolling seven days, with at least 100
eligible samples per route before declaring a p90 target met. This is an initial
operational convention, not a statistical guarantee; below that threshold report
insufficient evidence, sample counts and observed breaches. Always retain every
deterministic correctness failure as a release blocker regardless of percentile.
Do not create production load merely to fill a sample quota. Use approved synthetic
fixtures and representative concurrency in nonproduction for load testing.

Start the end-to-end clock at accepted user submission and stop at the complete,
visible usable answer, including network, queue and render time. Use a monotonic
clock within the browser. Record acknowledgment and first useful content separately;
typing-indicator lifetime and first token are not complete-answer latency. Separate
cold/warm starts, direct/knowledge/draft/skill routes and error outcomes. Do not
interpret the latest 20 browser samples as a service-wide p90.

## Detailed executable acceptance scenarios

All prompts, identities and source records are synthetic and approved. Save only
redacted route/count/timing/outcome evidence in shared reports. Correlate executions
in the restricted test harness, not in user-facing local telemetry. Missing trace,
canonical execution or answer verification is blocked, never an inferred pass.

| ID | Additional cases and required assertions |
| --- | --- |
| PERF-01 | Known session identity and already-loaded status, cold and warm connection. Complete correct answer <10s, zero synchronous tool executions, no guessed identity. A request for *live* backend health is a separate tool-requiring route. Slow direct response must not claim retrieval or specialist work. |
| PERF-02 | Known reviewed synthetic fact with one source and conflicting unreviewed distractor. <25s, one required Knowledge Fabric retrieval, source citation resolves to reviewed evidence supporting the claim; zero Butler/Skill/Critical calls without documented risk. Test denied/missing evidence and prevent stale/cross-scope citations. |
| PERF-03 | Unknown fact plus irrelevant retrieved evidence. <25s, explicit not_found, exactly one focused clarification question, no invented fact/citation. Test both direct known-absence and one-retrieval paths; do not force repeated retrieval or specialist fallback. |
| PERF-04 | One-step internal draft from supplied material, <30s. Butler may call one Task Agent if required; zero Skill Orchestrator and routine Critical Faculty calls. Label as draft, preserve grounding and approval gates, no sending/publishing or other side effect. |
| PERF-05 | Known approved multi-step skill that one worker can execute, <60s. Verify approved skill/version, one Skill Orchestrator invocation and one Task Agent logical execution, correct ordered output and trace. Retried transport must not duplicate logical work. Use a separate explicit-exception case for a skill requiring multiple workers; never drop necessary steps to satisfy the default. |
| PERF-06 | Paired low-risk draft and materially consequential recommendation. Routine case: zero synchronous Critical calls. Material risk: recorded reason, one bounded critique before release of the consequential recommendation, supporting evidence and unresolved limitations. If critique times out/fails, withhold the recommendation or mark incomplete; never silently bypass. Include conflicting authoritative evidence and an approval-gated external action; critique never replaces human approval. |
| PERF-07 | Measure answer availability independently from Learning. Dispatch accepted <2s after answer finalization; canonical Learning run completes <60s from dispatch acceptance, including queueing. Correlate a fresh actual canonical execution, terminal success and review_needed output; 200/202 alone fails. Delay Learning >60s, inject dispatch failure and unavailable worker: answer latency and content remain unaffected, failure visible in restricted operational evidence, retry bounded/idempotent. Detached execution cannot be proven by prompt wording. |
| PERF-08 | Expire auth before submit and during a pending request; reconnect twice. Feedback <=2s from detection; no automatic replay, one control group, retained listeners. No false Answer ready or completed latency on mount clearing. A late response from the previous session cannot overwrite current state. Explicit user resubmission is a new intent; log neither credentials nor content. |
| PERF-09 | Double click, Enter+click, held Enter, rapid taps before typing indicator appears, slow network, error and reconnect. Exactly one accepted logical request and canonical execution per intent, count all nested/retried attempts. Input-only disabled state is insufficient evidence; verify Send and keyboard paths. After terminal failure the user can intentionally retry. |
| PERF-10 | First neutral acknowledgment <=100ms from accepted submit on an idle test device; sample at 0/5/15/30/60s with a controlled clock. No tool/phase claims without actual events. Long-route text stays readable without moving composer/input (<=1 CSS px) or obscuring Talk/Source/Send; capture layout-shift entries including recent input. Screen-reader updates announce meaningful stage changes, not every elapsed second; reduced motion, 320/390/1024/1440 widths, dark/light, zoom and virtual keyboard. Verify success/error/cancel/reconnect labels and timer cleanup. |

## Work beyond 60 seconds

Prefer background completion only where an existing durable job contract supports
job identity, status, scoped retrieval, idempotency and cancellation. An in-memory
browser timer or an HTTP 202 alone is not background delivery. Acknowledge pending
work by the deadline and measure eventual completion separately; do not classify
pending/partial output as a successful complete answer under the 60s SLO.

If background completion is unavailable, return only genuinely completed, grounded
partial work with explicit missing steps and recovery guidance. For consequential
recommendations awaiting critique, return status rather than an unchecked decision.
Do not claim a notification or cancellation succeeded unless that mechanism exists.
Crossing the threshold must not launch a second workflow. This review does not
authorize a new job API, notification system or live n8n contract change.

## Synchronous Critical Faculty boundary

Require synchronous critique when the requested output makes a material decision
with significant consequences, resolves conflicting authoritative evidence, or a
documented skill/risk policy requires it before release. Identity/status, supported
fact retrieval, formatting and routine internal drafts do not need it by default.
High-stakes labels alone do not justify critiquing a harmless quoted fact; conversely,
calling an output a draft does not remove risk if it contains a consequential recommendation.
Human approval and access enforcement remain independent and mandatory where applicable.

## Telemetry governance

Admin Cockpit aggregation is a reasonable later step after explicit governance
approval. Current timestamp/duration/outcome records are content-free local data,
not proven anonymous: timestamps can be correlated and browser storage may be shared.
Specify purpose, retention/TTL, deletion and sign-out/account-switch behavior first.
Future aggregates should use low-cardinality route/outcome buckets and coarse time
windows, restricted access, minimum cohort sizes and a documented denominator.
Exclude prompts, responses, identities, twin/source IDs, token/session values and
raw trace IDs. No collection/export is enabled by this test-plan change.

## Adversarial test results against b0c103b

Run `node --test scripts/test-agent-performance-ui.cjs` with Playwright available.
This extracts the actual busy-guard function into an isolated Chromium fixture;
it sends no live requests. Five behavior checks: two passed and three failed on
2026-11-06. Typing onset disables the textarea and announces progress; storage
caps at 20 records with only timestamp/duration/outcome fields. Failures:

1. Error removing typing reports Answer ready and outcome completed.
2. Reconnect clearing the mount also records completed without an answer.
3. Elapsed time alone claims knowledge retrieval/specialist work.

These failing acceptance tests are intentionally retained for the implementation
owner to make green. They do not measure live route SLOs, server deduplication,
actual n8n error DOM, or post-turn Learning. The existing 16 string safeguards
remain static checks and are not a substitute for these behaviors or live evidence.

## Sources and interpretation

- [Google SRE: Implementing SLOs](https://sre.google/workbook/implementing-slos/)
  supports user-centric latency indicators and explicit request-based objectives.
- [OpenTelemetry: GenAI observability](https://opentelemetry.io/blog/2026/genai-observability/)
  distinguishes model/tool operation measurements useful for critical-path analysis.

The numerical thresholds, seven-day window and 100-sample minimum above are review
recommendations for this application, not mandates from these sources.

## Original review questions (resolved by recommendations above)

1. Are the 10/25/30/60-second targets suitable as UAT budgets or should they be
   error budgets measured at p90?
2. At 60 seconds, should the product return a partial answer immediately, or
   offer a background completion notification?
3. Which scenarios genuinely need Critical Faculty in the synchronous path?
4. Can the Skill Orchestrator contract guarantee one Task Agent by default for
   normal approved skills?
5. Should local anonymous latency samples be surfaced in Admin Cockpit only
   after explicit telemetry governance approval?

## Pass Criteria

- No contract or network-payload regression.
- No loss of citations, approval gates, or review states.
- Direct and knowledge turns do not invoke Butler or Critical Faculty without a
  routing reason.
- The frontend gives immediate status and prevents duplicate submission.
- A 200/202 Learning dispatch without a fresh canonical execution remains a
  failure.
