# Agent Runtime Interaction Contract

Status: implementation direction for GitHub Pages UAT and Azure backend proxy.

## Runtime Roles

- Actor Twin is the only UI-facing agent entry point.
- Knowledge Fabric Agent is called by Actor Twin for retrieval, ingestion, OKF staging, graph candidates, and vector refresh boundaries.
- Agentic Butler is called by Actor Twin for approved skill execution and new skill creation.
- Skill Orchestrator is an internal Agentic Butler component, not a separate top-level runtime agent.

## Actor Route Decision

Every Actor Twin response must include `output.route_decision`, including direct answers.

Required route decisions:

- `answer_direct` -> `actor_twin`, `answer_question`, `handoff_required: false`
- `retrieve_knowledge` -> `knowledge_fabric_agent`, `retrieve_context`
- `ingest_or_stage_knowledge` -> `knowledge_fabric_agent`, `ingest_concept`
- `activate_skill` -> `agentic_butler`, `activate_skill`
- `create_skill` -> `agentic_butler`, `create_skill`, `approval_required: true`
- `request_human_clarification` -> `human`, `clarify_request`, `approval_required: true`

Minimum route payload:

```json
{
  "decision": "activate_skill",
  "target_agent": "agentic_butler",
  "intent": "activate_skill",
  "visible_state": "activating_skill",
  "approval_required": false,
  "handoff_required": true,
  "reason": "Approved skill selected and source context is available."
}
```

## Trace Chain

Each target-agent response must preserve the Actor route context in `trace`:

```json
{
  "trace": {
    "trace_id": "trace_target_123",
    "actor_trace_id": "trace_actor_123",
    "handoff_trace_id": "trace_target_123",
    "target_agent": "agentic_butler",
    "route_decision": "activate_skill",
    "handoff_status": "approval_required",
    "used_agents": ["skill_orchestrator", "actor_twin"],
    "stored": true
  }
}
```

## Approval Resume

When Agentic Butler returns `approval_required`, the frontend creates a local resume envelope but does not execute it. Production execution belongs behind the backend proxy:

- `POST /api/agents/approvals/{approval_id}/resume`
- Backend verifies approver identity, original trace, gate, and target agent.
- Backend calls the secured n8n continuation endpoint or durable workflow runner.
- The resumed output is stored as a child trace.

## Backend Proxy Boundary

GitHub Pages can call public UAT webhooks only. Production must use a backend proxy that owns secrets and CORS.

Recommended endpoints:

- `POST /api/agents/actor-twin/chat`
- `POST /api/agents/knowledge-fabric/ingest`
- `POST /api/agents/agentic-butler/run`
- `POST /api/agents/approvals/{approval_id}/resume`
- `GET /api/agents/traces/{trace_id}`

Required environment variables for Azure backend:

- `N8N_ACTOR_TWIN_WEBHOOK_URL`
- `N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL`
- `N8N_AGENTIC_BUTLER_WEBHOOK_URL`
- `N8N_WEBHOOK_AUTH_TOKEN` or separate per-agent tokens
- `DATABASE_URL`
- `ALLOWED_FRONTEND_ORIGINS`
- `AZURE_VECTOR_ENDPOINT` and related vector credentials later

Production CORS policy:

- Allow GitHub Pages origin during UAT.
- Allow Azure frontend origin after migration.
- Reject wildcard origins for authenticated resume and write operations.
