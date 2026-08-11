# Agent Backend Proxy and Approval Resume

## Purpose

The MeIDs frontend should not call private n8n production webhooks directly. The backend proxy owns:

- server-side n8n webhook URLs and optional auth token
- CORS boundary
- response normalization
- trace-chain persistence
- approval queue persistence
- approval resume into Agentic Butler

## Runtime Flow

1. Actor Twin request enters `/api/agents/actor-twin/chat`.
2. Backend forwards the contract envelope to `N8N_ACTOR_TWIN_WEBHOOK_URL`.
3. Backend normalizes the n8n response into the public agent response contract.
4. Backend stores the trace chain.
5. If response is `approval_required`, backend stores an approval queue item.
6. Cockpit loads pending approvals from `/api/agents/approvals`.
7. Human resumes through `/api/agents/approvals/:approval_id/resume`.
8. Backend forwards a `resume_after_approval` envelope to Agentic Butler.

## Azure App Service Setup

Configure these app settings:

| Setting | Purpose |
|---|---|
| `N8N_ACTOR_TWIN_WEBHOOK_URL` | Actor Twin n8n workflow production webhook |
| `N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL` | Knowledge Fabric Agent ingest webhook |
| `N8N_AGENTIC_BUTLER_WEBHOOK_URL` | Agentic Butler run/resume webhook |
| `N8N_WEBHOOK_AUTH_TOKEN` | Optional bearer token if n8n webhook auth is enabled |
| `ALLOWED_FRONTEND_ORIGINS` | GitHub Pages or hosted frontend origin |
| `MEIDS_DATA_DIR` | Durable data mount path until Postgres migration |

Use `npm start` as the startup command.

## Remaining Production Hardening

- Replace JSON-file persistence with Postgres.
- Add auth/session identity before exposing production write endpoints.
- Add request signing between frontend and backend.
- Add n8n webhook authentication and rotate tokens.
- Add structured audit records for approvals and resumed Butler runs.
