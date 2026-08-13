# Target Mode: Autonomous Delegation UAT Fixes

## Goal
Fix the current UAT regression where simple Actor Twin questions are routed to Agentic Butler, while keeping the chat surface lean and preserving human approval only where it is actually required.

## Decisions
- Actor Twin is the primary route authority.
- Knowledge Fabric Agent and Agentic Butler can be triggered autonomously by Actor Twin.
- Delegation to Knowledge Fabric Agent or Agentic Butler is trace evidence, not an approval event.
- Human approval is required only for:
  - new skill creation or new skill version activation,
  - creation/integration of new task agents,
  - external write actions such as sending mail, scheduling meetings, publishing, committing, deleting, or making commitments.
- Actor Twin chat must show user-facing answer/result cards only. Route diagnostics, contract health, approval queues, and raw payloads belong in Review/Traces/Production cockpit views.

## Implementation Scope
1. Keep identity and purpose queries as `answer_direct`.
2. Reconcile known n8n route-mismatch responses back to `answer_direct`.
3. Patch Actor Twin n8n workflow blueprints so Actor AI route decisions override wrapper/context fallback routes.
4. Patch Agentic Butler workflow blueprints so normal internal delegated work returns `completed`, not `approval_required`.
5. Suppress internal route and contract diagnostics from Actor Twin chat cards.
6. Add regression checks to `check:agents`.

## UAT Retest
- `who are you` returns a direct Actor Twin answer, no Butler handoff, no approval card.
- `what is your purpose` returns a direct Actor Twin answer, no Butler handoff, no approval card.
- `plan my day` with an approved skill delegates to Agentic Butler and returns a completed trace, not an approval gate.
- `create a new skill for ...` returns an approval-required skill draft boundary.
- `send an email` or `schedule a meeting` returns an approval-required external-write boundary.

## Remaining Live Step
Import and publish the updated n8n workflow JSONs before live UAT can reflect the fixed routing and approval behavior.
