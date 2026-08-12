# Azure AI Search Vector Integration

## Decision

Use one Azure AI Search service with shared indexes and strict filters:

- `meids-okf-approved-v1`: approved retrieval memory for Actor Twin answers.
- `meids-okf-working-v1`: draft, pending-review, and candidate material for review/cockpit use.

Do not create one vector database per twin for the first production version. Multi-twin isolation is enforced with metadata filters:

```text
organization_id eq '<org>'
and knowledge_state eq 'approved'
and (twin_id eq '<active-twin>' or visibility_scope eq 'org_shared' or visibility_scope eq 'team_shared')
```

Private concepts remain scoped to one twin. Cross-twin knowledge sharing is allowed only after human approval by promoting the concept to `visibility_scope = org_shared` or `team_shared`.

## Required Backend Secrets

Never expose these in GitHub Pages or `frontend/runtime-config.js`.

```text
AZURE_SEARCH_ENDPOINT=https://srch-intellectual-twin.search.windows.net
AZURE_SEARCH_API_KEY=<backend-only admin or indexer key>
AZURE_SEARCH_APPROVED_INDEX=meids-okf-approved-v1
AZURE_SEARCH_WORKING_INDEX=meids-okf-working-v1
AZURE_SEARCH_API_VERSION=2025-09-01
AZURE_OPENAI_ENDPOINT=<embedding endpoint>
AZURE_OPENAI_API_KEY=<backend-only embedding key>
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=<embedding deployment name>
AZURE_OPENAI_API_VERSION=2024-02-01
AZURE_OPENAI_EMBEDDING_DIMENSIONS=1536
```

## Backend Endpoints

- `GET /api/vector-index/status`
- `POST /api/vector-index/rebuild`
- `POST /api/vector-index/search`

`/api/vector-index/rebuild` accepts existing OKF vector adapter requests from `contracts/okf/**/vector/*.json`.

Live writes require either:

- Azure OpenAI embedding secrets, so the backend can generate `content_vector`.
- Or caller-supplied `content_vector` values that match `AZURE_OPENAI_EMBEDDING_DIMENSIONS`.

Without embeddings, live upsert is blocked. Dry-runs remain available for contract checks.

## Production Activation Sequence

1. Configure backend App Service or Key Vault settings from `deploy/backend-proxy.app-service.env.example`.
2. Verify backend status:

```powershell
Invoke-RestMethod -Uri "https://YOUR-BACKEND-HOST/api/vector-index/status" -Method Get
```

3. Create/update indexes:

```powershell
npm run setup:azure-search -- --dry-run
npm run setup:azure-search
```

4. Run the first approved OKF upsert:

```powershell
node scripts/run-first-vector-upsert.cjs --dry-run --backend-url https://YOUR-BACKEND-HOST
node scripts/run-first-vector-upsert.cjs --backend-url https://YOUR-BACKEND-HOST
```

5. Test Actor Twin retrieval through the hosted backend:

```powershell
Invoke-RestMethod `
  -Uri "https://YOUR-BACKEND-HOST/api/vector-index/search" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"query":"client delivery steering","twin_id":"florian","organization_id":"default","source_policy":"approved_only","top":5}'
```

## Current Live Azure Observation

Portal inspection on 2026-08-12 showed:

- Azure resource group: `rg-ai-intellectual-twin`
- Azure AI Search service: `srch-intellectual-twin`
- Endpoint: `https://srch-intellectual-twin.search.windows.net`
- Location: West Europe
- Tier: Basic
- Status: Running
- Indexes: none visible yet
- Other resources visible in the resource group: none

This means the Search service exists, but the vector indexes and hosted backend/embedding runtime are not yet live. The public-safe status artifact is:

- `frontend/assets/azure-vector-live-activation-status.json`

No secrets are stored in that artifact.

## Live Activation Blockers

The following items must be completed before Actor Twin can use Azure vector retrieval in production:

1. Create or identify a hosted MeIDs backend App Service for `backend/server.js`.
2. Create or identify an Azure OpenAI embedding endpoint/deployment.
3. Configure the backend-only settings from `deploy/backend-proxy.app-service.env.example`.
4. Run `npm run setup:azure-search` from a trusted backend/operator environment.
5. Run `node scripts/run-first-vector-upsert.cjs --backend-url https://YOUR-BACKEND-HOST`.
6. Wire Knowledge Fabric n8n approval flow to `https://YOUR-BACKEND-HOST/api/vector-index/rebuild`.

## Knowledge Fabric Flow

1. Upload/transcript/source material is converted to pending OKF concept + evidence.
2. Knowledge Fabric Agent emits a vector refresh request.
3. Backend routes approved concepts to `meids-okf-approved-v1`; pending/candidate concepts to `meids-okf-working-v1`.
4. Actor Twin searches approved memory by default.
5. Draft/pending retrieval is only allowed when `source_policy = selected_pending` and must be visibly attributed.

The n8n HTTP node blueprint for the Knowledge Fabric refresh step is:

- `workflows/n8n/implementations/knowledge-fabric-vector-refresh-http-node.json`

Keep Azure Search and Azure OpenAI keys in the backend only. n8n should call the backend proxy, not Azure directly.

## Actor Twin Retrieval Flow

1. Actor Twin interprets intent.
2. Backend performs hybrid-ready Azure AI Search query with metadata filters.
3. Results retain OKF paths, evidence IDs, graph IDs, and review state.
4. Actor Twin answers with citations to OKF/evidence sources.

## Azure Setup

Create/update indexes from:

- `contracts/azure-search/meids-okf-approved-v1.index.json`
- `contracts/azure-search/meids-okf-working-v1.index.json`

Preferred script:

```powershell
npm run setup:azure-search -- --dry-run
npm run setup:azure-search
```

The script reads backend-only environment variables and does not print keys.

PowerShell shape:

```powershell
$headers = @{
  "Content-Type" = "application/json"
  "api-key" = $env:AZURE_SEARCH_API_KEY
}

Invoke-RestMethod `
  -Method Put `
  -Uri "$env:AZURE_SEARCH_ENDPOINT/indexes/meids-okf-approved-v1?api-version=$env:AZURE_SEARCH_API_VERSION" `
  -Headers $headers `
  -Body (Get-Content ".\contracts\azure-search\meids-okf-approved-v1.index.json" -Raw)

Invoke-RestMethod `
  -Method Put `
  -Uri "$env:AZURE_SEARCH_ENDPOINT/indexes/meids-okf-working-v1?api-version=$env:AZURE_SEARCH_API_VERSION" `
  -Headers $headers `
  -Body (Get-Content ".\contracts\azure-search\meids-okf-working-v1.index.json" -Raw)
```
