# Zielmodus: Real Knowledge Fabric Duplicate Scoring

Date: 2026-09-08

## Objective

Replace the current Knowledge Fabric fallback duplicate scoring with real
backend-backed vector/graph scoring.

Target runtime:

```text
Knowledge Fabric n8n trigger
  -> Score duplicate and merge evidence
  -> Attach duplicate_score_evidence
  -> Knowledge Fabric AI Agent
  -> Contract response normalizer
  -> Return JSON
```

## Current Boundary

The live Knowledge Fabric workflow is functional but in fallback mode:

- `duplicate_check.status=insufficient_evidence`
- no real vector/graph duplicate score
- no trusted merge decision

Root cause:

- There is no verified hosted Me.IDs backend URL.
- `https://eraneos-agentic-platform.azurewebsites.net/api/health` returns 404,
  so that host is currently n8n, not the Me.IDs backend proxy.
- n8n blocks `$env` access inside node expressions through
  `N8N_BLOCK_ENV_ACCESS_IN_NODE`, so the backend URL must be materialized at
  publish time or stored through a supported n8n credential/config mechanism.

## Access Rights Required

Azure:

- Reader on subscription/resource group to identify existing App Service,
  Search, Postgres, and Key Vault resources.
- Website Contributor or Contributor on `rg-ai-intellectual-twin` to create or
  update the Me.IDs backend App Service.
- App Service application-settings write permission.
- Key Vault Secrets User/Officer if secrets are stored as Key Vault references.
- Azure AI Search admin/query key access for `AZURE_SEARCH_API_KEY`.
- Access to the Azure OpenAI or Eraneos AI Gateway embedding credentials.

n8n:

- Owner/admin or workflow edit rights for:
  - `Me.IDs Knowledge Fabric Agent - staging`
  - `Me.IDs Learning Agent - staging`
- n8n API key with workflow read/update permission.

Repository/GitHub:

- Write access to repository if deployment is done through GitHub Actions.
- GitHub Actions secret access if backend deployment secrets are stored there.

## Build Order

### 1. Identify Or Deploy Backend

First run local discovery:

```powershell
npm run n8n:scoring:discover-backend
```

The discovery command probes likely Azure App Service names and persists
`MEIDS_BACKEND_URL` only if both backend endpoints respond:

- `GET /api/health`
- `POST /api/knowledge/duplicate-check`

Preferred:

1. Use an existing backend App Service if it responds to:
   `GET /api/health`.
2. If none exists, deploy `backend/server.js` as a Node.js 20+ Azure App
   Service.
3. Startup command:
   `npm start`.

Required backend settings:

```text
NODE_ENV=production
PORT=8080
ALLOWED_FRONTEND_ORIGINS=https://florianliepe.github.io

N8N_ACTOR_TWIN_WEBHOOK_URL=https://eraneos-agentic-platform.azurewebsites.net/webhook/b4afb251-2ad1-43da-9d7c-6f6473fbd3db/chat
N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL=https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/knowledge-fabric/ingest
N8N_AGENTIC_BUTLER_WEBHOOK_URL=https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/agentic-butler/run
N8N_API_BASE_URL=https://eraneos-agentic-platform.azurewebsites.net
N8N_API_KEY=<backend-only n8n API key>

AZURE_SEARCH_ENDPOINT=<search endpoint>
AZURE_SEARCH_API_KEY=<backend-only search key>
AZURE_SEARCH_APPROVED_INDEX=meids-okf-approved-v1
AZURE_SEARCH_WORKING_INDEX=meids-okf-working-v1

AZURE_OPENAI_ENDPOINT=<embedding endpoint>
AZURE_OPENAI_API_KEY=<backend-only embedding key>
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=<embedding deployment>
AZURE_OPENAI_API_VERSION=2024-02-01
```

Postgres is recommended for production trace/approval durability:

```text
MEIDS_STORAGE_MODE=postgres
DATABASE_URL=<postgres connection string>
DATABASE_SSL=true
```

### 2. Verify Backend

```powershell
$env:MEIDS_BACKEND_URL="https://<backend-app>.azurewebsites.net"
Invoke-RestMethod "$env:MEIDS_BACKEND_URL/api/health"
Invoke-RestMethod "$env:MEIDS_BACKEND_URL/api/knowledge/duplicate-check" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"candidate":{"title":"probe","text":"probe text"}}'
```

Expected:

- `/api/health` returns `status=ok`.
- `/api/knowledge/duplicate-check` returns JSON with `duplicate_check.status`.
- If Azure Search secrets are incomplete, the endpoint may return
  `insufficient_evidence`; that is acceptable for backend reachability but not
  enough for real scoring.

### 3. Publish Real n8n Scoring

```powershell
$env:N8N_API_BASE_URL=[Environment]::GetEnvironmentVariable("N8N_API_BASE_URL","User")
$env:N8N_API_KEY=[Environment]::GetEnvironmentVariable("N8N_API_KEY","User")
$env:MEIDS_BACKEND_URL="https://<backend-app>.azurewebsites.net"
npm run n8n:scoring:publish-real
```

This command:

