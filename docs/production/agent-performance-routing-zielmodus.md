# Agent Performance Routing Zielmodus

## Objective

Reduce perceived and measured Actor Twin latency by replacing opportunistic
agent chaining with a portable, deterministic routing contract. The same
contract must work in n8n now and in Azure-hosted code later.

## Challenged Interaction Model

The former model allowed Actor Twin, Butler, Skill Orchestrator, Critical
Faculty, and Learning to become one synchronous chain. Prompt guidance alone
could not prevent unnecessary calls, and a successful webhook acknowledgement
could be mistaken for a completed Learning execution.

The hardened model separates four concerns:

1. Classification is deterministic and occurs before generative reasoning.
2. Retrieval, work execution, critique, and learning have separate gates.
3. User-response work is bounded; post-turn learning is detached.
4. Every handoff carries a portable contract instead of n8n-specific meaning.

## Agent Call Rules

### Actor Twin

- Answers greetings, navigation, capability explanations, and generic
  low-risk questions directly.
- Retrieves through Knowledge Fabric before claims about the active twin,
  people, organizations, prior work, decisions, preferences, or cited sources.
- Calls Knowledge Fabric with `stage` only for explicit save/remember/ingest
  intent.
- Calls Butler once for work. A single no-write artifact stays in Butler.
- Uses Knowledge Fabric then Butler only when one turn genuinely combines
  evidence retrieval and artifact creation.
- Calls Critical Faculty only when the routing risk gate is true or a material
  contradiction is returned.
- Never calls Learning synchronously. Post-answer trace persistence dispatches
  Learning and requires source-trace-to-execution correlation.

### Knowledge Fabric

- Owns reviewed-evidence retrieval and governed review-needed staging.
- Returns `not_found` plus one targeted question when scoped evidence is absent.
- Does not call Butler, Skill Orchestrator, or Task Agent.
- Does not promote or refresh trusted stores in the answering turn.

### Agentic Butler

- Produces one-step no-write drafts directly.
- Calls Skill Orchestrator once only for true multi-step execution.
- Calls the Knowledge Retrieval Interviewer only for tacit elicitation.
- Calls Critical Faculty only when the supplied risk gate is true or new
  contradictions emerge.
- Never calls Learning in the response path.

### Skill Orchestrator and Task Agent

- Skill Orchestrator receives one bounded objective and an explicit worker
  budget.
- Default worker budget is one; two is the maximum for the current production
  contract.
- Task Agent executes one narrow step and cannot recursively delegate.
- Timeout or incomplete output returns a bounded partial result and recovery
  action instead of another agent call.

### Critical Faculty

- Runs only for high-impact ambiguity, contradictory evidence, approval
  boundary uncertainty, or decision-shaping recommendations.
- Returns critique to its caller; it does not execute, persist, approve, or
  start Learning.

### Learning Agent

- Runs after the Actor answer from a trace-triggered path.
- A 200/202 dispatch is only an acknowledgement. Success requires a fresh
  canonical Learning execution correlated to the source trace and a
  review-needed Knowledge Fabric result.

## Preferred Implementation Order

1. Version and test the routing contract.
2. Insert deterministic classification before Actor Twin.
3. Remove Learning from Actor Twin's synchronous tool set.
4. Propagate routing gates and budgets to Butler and Skill Orchestrator.
5. Enforce conditional Critical Faculty use.
6. Use the existing backend runtime-job queue for approved long-running skill
   runs and expose job progress in the frontend.
7. Add a generic no-write background-work entrypoint before enabling
   `execute_work_async` for arbitrary chat work.
8. Correlate Learning dispatch, canonical execution, and staged result.
9. Measure route-specific p50/p90 and timeout/fallback rates.
10. Publish only after contract, no-write UAT, latency probes, and regression
    suites pass.

## Production Gates

- Direct and clarification routes invoke zero specialist tools.
- Retrieval invokes Knowledge Fabric once and cites reviewed evidence.
- One-step work invokes Butler without Skill Orchestrator.
- Multi-step work respects the Task Agent budget.
- Routine turns never invoke Critical Faculty or Learning inline.
- No external side effect or generated-capability activation bypasses approval.
- Route semantics are identical in n8n and Azure code.
- Background work is not advertised until a durable job ID and status endpoint
  are available for that route.
