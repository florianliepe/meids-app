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
- `N8N_API_BASE_URL`: n8n instance base URL for backend-only workflow administration tools.
- `N8N_API_KEY`: backend-only n8n API key. Use for workflow import/update/status automation only; never expose it to `frontend/runtime-config.js`, GitHub Pages assets, browser localStorage, or client-side JavaScript.
- `N8N_ADMIN_ENABLED`: set to `true` only after hosted secret storage is active.
- `MEIDS_SECRET_STORE_READY`: set to `true` when backend secrets are stored in hosted app settings or Key Vault references. `AZURE_KEY_VAULT_URI` also satisfies this gate.
- `DATABASE_URL`: enables Postgres persistence when `MEIDS_STORAGE_MODE=postgres` or when no explicit mode is set.
- `DATABASE_SSL`: set to `true` for hosted Postgres providers that require SSL.
- `MEIDS_STORAGE_MODE`: `file` or `postgres`. Defaults to `postgres` when `DATABASE_URL` exists; otherwise `file`.
- `ALLOWED_FRONTEND_ORIGINS`: comma-separated allowed frontend origins.
- `MEIDS_DATA_DIR`: persistence folder. Defaults to `.data`.
- `PORT`: defaults to `8080`.

## Hosted Secret Handling

For hosted deployment, store all n8n credentials as backend application settings or Key Vault references:

- Azure App Service settings: `N8N_ACTOR_TWIN_WEBHOOK_URL`, `N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL`, `N8N_AGENTIC_BUTLER_WEBHOOK_URL`, optional `N8N_WEBHOOK_AUTH_TOKEN`, optional `N8N_API_BASE_URL`, optional `N8N_API_KEY`.
- GitHub Actions secrets: use only for deployment-time injection into the backend host. Do not write resolved secret values into committed runtime assets.
- GitHub Pages: may contain public UAT webhook URLs only. It must not contain `N8N_API_KEY` or private bearer tokens.

Runtime Chat calls should use `/api/agents/*` once the backend is hosted. Direct browser-to-n8n calls are a staging fallback for public UAT only and cannot support secure approval resume or durable trace storage.

## Admin Boundary

`GET /api/admin/n8n/status` is the first backend-only n8n admin endpoint. It is intentionally blocked unless all gates are present:

- `N8N_ADMIN_ENABLED=true`
- `MEIDS_SECRET_STORE_READY=true` or `AZURE_KEY_VAULT_URI`
- `N8N_API_BASE_URL`
- `N8N_API_KEY`

This prevents accidental exposure of workflow administration while the frontend is still static-hosted.

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
- `agent_traces`
- `agent_approval_queue`
- `agent_run_events`

Set `DATABASE_URL` to activate Postgres mode. The frontend is already written against HTTP endpoints, so the storage mode can change without changing browser code.