- verifies `/api/health`;
- verifies `/api/knowledge/duplicate-check`;
- republishes Knowledge Fabric with an HTTP scoring node;
- verifies local workflow JSON has HTTP-backed scoring.

On this Windows workspace the npm command uses
`scripts/publish-real-knowledge-scoring.ps1`, because PowerShell n8n API calls
were reliable while Node `fetch` intermittently failed against the hosted n8n
API.

### 4. Retest Knowledge Fabric

```powershell
Invoke-RestMethod `
  "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/knowledge-fabric/ingest" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"request_id":"uat_real_scoring","agent_id":"knowledge_fabric_agent","intent":"ingest_or_stage_knowledge","input":{"title":"Real scoring UAT","text":"No-write scoring UAT."},"context":{"twin_id":"florian","source_policy":"selected_pending"}}'
```

Expected in n8n execution:

- `Score duplicate and merge evidence` is an HTTP Request node.
- It calls `<backend>/api/knowledge/duplicate-check`.
- `Attach duplicate score evidence` passes `duplicate_score_evidence`.
- Knowledge Fabric does not fabricate duplicate decisions when evidence is
  insufficient.

## Decision Point

If a hosted backend cannot be deployed now:

- Keep fallback scoring mode for UAT continuity.
- Do not claim real duplicate/merge scoring is active.
- Keep modularization deferred.

If hosted backend is deployed and verified:

- Republish with `MEIDS_BACKEND_URL`.
- Run live Knowledge Fabric UAT.
- Then move modularization from deferred to ready.

## Execution Result - 2026-09-08

Implemented:

- Added `.github/workflows/meids-backend-app-service.yml` as a manual App
  Service deployment workflow.
- Added `scripts/deploy-backend-app-service.ps1` and
  `npm run backend:azure:deploy` for Azure CLI based App Service deployment.
- Added `scripts/publish-real-knowledge-scoring.ps1`.
- Added `scripts/discover-meids-backend-url.ps1`.
- Added `npm run n8n:scoring:discover-backend`.
- Added `npm run n8n:scoring:publish-real`.
- Added Node preflight helper:
  `scripts/publish-real-knowledge-scoring.cjs`.
- Confirmed `npm run check:backend` passes.
- Confirmed `npm run check:agents` passes.
- Confirmed backend discovery is safe and deterministic:
  it found no backend among the likely App Service DNS names and did not set
  `MEIDS_BACKEND_URL`.
- Confirmed `npm run n8n:scoring:publish-real` fails before publishing when
  `MEIDS_BACKEND_URL` is missing.

Final execution:

- Azure CLI was installed and authenticated against subscription
  `25c9ce59-90a1-4e8a-a2d4-1853a19bce22`.
- Existing App Service `erax-reference-api-1853a19b` was inspected but did not
  expose the Me.IDs backend route `/api/health`.
- A dedicated backend App Service was created on the existing plan
  `asp-erax-reference`:
  `https://meids-backend-1853a19b.azurewebsites.net`.
- The backend was deployed from this repository and started successfully with
  Node.js 22 LTS.
- Azure Search indexes were created:
  - `meids-okf-approved-v1`
  - `meids-okf-working-v1`
- `MEIDS_BACKEND_URL` was set in the Windows user environment:
  `https://meids-backend-1853a19b.azurewebsites.net`.
- `npm run n8n:scoring:publish-real` completed successfully.
- Latest live n8n backup:
  `exports/n8n-live-backups/20260908T111023Z-real-knowledge-scoring`.
- Live Knowledge Fabric workflow verification:
  - workflow: `MeIDs Knowledge Fabric Agent - staging`
  - workflow id: `7Ci86PxXipwvYpKv`
  - active: `true`
  - scoring node: `Score duplicate and merge evidence`
  - scoring node type: `n8n-nodes-base.httpRequest`
  - scoring URL:
    `https://meids-backend-1853a19b.azurewebsites.net/api/knowledge/duplicate-check`
- Initial live Knowledge Fabric UAT request:
  `uat_real_scoring_20260908_1107`.
- Initial live Knowledge Fabric trace:
  `n8n_exec_19808`.
- Final live Knowledge Fabric UAT request after fixing n8n payload mapping:
  `uat_real_scoring_strong_duplicate_final_20260908_1111`.
- Final live Knowledge Fabric trace:
  `n8n_exec_19811`.
- Backend duplicate provider:
  `azure_ai_search`.
- Final scoring proof:
  - `duplicate_check.status=strong_duplicate`
  - `merge_candidates[0].concept_id=cpt_uat_real_scoring_001`
  - `scores.vector_similarity=0.9426`
  - `scores.scope_compatible=true`
  - scoring node URL:
    `https://meids-backend-1853a19b.azurewebsites.net/api/knowledge/duplicate-check`

Remaining refinement:

- Azure OpenAI embedding settings are not configured yet, so production ingestion
  still needs either inline `content_vector` values or embedding credentials.
- Add `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, and
  `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` to enable vector similarity.
- Upsert real OKF documents into the Azure Search indexes to produce production
  duplicate candidates beyond the seeded UAT proof document.
