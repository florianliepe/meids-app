# Target Mode: Actor Twin and Agentic Butler Autonomy Boundary

## Goal
Remove blocking approval gates from normal Actor Twin interaction. Actor Twin should orchestrate Knowledge Fabric Agent and Agentic Butler without interrupting the user unless a new skill or generated agent design must be approved.

## Governance Rule
- Actor Twin may route, delegate, and synthesize responses autonomously.
- Knowledge Fabric Agent may retrieve, stage, update pending OKF concepts, and return trace evidence autonomously when called by Actor Twin.
- Agentic Butler may activate approved skills and run internal orchestration autonomously when called by Actor Twin.
- Human approval is required only when:
  - Agentic Butler creates a new skill,
  - Agentic Butler creates a new task-agent/subagent design,
  - Agentic Butler activates a generated skill or generated agent version.

## Explicit Non-Gates
The following are no longer approval gates inside the Actor Twin chat flow:
- normal approved-skill activation,
- internal task orchestration,
- retrieval or source-context use,
- email or meeting draft preparation,
- scheduling/mail wording in a planned output,
- Knowledge Fabric ingestion into pending review state.

## Implementation
- Frontend approval normalization only treats `create_skill`, `skill_spec_approval`, or `new_agent_approval` as approval-required.
- Actor Twin n8n normalizer no longer gates delegation on external-write wording.
- Agentic Butler n8n normalizer returns `completed` for normal Actor-delegated work.
- Import-ready n8n JSONs are regenerated for manual workflow import.

## UAT
- `who are you` -> Actor Twin direct answer.
- `plan my day` -> Agentic Butler can complete autonomously.
- `draft an email` -> Agentic Butler can produce a draft autonomously.
- `create a new skill` -> approval required.
- `create a new agent/subagent` -> approval required.
