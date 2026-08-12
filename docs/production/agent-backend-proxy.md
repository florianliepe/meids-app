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
| `MEIDS_STORAGE_MODE` | `file` for local MVP, `postgres` for hosted durable storage |
| `DATABASE_URL` | Postgres connection string for trace-chain persistence and approval queue |
| `DATABASE_SSL` | Set `true` if the hosted Postgres endpoint requires SSL |
| `MEIDS_DATA_DIR` | Durable data mount path for local/file mode |
| `N8N_ADMIN_ENABLED` | Enables backend-only n8n admin endpoints after hosted secret storage is active |
| `MEIDS_SECRET_STORE_READY` | Explicit guard that secrets live in hosted settings or Key Vault |
| `N8N_API_BASE_URL` | n8n API base URL for backend-only workflow status/admin reads |
| `N8N_API_KEY` | n8n API key; never expose to browser runtime config |

Use `npm start` as the startup command.

## Hosted Backend Proxy Mode

For approval resume outside local mode, host `backend/server.js` as a Node web app and set frontend `apiBaseUrl` / `agentBackendBaseUrl` to the hosted backend origin. The browser then calls `/api/agents/*`; the backend calls n8n, stores traces, and resumes approval-gated Butler runs.

Recommended deployment phases:

1. Host backend with file mode for smoke testing only.
2. Add `DATABASE_URL` and switch `MEIDS_STORAGE_MODE=postgres`.
3. Add n8n webhook secrets.
4. Set `ALLOWED_FRONTEND_ORIGINS` to the GitHub Pages domain.
5. Enable `N8N_ADMIN_ENABLED=true` only after `MEIDS_SECRET_STORE_READY=true` or Key Vault is active.

## n8n admin boundary

`GET /api/admin/n8n/status` is intentionally read-only and blocked by default. It only returns workflow status after hosted secret storage is active. Import/update workflow endpoints should be added later behind the same guard and server-side authorization.

## Remaining Production Hardening

- Add user/session authorization before public production rollout.
- Add auth/session identity before exposing production write endpoints.
- Add request signing between frontend and backend.
- Add n8n webhook authentication and rotate tokens.
- Add structured audit records for approvals and resumed Butler runs.
