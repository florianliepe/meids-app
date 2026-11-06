# Me.IDs Agent Interaction Performance: Zielmode

## Objective

Reduce real and perceived Actor Twin response delay while preserving grounding,
review states, approval gates, traceability, user isolation, and the existing
frontend, backend, n8n, and agent contracts.

## Baseline

The latest no-write evidence separates two latency classes:

- Direct Actor Twin and knowledge-retrieval turns complete in about 9 seconds.
- Critical Faculty takes about 34 seconds in a representative live route.
- Butler plus Skill Orchestrator plus Task Agent takes about 43 seconds in a
  representative live route.
- The latest 10-sample audit shows p90 values of 41.7 seconds for Actor Twin,
  51.2 seconds for Butler, and 60.9 seconds for Skill Orchestrator.
- Knowledge Fabric is not the primary bottleneck: its audited p90 is about 2.0
  seconds.

## Target Instructions

1. Preserve direct answering for low-risk, already-grounded requests.
2. Use only the minimum required workflow tools for each turn.
3. Keep routine Learning Agent work detached from the user-facing response.
4. Default Skill Orchestrator to one Task Agent call.
5. Do not add Critical Faculty to routine drafting, formatting, identity, status,
   or simple knowledge-retrieval turns.
6. Apply routing budgets: 10 seconds direct, 25 seconds one-tool knowledge,
   30 seconds one-step Butler, and 60 seconds nested work.
7. When a nested route reaches its budget, return completed useful work and an
   explicit pending or recovery status instead of launching optional work.
8. Show immediate, truthful progress in the frontend without exposing internal
   chain-of-thought or pretending to know the exact current n8n node.
9. Store only bounded anonymous latency samples in the browser. Never store
   prompt or response content in performance telemetry.
10. Roll prompt-budget changes into live n8n only through a controlled workflow
    update and fresh seven-agent no-write probes.

## Frontend Experience

- 0-4 seconds: Understanding your request.
- 5-14 seconds: Checking reviewed knowledge.
- 15-29 seconds: Coordinating the right specialist.
- 30-59 seconds: Completing a deeper workflow.
- 60 seconds and later: Still working; no need to resubmit.

The stages communicate expected effort, not actual internal n8n node state.
They do not change the request, replay it, or create a second execution.

## Safety Gates

- No API or payload change.
- No production data mutation.
- No approval or grounding relaxation.
- No automatic live n8n prompt update.
- No production deployment without controlled UAT approval.
- Existing duplicate-submission and expired-auth protections stay active.

## Decision Log

- Use progress stages instead of a spinner because users need reassurance during
  10-60 second workflows, but should not receive fabricated internal detail.
- Keep latency samples local and content-free because user prompts can contain
  sensitive personal or organizational knowledge.
- Optimize routing before changing models because current evidence points to
  avoidable nested calls as the dominant delay.
- Keep Knowledge Fabric unchanged because its measured runtime is already low.
