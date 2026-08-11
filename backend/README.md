# MeIDs Agent Backend Proxy

This backend is the production boundary for agent runtime calls. GitHub Pages may call public UAT webhooks directly, but production should call this proxy so private n8n URLs, tokens, trace persistence, and approval resume logic stay server-side.

## Endpoints

- `GET /api/health`
- `POST /api/agents/actor-twin/chat`
- `POST /api/agents/knowledge-fabric/ingest`
- `POST /api/agents/agentic-butler/run`
- `GET /api/agents/traces`
- `POST /api/agents/traces`
- `GET /api/agents/approvals`
- `POST /api/agents/approvals`
- `POST /api/agents/approvals/:approval_id/resume`

## Environment Variables

Required for live production proxying:

- `N8N_ACTOR_TWIN_WEBHOOK_URL`
- `N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL`
- `N8N_AGENTIC_BUTLER_WEBHOOK_URL`

Optional:

- `N8N_WEBHOOK_AUTH_TOKEN`: bearer token forwarded to n8n if webhook authentication is enabled.
- `ALLOWED_FRONTEND_ORIGINS`: comma-separated allowed frontend origins.
- `MEIDS_DATA_DIR`: persistence folder. Defaults to `.data`.
- `PORT`: defaults to `8080`.

## Local Run

```powershell
cd "C:\Users\e729958\Downloads\MeIDs-public-app-sanitized-20260806-01\meids-app-public"
$env:N8N_ACTOR_TWIN_WEBHOOK_URL="https://eraneos-agentic-platform.azurewebsites.net/webhook/..."
$env:N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL="https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/knowledge-fabric/ingest"
$env:N8N_AGENTIC_BUTLER_WEBHOOK_URL="https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/agentic-butler/run"
node backend/server.js
```

Then set `frontend/runtime-config.js` or the deployed runtime asset:

```js
window.INTELLECTUAL_TWIN_CONFIG = {
  apiBaseUrl: "http://127.0.0.1:8080",
  agentBackendProxyEnabled: true
};
```

## Persistence Boundary

The current implementation persists traces and approval queue items as JSON files:

- `.data/agent-traces.jsonl`
- `.data/agent-approvals.json`

This is intentional for the MVP and local/Azure bootstrap. The production migration target is Postgres:

- `agent_trace_chains`
- `agent_approval_queue`
- `agent_run_events`

The frontend is already written against HTTP endpoints, so the JSON-file storage can be replaced by Postgres without changing browser code.
