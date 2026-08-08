# MeIDs Agent Architecture and n8n Contracts

This document defines the implementation direction for the public MeIDs app and the external agent layer. The frontend stays lean. Agent orchestration, review, graph governance, and production diagnostics live in the cockpit.

## Top-Level Agents

| Agent | Responsibility | Primary UI Surface | n8n Boundary |
| --- | --- | --- | --- |
| Actor Twin | User-facing decision and answer layer. Interprets intent, uses persona plus OKF/vector/graph context, and decides whether the user needs an answer, a skill run, or a human approval step. | Assistant Workspace / Chat | `actor-twin.chat` |
| Knowledge Fabric Agent | Maintains the compound knowledge fabric. Ingests source material, creates and updates OKF Markdown/YAML concepts, handles CRUD, refreshes retrieval indexes, and triggers graph curation. | Source Upload, Knowledge, Graph, Review Cockpit | `knowledge-fabric.ingest`, `knowledge-fabric.curate`, `knowledge-fabric.sync` |
| Agentic Butler | Executes work. Activates approved skills, runs the internal Skill Orchestrator, coordinates task agents, stores traces, and requests approval before risky actions. | Activate Skill, Skills, Traces, Production Cockpit | `agentic-butler.run-skill`, `agentic-butler.review-run` |

## Internal Components

| Component | Parent | Purpose |
| --- | --- | --- |
| Skill Orchestrator | Agentic Butler | Internal execution planner for one approved skill. It sequences task agents and asks the Actor Twin at decision checkpoints. |
| Task Agents | Skill Orchestrator | Narrow workers with bounded instructions, tools, and output contracts. |
| Persona Modeler | Knowledge Fabric Agent | Converts human input, voice transcripts, and reviewed outputs into persona-relevant memory. |
| Graph Curator | Knowledge Fabric Agent | Creates, reviews, and promotes graph nodes/edges from approved concepts and selected drafts. |
| Critic / Outcome Reviewer | Agentic Butler | Reviews traces and human feedback, then proposes skill or instruction refinements for approval. |

## Recommended Interaction Flow

1. User asks something in the Assistant Workspace.
2. Actor Twin interprets intent.
3. If answer-only, Actor Twin retrieves context from OKF, vector cache, and knowledge graph.
4. If work execution is needed, Actor Twin asks Agentic Butler to activate an approved skill.
5. Agentic Butler invokes its internal Skill Orchestrator.
6. Skill Orchestrator coordinates task agents and asks Actor Twin at decision checkpoints.
7. Before risky actions, the run stops for human approval.
8. Output is stored as a trace.
9. Critic reviews outcome and proposes refinements when needed.
10. Knowledge Fabric Agent may convert validated output into OKF concepts.
11. Graph Curator updates graph relations.
12. Retrieval indexes refresh from approved concepts and explicitly selected pending knowledge.

## Webhook Contract Pattern

Public-safe fixture files now exist for the three top-level agent boundaries:

| Agent | Fixture |
| --- | --- |
| Actor Twin | `contracts/n8n/fixtures/actor-twin.json` |
| Knowledge Fabric Agent | `contracts/n8n/fixtures/knowledge-fabric-agent.json` |
| Agentic Butler | `contracts/n8n/fixtures/agentic-butler.json` |

Validate fixture structure locally with:

```powershell
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\validate-n8n-fixtures.cjs
```

Replay the fixture cases and refresh the cockpit readiness artifact with:

```powershell
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\replay-n8n-fixtures.cjs --write
```

The generated public artifact is `frontend/assets/n8n-contract-replay-status.json`. It contains pass/fail readiness, case counts, and fixture references only; no webhook URLs or secrets.

Every n8n endpoint should accept the same envelope:

```json
{
  "trace_id": "trace_20260807_001",
  "tenant": "local",
  "twin_id": "florian",
  "agent": "actor-twin",
  "intent": "answer|run_skill|ingest|curate|review",
  "risk_posture": "careful|balanced|bold",
  "input": {},
  "context": {
    "okf_refs": [],
    "graph_refs": [],
    "skill_refs": []
  },
  "approval": {
    "required": false,
    "reason": ""
  }
}
```

Every n8n endpoint should return:

```json
{
  "trace_id": "trace_20260807_001",
  "status": "completed|needs_approval|needs_input|failed",
  "agent": "actor-twin",
  "summary": "",
  "output": {},
  "citations": [],
  "follow_ups": [],
  "approval_request": null,
  "error": null
}
```

## Approval Gates

Human approval is required for:

- Sending external emails.
- Scheduling or changing meetings.
- Publishing or promoting a skill version.
- Promoting high-risk knowledge into approved memory.
- Applying instruction refinements.
- Triggering tools with external side effects.

## Frontend Implications

- Assistant Workspace exposes only the core interaction surface.
- Source Upload is for capture, not review.
- Knowledge, Review, Graph, Traces, Skills, and Production are cockpit views.
- Skill Orchestrator is not shown as a top-level agent. It is described as an internal Agentic Butler component.
- n8n configuration remains runtime-config driven; secrets must never be committed.
