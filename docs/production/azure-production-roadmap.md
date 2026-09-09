# Azure Production Roadmap

## Current Direction

The target picture is to run the full Me.IDs application and runtime information
inside Azure while keeping n8n as the agent workflow orchestration layer.

Actor Twin remains the only user-facing chat. Knowledge Fabric Agent, Agentic
Butler, Skill Orchestrator, Task Agents, Critical Faculty Agent, and Learning
Agent remain n8n workflow-tool subagents.

GitHub remains the source-control and deployment source. It should not be the
production runtime store for uploads, reviews, traces, OKF state, graph state, or
active agent configuration.

Before this production roadmap starts, the login page and authentication concept
will be ideated and integrated.

## Production Steps Left

### 1. Deploy Production Backend Runtime

Current UAT backend:

```text
https://meids-backend-1853a19b.azurewebsites.net
```

Production target:

- Create a production App Service or deployment slot.
- Enable Always On on a paid production plan.
- Configure production CORS for the Azure-hosted frontend domain.
- Add health checks and log retention.

Can be automated by Codex if Azure permissions allow.

Requires human/tenant decision:

- Production app name.
- SKU/cost decision.
- Tenant security policy approval.

### 2. Move Frontend from GitHub Pages to Azure

Recommended target:

- Azure Static Web Apps or Azure App Service static hosting.
- Azure-hosted production frontend domain.
- GitHub Actions can remain the deployment trigger, but deployment target should
  be Azure instead of GitHub Pages.

Reason:

GitHub Pages is sufficient for static UAT, but it is not suitable for production
runtime writes, reviews, uploads, or shared state. Azure gives one controlled
frontend/backend/security boundary.

Can be automated by Codex after the hosting target is selected.

Requires human/tenant decision:

- Static Web Apps vs App Service.
- Custom domain and access policy.

### 3. Configure Production Secrets

Recommended:

- Start with Azure App Service app settings.
- Move to Azure Key Vault references for production hardening.

Required settings:

```text
N8N_API_BASE_URL
N8N_API_KEY
N8N_ACTOR_TWIN_WEBHOOK_URL
N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL
N8N_AGENTIC_BUTLER_WEBHOOK_URL
AZURE_SEARCH_ENDPOINT
AZURE_SEARCH_API_KEY
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_API_KEY
AZURE_OPENAI_EMBEDDING_DEPLOYMENT
ERANEOS_AI_GATEWAY_API_KEY or OPENAI_API_KEY
DATABASE_URL
DATABASE_SSL=true
```

Can be configured by Codex if values are available in the environment and Azure
permissions allow app setting updates.

Requires human/tenant action:

- Key creation/reveal in external portals.
- Key Vault access policies if admin-restricted.

### 4. Add Production Database

Recommended target:

- Azure Database for PostgreSQL Flexible Server.

Runtime data to store:

- Twins.
- OKF concepts.
- Evidence metadata.
- Review states.
- Graph nodes and edges.
- Agent traces.
- Approval records.
- Learning documents.
- Active agent configuration versions.

Current backend still supports file storage for UAT. Production should use
PostgreSQL.

Can be implemented by Codex:

- Database schema.
- Backend persistence layer.
- Migration scripts.

Requires human/tenant action:

- Database server creation if restricted by subscription policy.
- Backup, retention, private networking, and cost decisions.

### 5. Configure Semantic Embeddings

Current state:

- Azure AI Search is live.
- UAT deterministic vector fallback is enabled.
- Azure OpenAI embeddings are not configured.

Production target:

```text
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_API_KEY
AZURE_OPENAI_EMBEDDING_DEPLOYMENT
AZURE_OPENAI_EMBEDDING_DIMENSIONS=1536
```

Production must disable or strictly gate:

```text
MEIDS_ALLOW_DETERMINISTIC_VECTORS
```

Can be configured by Codex if endpoint, deployment, and key are available.

Requires human/tenant action:

- Azure OpenAI resource, quota, deployment, and key if not already available.

### 6. Wire Knowledge Fabric Persistence

Production flow:

1. Source, upload, transcript, or interview is converted into candidate OKF
   concepts and evidence records.
2. Backend persists concepts/evidence to PostgreSQL.
3. Backend upserts searchable chunks into Azure AI Search.
4. Knowledge section reads review states from backend.
5. Review promotes concepts from `review_needed` to `approved`, `updated`, or
   `rejected`.

Can be implemented by Codex.

Requires human decision:

- Final OKF governance rules.
- Review roles and approval model.

### 7. Wire Graph Persistence

Recommended first step:

- Store graph nodes and edges in PostgreSQL.

Optional later:

- Move to Azure Cosmos DB Gremlin or another managed graph service if traversal
  depth and graph analytics become central.

Can be implemented by Codex:

- PostgreSQL graph tables.
- Backend graph APIs.
- Knowledge Fabric graph writes.

Requires human/tenant decision:

- Whether a dedicated graph database is required in production.

### 8. Move Active Agent Configuration to Azure

Recommended target:

- Store active agent configs, system instructions, and tool descriptions in
  PostgreSQL.
- Keep GitHub as reviewed source/export history.
- Backend exposes current config to n8n and the app.

Can be implemented by Codex.

Requires human decision:

- Approval workflow for production changes to active agent instructions.

### 9. Harden n8n Production Routing

Needed:

- Stable published workflow IDs.
- Normalized output contracts for all subagents.
- Timeout and fallback summaries for nested workflow calls.
- Trace ID propagation across Actor Twin, subagents, and backend.
- Remove `continueOnFail` where it hides contract failures.
- Keep n8n workflow admin API backend-only.

