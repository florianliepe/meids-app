# Actor-led skill and task-agent definition

## Decision

The Actor Twin is the only user-facing entry point for creating a capability.
The Actor owns the conversation and decides whether the request is a direct
answer, knowledge retrieval, an approved skill run, or a request for a new
reusable capability. For the last case it calls Agentic Butler as a bounded
manager tool.

Agentic Butler may propose a SkillSpec and one or more task-agent definitions.
It does not activate them. The backend stores the proposal as
`pending_approval`, tied to tenant, user, twin, request, and trace. Human
approval remains mandatory before the existing executor contract can use it.

```mermaid
sequenceDiagram
  actor User
  participant Actor as Actor Twin
  participant Butler as Agentic Butler
  participant Registry as Skill Registry
  participant Reviewer as Human reviewer
  participant Executor as Existing executor adapter

  User->>Actor: Describe a recurring capability
  Actor->>Actor: Classify direct answer vs knowledge vs work vs new skill
  Actor->>Butler: create_skill with scoped context
  Butler->>Butler: Draft SkillSpec and bounded task-agent configs
  Butler->>Registry: Store idempotent pending proposal
  Registry-->>Actor: Proposal ID and approval state
  Actor-->>User: Proposal created, approval required
  Reviewer->>Registry: Approve or reject version
  Registry->>Executor: Expose approved version only
  Executor-->>Actor: Structured run result and trace
  Actor-->>User: Final response
```

## Interaction rules

1. Actor answers directly when no private retrieval, reusable work behavior,
   specialist security boundary, or external side effect is required.
2. Actor calls Knowledge Fabric for evidence retrieval or governed knowledge
   intake. Knowledge Fabric never defines or activates a skill.
3. Actor calls Agentic Butler for reusable work behavior, an approved skill
   run, or a new capability proposal. Butler remains behind Actor; it does not
   take over the user conversation.
4. Butler uses one task agent directly for a single bounded task. It introduces
   multiple task agents only when tools, security boundaries, or evaluation
   criteria are genuinely distinct.
5. Every task agent has a purpose, structured inputs and outputs, an allowlist
   of tools, a system instruction, an execution boundary, and a maximum step
   budget. Runtime authorization is checked again for each tool call.
6. Generated and revised definitions are inactive until human approval.
   Approval never follows automatically from lint, simulation, or a successful
   test run.
7. Retirement is reversible and audit-preserving. It blocks new runs without
   deleting versions, traces, approvals, or ownership evidence.
8. The legacy elicit, decompose, approval, archive, and run endpoints remain as
   compatibility adapters until all production callers use the new contract.

## Challenger questions and resolutions

### Why not let Actor create database records directly?

Actor owns intent and user dialogue, not lifecycle policy. Butler produces the
normalized proposal and the backend enforces identity scope, idempotency,
versioning, and approval. This keeps model output outside the trust boundary.

### Why not let every new capability become a new autonomous agent?

Most work needs a single agent with bounded tools. Extra agents add latency,
cost, handoff ambiguity, and distributed failure modes. A task agent is created
only when specialization or a security/tool boundary justifies it.

### Can a task agent create another task agent?

No. It can return a capability-gap proposal to Butler. Only Butler may draft a
new definition, and only the registry plus a human approval can activate it.
This prevents recursive agent proliferation and privilege expansion.

### Does approval of a skill authorize all later actions?

No. Skill approval authorizes the definition. Resource-level authorization,
external writes, irreversible actions, and new capabilities remain separately
gated at execution time.

### What happens when an approved skill is edited?

The backend snapshots the prior version, increments the patch version, and
moves the edited version to `pending_approval`. The approved runtime boundary
is not silently widened.

### What does delete mean?

The UI says `Retire`. The backend marks the skill archived, records who retired
it and why, and preserves its revision history. Permanent purge is outside the
ordinary user workflow.

### How is rollout kept safe?

The existing executor and API routes remain in place. The new proposal, update,
and retirement routes are additive. Contract checks verify that old routes are
still present while the old authoring form is absent from the frontend.

## Frontend contract

- Actor Twin chat is the only creation surface.
- Skills shows approved, pending, rejected, and retired capabilities.
- Selecting a skill reveals its purpose, task agent, tool allowlist, instruction,
  boundary, version, and origin.
- Saving a change requires a reason and creates a pending version.
- Retiring requires a reason and preserves audit evidence.
- Skill execution stays Actor-led; the registry page does not duplicate the chat
  composer or the run workflow.

## Basis

This uses the manager pattern because Actor must retain the final answer and
shared guardrails while Butler performs a bounded subtask. It also applies the
lowest-complexity rule: use a single agent with tools unless specialization or a
security boundary justifies multi-agent orchestration.

- [OpenAI Agents SDK: agent orchestration](https://openai.github.io/openai-agents-js/guides/multi-agent/)
- [OpenAI Agents SDK: tool guardrails and approvals](https://openai.github.io/openai-agents-js/guides/guardrails/)
- [Azure Architecture Center: AI agent orchestration patterns](https://learn.microsoft.com/azure/architecture/ai-ml/guide/ai-agent-design-patterns/)
