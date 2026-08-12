# Actor Twin Direct Orchestration Zielmodus

## Goal

Make Actor Twin the top-level n8n orchestrator for UAT. Actor Twin directly calls Knowledge Fabric Agent and Agentic Butler workflows when the route decision requires delegated work. Backend orchestration stays deferred for production hardening.

## Key Point

Actor Twin is the decision authority, not the worker. It decides what should happen, delegates execution to Knowledge Fabric Agent or Agentic Butler, then reviews and shapes the returned result before responding to the user.

## Target Interaction

1. Receive Chat request.
2. Actor Twin AI Agent generates `route_decision`.
3. If `answer_direct`, answer directly.
4. If `retrieve_knowledge` or `ingest_or_stage_knowledge`, call Knowledge Fabric Agent workflow directly.
5. If `activate_skill` or `create_skill`, call Agentic Butler workflow directly.
6. Normalize returned delegate output.
7. Persist full trace chain.
8. Return final Actor Twin response/status to frontend.

## UAT n8n Setup

Use this target workflow blueprint:

- `workflows/n8n/implementations/actor-twin-direct-orchestrator.workflow.json`

The live Actor Twin workflow needs these n8n runtime environment variables:

```text
N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL=https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/knowledge-fabric/ingest
N8N_AGENTIC_BUTLER_WEBHOOK_URL=https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/agentic-butler/run
```

Do not store these as frontend-only routing authority. For UAT, n8n may call them directly. For production, the backend proxy should perform the delegation so secrets, traces, retries, and approval resume are durable.

## Route Ownership

| Route decision | Target | Execution owner |
|---|---|---|
| `answer_direct` | Actor Twin | Actor Twin |
| `retrieve_knowledge` | Knowledge Fabric Agent | Actor Twin calls Knowledge Fabric |
| `ingest_or_stage_knowledge` | Knowledge Fabric Agent | Actor Twin calls Knowledge Fabric |
| `activate_skill` | Agentic Butler | Actor Twin calls Agentic Butler |
| `create_skill` | Agentic Butler | Actor Twin calls Agentic Butler, human approval required |
| `request_human_clarification` | Human | Actor Twin pauses |

## Validation Artifacts

- `contracts/n8n/fixtures/actor-twin-routing.json`
- `frontend/assets/actor-twin-routing-readiness-status.json`
- `frontend/assets/actor-twin-orchestration-readiness-status.json`

Run:

```powershell
node scripts\validate-actor-twin-routing.cjs
node scripts\write-actor-twin-orchestration-readiness-status.cjs --check
npm run check:agents
```

## Production Hardening Later

Move from direct n8n-to-n8n calls to backend-mediated calls when:

- hosted backend is available,
- `DATABASE_URL` / durable trace persistence is active,
- approval queue and resume endpoints are active,
- n8n API/admin secrets are in backend secret storage,
- retry and error normalization are implemented server-side.

Then the route becomes:

```text
Frontend -> Backend -> Actor Twin -> Backend delegation -> Knowledge Fabric / Butler
```

instead of:

```text
Frontend -> Actor Twin n8n -> Knowledge Fabric / Butler n8n
```
