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

## Issue-Tracking Review Questions

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