Can be implemented by Codex if `N8N_API_KEY` remains available.

Requires human action:

- n8n credential creation/rotation where browser-only or admin-restricted.

## Current n8n Routing Targets

### Actor Twin

- User-facing n8n embedded chat.
- Routing authority.
- Calls workflow tools instead of relying on frontend switch logic.

Tools:

- Call Knowledge Fabric Agent.
- Call Agentic Butler.
- Call Critical Faculty Agent.
- Optionally call backend retrieval endpoint for direct knowledge search.

### Knowledge Fabric Agent

Called for:

- Source ingestion.
- OKF concept creation/update.
- Evidence structuring.
- Duplicate and merge checks.

Backend target:

```text
POST /api/knowledge/duplicate-check
POST /api/vector-index/rebuild
```

### Agentic Butler

Called for:

- Skill execution.
- Skill concepting.
- Work decomposition.

Routing target:

- Calls Skill Orchestrator for low-level skill/task-agent selection and
  execution.

Approval:

- Required only before a new generated skill or task-agent becomes active.
- Not required for normal approved skill execution.

### Skill Orchestrator

Called by Agentic Butler.

Responsibilities:

- Select existing skill/task-agent.
- Pass bounded task context.
- Normalize output.
- Escalate only if new capability activation is required.

### Task Agents

Called by Skill Orchestrator.

Responsibilities:

- Bounded execution.
- No direct frontend exposure.
- Return structured output and trace evidence.

### Critical Faculty Agent

Callable by:

- Actor Twin.
- Knowledge Fabric Agent.
- Agentic Butler.

Responsibilities:

- Review decisions.
- Identify contradictions, weak assumptions, missing evidence, or risky action.
- Feed critique into trace and optionally Knowledge Fabric.

### Learning Agent

Triggered after:

- Completed traces.
- UAT results.
- Source ingestion.
- Agent execution summaries.

Responsibilities:

- Create summarized learning documents.
- Route learning deltas into Knowledge Fabric as `review_needed`.

## Repository Runtime Strategy

| Runtime asset | Current likely source | Production target | Effort | Change label |
| --- | --- | --- | --- | --- |
| App repository | GitHub | GitHub source plus Azure deploy artifact | Low | Keep GitHub as build source |
| OKF repository | GitHub/local files | PostgreSQL plus Azure AI Search plus optional Blob snapshots | Medium | Move runtime OKF to Azure |
| Agent config repository | GitHub prompts/workflow JSON | PostgreSQL config registry plus GitHub reviewed snapshots | Medium | Move active config to Azure |
| Knowledge graph repository | local/static JSON or workflow output | PostgreSQL graph tables first | Medium | Move graph runtime to Azure |
| Knowledge vector database | Azure AI Search | Azure AI Search | Low | Already aligned |
| Uploaded source files | browser/local/GitHub fallback | Azure Blob Storage | Medium | Move source artifacts to Azure |
| Trace store | file/backend JSONL | PostgreSQL plus optional Application Insights | Medium | Move traces to Azure |
| n8n workflow definitions | n8n plus exported JSON | n8n runtime plus GitHub backup exports | Low | Keep n8n live, GitHub backup |

## Recommended Production Phases

### Phase 0: Login and Authentication

Before production deployment:

- Use Microsoft Entra ID.
- Allow invited external users explicitly.
- Use Azure Static Web Apps for the production frontend target.
- Request/configure the `intellectual-twin` subdomain.
- Support users who own or manage multiple twins from day one.
- Define user, tenant, twin, and role mapping.
- Integrate frontend login state with backend authorization.
- Ensure Actor Twin chat and backend APIs inherit the authenticated twin context.

### Phase 1: Azure Runtime Foundation

- Create production backend.
- Create Azure frontend host.
- Configure production runtime config.
- Configure CORS.
- Move secrets to App Service settings or Key Vault references.

### Phase 2: Persistence Cutover

- Add Azure PostgreSQL.
- Add Azure Blob Storage.
- Implement backend APIs for twins, OKF concepts, evidence, graph, traces, and
  agent configs.
- Replace browser-local staging storage with backend persistence.

### Phase 3: Semantic Knowledge Layer

- Configure Azure OpenAI embeddings.
- Disable deterministic vector fallback in production.
- Reindex OKF concepts.
- Calibrate duplicate/merge thresholds using semantic vector scores.

### Phase 4: n8n Production Agent Routing

- Freeze workflow IDs.
- Re-publish Actor Twin with workflow-tool routing.
- Add normalized contracts and trace IDs.
- Add timeout/fallback nodes.
- Remove unsafe `continueOnFail` usage.

### Phase 5: Governance and Review

- Review cockpit reads from backend.
- Concepts move through `review_needed`, `approved`, `updated`, and `rejected`.
- New skill/agent activation keeps a single human approval gate.
- Normal approved skill execution stays autonomous.

### Phase 6: Observability and Hardening

- Add Application Insights.
- Add structured trace search.
- Add recurring UAT probes for all workflows/subagents.
- Add CI checks for frontend, backend, and workflow contracts.
- Add scheduled n8n workflow export backups.

## Open Clarifications

1. Should the production frontend use Azure Static Web Apps or App Service under
   the same backend host?
2. Should PostgreSQL become the primary OKF runtime store, with GitHub only as a
   reviewed export/archive?
3. Should raw uploaded documents be stored in Azure Blob Storage, or should raw
   documents stay outside the MVP runtime?
