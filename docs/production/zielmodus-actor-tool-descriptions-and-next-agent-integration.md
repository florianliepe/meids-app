# Zielmodus: Actor Tool Descriptions and Next Agent Integration

## Purpose

Make the Actor Twin more reliable as the n8n routing authority by sharpening its workflow-tool descriptions and defining the next integration pattern for Knowledge Fabric retrieval and Agentic Butler task-agent execution.

## Current Decision

Use the embedded n8n Actor Twin chat as the user-facing interface.

Inside n8n:

- Actor Twin stays the router and final answer owner.
- Knowledge Fabric Agent owns knowledge retrieval, ingest, OKF staging, evidence, graph hints, and vector-boundary handling.
- Agentic Butler owns work artifacts, approved skill execution, skill proposals, and task-agent orchestration.
- Specialist retrieval workers and task agents are internal workflow tools of Knowledge Fabric or Agentic Butler, not first-class user-facing agents.

## Tool Description: Knowledge Fabric Agent

Use this text in the Actor Twin `Call n8n Workflow Tool` description for Knowledge Fabric:

```text
Call this tool when the user asks to retrieve, inspect, add, update, stage, or structure knowledge for the active twin. Use it for OKF concepts, source notes, uploaded material, transcripts, evidence records, review-needed knowledge, graph hints, vector-search context, duplicate checks, and "what do we know about..." questions that require grounded memory.

Do not call this tool for ordinary identity questions, direct explanations that do not need stored knowledge, or work artifacts such as emails, plans, briefs, and agendas. New or changed knowledge may be created automatically, but it must remain review_needed, updated, or candidate until reviewed. This tool must not promote concepts, approve graph edges, or execute external side effects.
```

Routing triggers:

- `what do we know`
- `find in OKF`
- `search knowledge`
- `show evidence`
- `use vector cache`
- `use graph context`
- `remember this`
- `save this as knowledge`
- `stage this`
- `capture this note`
- `ingest this transcript`
- `add/update OKF`
- `source note`
- document or upload knowledge requests

## Tool Description: Agentic Butler

Use this text in the Actor Twin `Call n8n Workflow Tool` description for Agentic Butler:

```text
Call this tool when the user asks the Actor Twin to perform work through a skill, produce a work artifact, run an approved capability, or design a new reusable capability. Use it for email drafts, meeting preparation, agendas, planning, prioritization, summaries, status updates, reusable skill proposals, generated agent/task-agent proposals, and orchestration of approved skills.

Do not call this tool for normal identity questions, knowledge storage/retrieval, or simple explanations that the Actor Twin can answer directly. Do not require human approval for draft-only or no-write work artifacts. Require human approval only before activating a newly generated skill/agent/task-agent/subagent or before a real external side effect such as sending, scheduling, publishing, deleting, or committing.
```

Routing triggers:

- `draft/write/prepare/compose an email`
- `prepare a meeting brief`
- `create an agenda`
- `summarize`
- `prioritize backlog`
- `make a plan`
- `run the approved skill`
- `create/design/build/define/generate a new skill`
- `new agent`
- `new task agent`
- `new subagent`
- `new reusable capability`
- structured tacit-knowledge elicitation, for example `extract my decision principles`, `turn this experience into reusable knowledge`, `interview me`, or `capture my best practices`

## Challenge to the Next Concept

Do not connect every specialist workflow directly to Actor Twin.

Reason:

- Direct exposure makes the Actor Twin tool list noisy and increases wrong-tool selection.
- Specialist tools need domain-specific validation and retry behavior.
- Approval and trace semantics become harder to keep consistent when every worker can be called from the user-facing layer.

Better integration:

- Actor Twin has two stable domain tools: Knowledge Fabric Agent and Agentic Butler.
- Knowledge Fabric Agent has internal tools for vector retrieval, graph expansion, source ingestion, deduplication, and OKF update.
- Agentic Butler has internal tools for Skill Orchestrator and approved task-agent execution.
- Only promote a specialist tool to Actor Twin if it is frequently user-visible, semantically distinct, and cannot be reliably selected through the domain agent.

## Next Integration Pattern

### Knowledge Retrieval Worker

Bind a Knowledge Retrieval workflow to Knowledge Fabric Agent with `Call n8n Workflow Tool`.

Purpose:

- Retrieve approved OKF concepts.
- Search vector cache with tenant/twin/review-state filters.
- Expand selected graph neighbors.
- Ask iterative interview questions only when the user asks to elicit or clarify implicit knowledge.
- Return cited context package to Knowledge Fabric Agent.

Guardrails:

- Default retrieval policy is `approved_only`.
- Pending/candidate knowledge may be returned only with visible draft attribution.
- Retrieval worker must not create or approve knowledge.
- Retrieval worker must not talk directly to the frontend.

Refined build package:

- [Zielmodus: Knowledge Retrieval Interviewer Integration](zielmodus-knowledge-retrieval-interviewer.md)
- [Knowledge Retrieval Interviewer system prompt](../../prompts/knowledge-retrieval-interviewer/system.md)

### Skill Task Agent Worker

Bind task-agent workflows to Agentic Butler with `Call n8n Workflow Tool`.

Purpose:

- Execute a single bounded skill step from an approved skill configuration.
- Respect `skill.config.yaml` input/output schema, allowed tools, risk class, and approval policy.
- Return step result and trace to Agentic Butler.

Guardrails:

- Task agents do not choose user-facing routing.
- Task agents do not approve themselves or activate new capabilities.
- Task agents do not perform external side effects unless Butler passes a recorded approval token.
- Task agents must fail closed when required skill configuration is missing.

## Zielmodus Execution

1. Add Actor Twin tool descriptions to prompt assets.
2. Regenerate Actor Twin import-ready workflow artifacts.
3. Update live n8n Actor Twin tool descriptions manually or through n8n API.
4. Run local gates:
   - `npm run check:agents`
   - `node --check frontend/app.js`
5. Run live UAT:
   - `npm run uat:agents:live`
6. If live UAT still fails:
   - fix Actor Twin tool selector and workflow-tool descriptions first
   - then inspect Knowledge Fabric or Butler subworkflow response normalizers
7. Only after live UAT passes, remove the advisory `continue-on-error: true` for `Validate Chat live n8n UAT artifact`.

## Definition of Done

- Knowledge ingest prompt routes to Knowledge Fabric Agent.
- Knowledge retrieval prompt routes to Knowledge Fabric Agent.
- Email draft routes to Agentic Butler and completes without approval.
- Create-skill prompt routes to Agentic Butler and returns one skill proposal approval.
- Frontend chat shows concise answers/artifacts, not raw JSON.
- n8n execution trace shows which workflow tools were called.
