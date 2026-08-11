# n8n AI Agent Integration Plan

Date: 2026-08-11

Purpose: separate the current MeIDs contract/readiness work from the next step: adding real AI-agent behavior inside the n8n workflows.

## Current Boundary

Zielmodus 4 covers:

- public-safe request and response contracts;
- fixture replay and schema validation;
- runtime URL configuration;
- cockpit readiness indicators;
- live probe evidence once n8n returns contract-compliant responses.

It does **not** by itself implement the internal AI Agent nodes, tool wiring, memory, graph calls, or skill orchestration logic inside n8n. Those are the next implementation package.

Current n8n state:

| Agent | Current workflow behavior | Live probe blocker |
| --- | --- | --- |
| Actor Twin | Existing external chat workflow returns an execution error for the current probe. | Debug workflow and return `completed` with trace id. |
| Knowledge Fabric Agent | Staging webhook returns `staging_ready`. | Add AI-agent ingest logic and return `completed` with trace id. |
| Agentic Butler | Staging webhook returns `staging_ready`. | Add skill orchestration / approval logic and return `approval_required` for risky probes. |

Latest direct probe observation:

| Agent | URL state | Observed response | Evidence status |
| --- | --- | --- | --- |
| Actor Twin | Configured | HTTP 500 workflow error | Cannot record final evidence. |
| Knowledge Fabric Agent | Configured and reachable | HTTP 200, `status: staging_ready` | Reachability proven, final evidence blocked by missing AI-agent contract response and trace id. |
| Agentic Butler | Configured and reachable | HTTP 200, `status: staging_ready` | Reachability proven, final evidence blocked by missing approval-gate response and trace id. |

## Required n8n Workflow Upgrades

### 1. Actor Twin

Role: user-facing decision and answer interface.

Required n8n capabilities:

- accept the MeIDs Actor Twin request envelope;
- retrieve or receive OKF, vector, and graph context;
- call the configured LLM;
- apply persona/actor steering instructions;
- return grounded answer-only responses without side effects;
- write or expose an execution trace id.

Minimum contract-compliant probe response:

```json
{
  "status": "completed",
  "agent_id": "actor_twin",
  "output": {
    "answer": "Public-safe grounded response.",
    "confidence": 0.8,
    "citations": []
  },
  "trace": {
    "stored": true,
    "trace_id": "n8n_exec_<execution_id_or_uuid>"
  }
}
```

### 2. Knowledge Fabric Agent

Role: ingest, structure, and govern OKF knowledge increments.

Required n8n capabilities:

- accept upload, transcript, and concept-ingest envelopes;
- use an AI Agent or LLM node to draft OKF markdown/YAML;
- validate concept metadata and source evidence;
- keep outputs pending until reviewed;
- call or prepare Graph Curator updates for candidate relations;
- optionally hand off to GitHub writeback once repo sync is enabled;
- return trace evidence.

Minimum contract-compliant no-write probe response:

```json
{
  "status": "completed",
  "agent_id": "knowledge_fabric_agent",
  "output": {
    "readiness": "connected",
    "side_effects": "none",
    "capabilities_checked": [
      "webhook_received",
      "okf_draft_supported",
      "pending_review_supported",
      "trace_available"
    ]
  },
  "trace": {
    "stored": true,
    "trace_id": "n8n_exec_<execution_id_or_uuid>"
  }
}
```

### 3. Agentic Butler

Role: orchestrate approved skills and task agents under Actor Twin and human approval gates.

Required n8n capabilities:

- accept skill activation envelopes from Chat;
- look up approved skill definitions or receive the approved skill config;
- call internal skill-orchestrator logic as a subworkflow/component;
- coordinate task-agent steps;
- consult Actor Twin at defined decision checkpoints;
- stop before external or risky actions;
- emit approval requests and store trace evidence.

Minimum contract-compliant approval probe response:

```json
{
  "status": "approval_required",
  "agent_id": "agentic_butler",
  "approval": {
    "required": true,
    "gate": "requires_human_action",
    "summary": "The requested action requires human approval before execution.",
    "proposed_action": "Send email or create meeting."
  },
  "output": {
    "readiness": "connected",
    "side_effects": "none",
    "capabilities_checked": [
      "webhook_received",
      "skill_activation_supported",
      "approval_gate_supported",
      "trace_available"
    ]
  },
  "trace": {
    "stored": true,
    "trace_id": "n8n_exec_<execution_id_or_uuid>"
  }
}
```

## Recommended n8n Architecture

Use three top-level workflows:

1. Actor Twin workflow
2. Knowledge Fabric Agent workflow
3. Agentic Butler workflow

Keep specialist behavior as subworkflows or internal nodes:

- OKF concept drafter
- Source evidence validator
- Graph Curator
- Skill Orchestrator
- Task agents
- Critic / refinement proposer

Reason: the UI and contract layer stays simple with three public agent endpoints, while n8n can evolve internal subagents without changing the frontend route model.

## Completion Criteria

The live integration can be considered complete only when:

- all three workflows include their intended AI-agent logic;
- all three workflows return contract-compliant JSON;
- all three responses include non-placeholder trace ids;
- Agentic Butler returns `approval_required` for risky actions;
- the app records live probe evidence with `scripts/record-n8n-live-probe-evidence.cjs`;
- `node scripts/validate-zielmodus-4-readiness.cjs --require-live-probes` passes;
- GitHub Pages deploy succeeds after evidence artifacts are committed.
