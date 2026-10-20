# Azure Installation Playbook

## Target Deployment Shape

Use two deployable surfaces:

1. Static frontend:
   - Azure Static Web Apps, GitHub Pages, or another static host.
   - Contains only public assets from the Pages build.
   - Embeds Actor Twin n8n chat for UAT, or calls backend proxy in production.
2. Backend proxy:
   - Azure App Service running Node.js.
   - Owns n8n webhook secrets, n8n API key, trace persistence, approval resume,
     voice transcription, vector search, and production storage.

For production, prefer:

```text
Browser -> Static frontend -> Azure App Service backend -> n8n / Azure AI Search / Postgres
```

Avoid this in production:

```text
Browser -> n8n private/admin endpoints
```

## Prerequisites

- Azure resource group.
- Azure App Service Plan and Web App for Node.js 22 LTS or newer.
- Optional Azure Static Web App for frontend.
- Azure AI Search for vector indexes.
- Postgres-compatible database for durable traces and approvals.
- n8n instance with published Actor Twin workflow and internal workflow tools.
- Eraneos AI Gateway or OpenAI-compatible API credentials.
- Optional Azure Key Vault for secret references.

## Backend App Service Setup

1. Create an App Service Web App with Node.js 22 LTS or newer runtime.
2. Deploy this repository to the Web App using ZIP deploy, GitHub Actions, Azure
   DevOps, or App Service deployment center.
3. Set startup command:

```bash
npm start
```

GitHub Actions option:

1. Download the App Service publish profile from Azure Portal.
2. Store it as the repository secret
   `AZUREAPPSERVICE_PUBLISHPROFILE_MEIDS_BACKEND`.
3. Run the workflow `Deploy Me.IDs backend to Azure App Service`.
4. Enter the App Service name without `.azurewebsites.net`.
5. After the deployment, configure the App Service application settings below.

Azure CLI option from this repository:

```powershell
npm run backend:azure:deploy -- `
  -AppName <backend-app-name> `
  -CreateIfMissing
```

To also apply secret settings from the current shell environment, set the
variables first and add `-ApplySecretSettings`. Do not pass secrets directly in
the command line.

4. Configure App Service application settings:

```text
NODE_ENV=production
PORT=8080
MEIDS_STORAGE_MODE=postgres
DATABASE_URL=<postgres connection string>
DATABASE_SSL=true
ALLOWED_FRONTEND_ORIGINS=https://<frontend-host>

N8N_ACTOR_TWIN_WEBHOOK_URL=https://<n8n-host>/webhook/<actor-chat-or-proxy-path>
N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL=https://<n8n-host>/webhook/meids/knowledge-fabric/ingest
N8N_AGENTIC_BUTLER_WEBHOOK_URL=https://<n8n-host>/webhook/meids/agentic-butler/run
N8N_WEBHOOK_AUTH_TOKEN=<optional bearer token>

N8N_ADMIN_ENABLED=false
N8N_API_BASE_URL=https://<n8n-host>
N8N_API_KEY=<backend-only admin api key>
MEIDS_SECRET_STORE_READY=true

ERANEOS_AI_GATEWAY_API_KEY=<backend-only key>
ERANEOS_AI_GATEWAY_BASE_URL=https://<openai-compatible-gateway>/v1
ERANEOS_AI_GATEWAY_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe

AZURE_SEARCH_ENDPOINT=https://<search>.search.windows.net
AZURE_SEARCH_API_KEY=<backend-only search key>
AZURE_SEARCH_APPROVED_INDEX=meids-okf-approved-v1
AZURE_SEARCH_WORKING_INDEX=meids-okf-working-v1
AZURE_OPENAI_ENDPOINT=https://<azure-openai>.openai.azure.com
AZURE_OPENAI_API_KEY=<backend-only embeddings key>
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=<deployment>
```

Use Key Vault references for secrets when available.

For UAT environments without an Azure OpenAI embedding deployment, set:

```text
MEIDS_ALLOW_DETERMINISTIC_VECTORS=true
```

Then call `/api/vector-index/rebuild` with caller-supplied `content_vector`
values or `vector_mode=deterministic_fallback`. This proves OKF ingestion,
Azure AI Search upsert, and duplicate-check plumbing. It is not a replacement
for production semantic embeddings.

## Static Frontend Setup

Build static assets:

```powershell
npm install
node scripts/build-pages-static.cjs --output dist-pages
```

For production backend mode, configure the generated runtime config with:

```text
GH_PAGES_API_BASE_URL=https://<backend-app>.azurewebsites.net
GH_PAGES_N8N_CHAT_WEBHOOK_URL=
```

For UAT embedded n8n chat mode, configure:

```text
GH_PAGES_N8N_CHAT_WEBHOOK_URL=https://<n8n-host>/webhook/<actor-chat-id>/chat
```

Never place these in static assets:

- `N8N_API_KEY`
- `N8N_WEBHOOK_AUTH_TOKEN`
- OpenAI or Eraneos AI Gateway keys
- Azure Search keys
- Postgres credentials

## n8n Setup

Required live workflows:

- Actor Twin embedded chat workflow.
- Knowledge Fabric Agent workflow.
- Agentic Butler workflow.
- Knowledge Retrieval Interviewer workflow.
- Skill Orchestrator workflow.
- Task Agent workflow.
- Critical Faculty Agent workflow.
- Learning Agent workflow.

Run integration scripts from an operator machine with backend-only n8n API
credentials:

```powershell
$env:N8N_API_BASE_URL="https://<n8n-host>"
$env:N8N_API_KEY="<n8n-api-key>"
node scripts/integrate-n8n-skill-orchestrator-task-agent.cjs
node scripts/integrate-n8n-critical-faculty-learning-agents.cjs
```

## Validation

Run local checks:

```powershell
npm run check:backend
npm run check:agents
node scripts/build-pages-static.cjs --output dist-pages-check
node scripts/audit-agent-runtime-performance.cjs
```

Backend smoke checks:

```powershell
Invoke-RestMethod https://<backend-app>.azurewebsites.net/api/health
Invoke-RestMethod https://<backend-app>.azurewebsites.net/api/vector-index/status
```

Frontend UAT:

1. Open the frontend.
2. Ask Actor Twin an identity question.
3. Ask for knowledge retrieval.
4. Ask for a no-write work artifact.
5. Ask for a generated skill proposal.
6. Verify subagent traces in n8n, not as separate frontend chats.

## Transfer Checklist

- Repository builds from clean clone.
- `.env` and `.data` are not committed.
- Static runtime config contains no secrets.
- Backend App Service settings contain all secrets.
- n8n workflows are published and tool connections are present.
- Postgres mode is configured for durable trace/approval persistence.
- Azure Search indexes exist.
- Voice transcription backend is configured or explicitly disabled.
- `agent-runtime-performance-audit.json` has acceptable latency for common UAT paths.

## Source References

- Azure App Service supports Node.js app deployment and application settings for
  environment variables.
- Azure App Service can reference Key Vault secrets through app settings.
- Azure Static Web Apps/GitHub Actions deployment keeps static frontend builds
  separate from backend runtime configuration.
