# Azure UAT, Production Hardening, and Data Roadmap

Status: proposed execution roadmap, 24 September 2026
Parent roadmap: [Azure Production Roadmap](./azure-production-roadmap.md)
UAT cutover record: [Azure Static Web Apps UAT cutover](./azure-static-web-app-uat-cutover.md)

## Purpose

This document updates the production roadmap with the Azure capabilities that
are already live, the hardening work that can be performed before introducing a
production database, and the target storage model for OKF knowledge increments,
agent configuration, graph data, source evidence, and vector retrieval.

The architectural rule is:

> Azure is the production runtime source of truth. GitHub remains the reviewed
> source, release history, deployment source, and controlled export archive.
> Runtime services must not create a two-way, multi-master data flow between
> Azure and GitHub.

Actor Twin remains the only user-facing chat. n8n remains the live agent
orchestration layer. The backend owns authorization, persistence contracts, and
durable state.

## Confirmed Current State

### Already implemented

- Azure Static Web App `intellectual-twin` hosts the primary UAT frontend at
  `https://victorious-flower-0f10a8303.6.azurestaticapps.net`.
- GitHub Pages remains the customer sandbox rather than the production runtime.
- Entra ID authentication and protected Static Web App routes are configured.
- The Static Web App is linked to App Service `meids-backend-1853a19b`.
- The backend has a system-assigned managed identity and Key Vault references.
- GitHub Actions deploys the frontend to Azure Static Web Apps and the backend
  to Azure App Service.
- Azure AI Search `srch-intellectual-twin` is available as the vector/search
  projection.
- Storage account `steraxknowledge1853a19b` and Key Vault
  `Intellectual-twin-vault` exist.
- Actor Twin uses the public n8n embedded-chat endpoint and calls specialist
  workflows through n8n workflow tools.
- The backend exposes `/api/health`; database-aware readiness can be added when
  PostgreSQL is introduced.

### Live hardening gaps found on 24 September 2026

| Area | Current state | Production implication |
| --- | --- | --- |
| App Service transport | `httpsOnly=false` | Direct HTTP remains possible. |
| App Service availability | Basic B1, one instance, `alwaysOn=false` | Cold starts and no instance redundancy. |
| Health monitoring | No Azure health-check path configured | Azure cannot remove an unhealthy instance automatically. |
| Backend protocol/session | HTTP/2 off, ARR affinity on | Lower efficiency and unnecessary stickiness for a stateless API. |
| Observability | No Application Insights or Log Analytics workspace in the resource group | No centralized Azure telemetry, alerts, or diagnostic retention. |
| Storage recovery | Blob soft delete off, container soft delete off, versioning off | Accidental overwrite or deletion has no Azure-native recovery layer. |
| Search identity | Public endpoint, local API-key auth enabled, no managed identity | Wider exposure and long-lived credential dependency. |
| Key Vault | Public endpoint, purge protection off, no diagnostic setting | Weaker deletion protection and limited audit visibility. |
| Resource governance | Most resources have no common tags | Weak cost, ownership, and lifecycle reporting. |
| Environment isolation | UAT and planned production resources are not yet separated | UAT changes could affect production if promoted in place. |

These are configuration findings, not evidence of a current breach or outage.
Network restrictions and authentication changes must be staged and tested so
they do not interrupt n8n, GitHub Actions, or Static Web App backend traffic.

### Execution update: 24 September 2026

The first UAT hardening package has been applied:

- App Service now enforces HTTPS, TLS 1.2+, HTTP/2, disabled FTPS, Always On,
  stateless routing, and `/api/health` platform monitoring.
- `WEBSITE_HEALTHCHECK_MAXPINGFAILURES=5` limits false-positive instance removal.
- The Azure health metric reported `100`, and the authenticated Azure frontend
  remained available after the restart.
- Log Analytics `log-meids-uat-weu` and workspace-based Application Insights
  `appi-meids-uat-weu` are live with 30-day UAT retention.
- Backend, Key Vault, Azure AI Search, and Blob diagnostics now flow to the Log
  Analytics workspace.
- Email alerts cover backend 5xx bursts, sustained latency above five seconds,
  and failed health checks.
- Blob versioning, blob soft delete, and container soft delete are enabled with
  14-day UAT retention. A delete-and-version-restore drill passed.
- Core Me.IDs resources now carry application, environment, component, owner,
  and data-classification tags.
- The backend managed identity has UAT-scoped `Search Index Data Contributor`
  and `Storage Blob Data Contributor` grants. Credential-based Search access is
  still active until comparison testing proves the managed-identity path.
- An authenticated Actor Twin chat probe returned the expected response through
  the Azure Static Web App and published n8n chat workflow.

Evidence: [Azure UAT hardening evidence, 24 September 2026](../uat/azure-hardening-evidence-20260924.md).

## Work Codex Can Perform Directly

The following work can be executed with the current repository and Azure owner
access. Items that change availability, cost, tenant policy, or retention are
prepared first and applied only after the decision gate in the next section.

### P0: Establish the safety baseline

1. Create an Azure resource inventory and configuration snapshot with no secret
   values.
2. Apply common tags: `application=meids`, `environment=uat|prod`, `component`,
   `owner`, `data-classification`, and `cost-center` once values are confirmed.
3. Enforce HTTPS-only, TLS 1.2+, and FTPS disabled on the Me.IDs backend.
4. Configure `/api/health` as the App Service health-check path.
5. Disable ARR affinity after confirming the backend stores no browser session
   in process memory.
6. Verify frontend CORS allowlists contain only the Azure UAT/production domains
   and the intentional GitHub Pages sandbox.
7. Add a public-safe deployment evidence artifact containing commit SHA,
   deployment target, health result, and timestamp.

Acceptance criteria:

- HTTP redirects to HTTPS and API calls remain successful through the linked
  Static Web App.
- Azure health check reports healthy for at least 30 minutes.
- Actor Twin chat and authenticated backend operations pass the UAT smoke suite.
- No credential value appears in build logs or committed artifacts.

### P1: Add observability and actionable alerts

1. Create a Log Analytics workspace and Application Insights resource for UAT.
2. Connect Application Insights to `meids-backend-1853a19b`.
3. Enable diagnostic settings for App Service, Key Vault, Static Web Apps where
   supported, Azure AI Search, and Storage.
4. Add structured fields to backend logs: `trace_id`, `request_id`, `tenant_id`,
   `twin_id`, `workflow_id`, `agent_id`, `operation`, `duration_ms`, and status.
   Do not log prompt bodies, uploaded document contents, access tokens, or keys.
5. Create alerts for backend 5xx rate, failed health checks, p95 latency, n8n
   upstream failures/timeouts, Key Vault access failures, and Search throttling.
6. Create an operations workbook covering frontend availability, backend health,
   agent handoff latency, ingestion failures, and indexing backlog.

Acceptance criteria:

- A test request can be followed from frontend/backend correlation ID to the
  relevant n8n trace.
- A synthetic failure creates an alert and contains enough context to triage it.
- Retention and redaction settings are documented.

### P2: Add recovery controls before durable production data

1. Enable blob soft delete, container soft delete, and blob versioning on the
   selected UAT storage account.
2. Add lifecycle policies for raw, normalized, snapshot, and audit containers.
3. Enable Key Vault purge protection after confirming the operational recovery
   policy; this setting is intentionally difficult to reverse.
4. Export sanitized n8n workflow definitions on a schedule and validate imports
   in a non-production workflow project.
5. Add restore drills for Blob, Key Vault metadata, agent-config releases, and
   the future PostgreSQL backup chain.

Acceptance criteria:

- A deleted test blob and an overwritten test snapshot can be restored.
- A sanitized workflow export can be imported and pass contract validation.
- Recovery point objective (RPO) and recovery time objective (RTO) are recorded.

### P3: Harden identity and deployments

1. Replace Azure AI Search API-key use with managed identity and Azure RBAC after
   confirming every backend operation is supported by its assigned data role.
2. Disable local Search authentication only after managed-identity UAT succeeds.
3. Replace long-lived GitHub deployment secrets with GitHub Actions OpenID
   Connect/workload identity where supported.
4. Add protected GitHub environments for UAT and production, concurrency guards,
   required checks, and an explicit production promotion step.
5. Introduce Bicep modules for the existing frontend, backend, observability,
   Key Vault, Storage, Search, identities, role assignments, and diagnostics.
6. Add an infrastructure drift check that reports differences without making
   automatic production changes.

Acceptance criteria:

- Backend Search operations succeed without a Search API key.
- Deployment jobs obtain short-lived Azure credentials.
- A new environment can be reproduced from Bicep plus environment parameters.

### P4: Harden runtime performance and agent interaction

1. Run fresh probes for Actor Twin and every callable workflow-tool subagent.
2. Set per-hop timeouts and compact fallback summaries for nested n8n calls.
3. Propagate one correlation ID through Actor Twin, subagents, backend, Search,
   and the future outbox worker.
4. Remove `continueOnFail` where it can hide contract or persistence failures.
5. Keep Learning Agent post-turn and asynchronous for normal trace learning.
6. Load test chat, retrieval, ingestion, duplicate-check, and review workflows.
7. Set production SLOs only after fresh samples are available.

Acceptance criteria:

- A failed subagent returns a bounded user-safe fallback and a traceable error.
- No normal chat request waits for Learning Agent completion.
- p50/p95 latency and timeout budgets are documented per workflow hop.

## Decisions or Admin Actions Still Required

Codex can prepare configuration, scripts, tests, and exact change sets, but these
items require a business, tenant, security, or cost decision:

| Decision | Why it is needed |
| --- | --- |
| Separate production resource names and subscription/resource-group layout | Production should not share mutable state or capacity with UAT. |
| App Service production SKU, instance count, zone redundancy, and budget | Basic B1 cannot provide the recommended production availability model. |
| Custom domain `intellectual-twin.eraneos.com` and DNS ownership | Requires corporate DNS and certificate coordination. |
| Conditional Access, MFA, guest lifecycle, and access-review policy | Tenant administrators own identity policy for internal and invited external users. |
| Private endpoints/VNet/DNS design | Search, Storage, Key Vault, and PostgreSQL network isolation must be designed as one topology. |
| Log, trace, source, and evidence retention | Retention depends on privacy, legal, and operational policy. |
| Immutable-storage scope | WORM/legal hold should be limited to evidence or audit classes that actually require it. |
| PostgreSQL SKU, HA mode, backup retention, and geo-recovery | These choices affect cost, RPO, RTO, and availability. |
| Azure OpenAI embedding model, dimensions, quota, and region | The index schema and reindex plan depend on this decision. |
| Final review roles and OKF promotion policy | Determines who may approve, reject, merge, or publish knowledge. |

## Target Azure Data Architecture

### Storage responsibilities

| Data class | Azure runtime source of truth | Derived/read model | GitHub role |
| --- | --- | --- | --- |
| Twin, tenant, user, and role mappings | PostgreSQL | Backend API/cache | Schema and migration source only |
| Current OKF concepts | PostgreSQL | Azure AI Search approved/working indexes | Reviewed export snapshots |
| OKF revisions and status transitions | PostgreSQL append-only revision tables | Review cockpit views | Controlled audit/release exports |
| Evidence metadata and citations | PostgreSQL | Search filters and graph projection | Optional reviewed manifests |
| Raw uploads, transcripts, audio | Azure Blob Storage | Normalized/chunked derivatives | Never commit runtime uploads |
| Derived OKF snapshots | Azure Blob Storage | Search indexing source when useful | Approved snapshot export only |
| Graph nodes and edges | PostgreSQL first | Graph API and Search metadata | Periodic reviewed graph export |
| Search chunks and embeddings | PostgreSQL/Blob source records | Azure AI Search | Index schema only; vectors are not committed |
| Active agent release pointer | PostgreSQL registry or Azure App Configuration | Backend/n8n config cache | Reviewed source and release history |
| Full agent prompt/tool release bundle | Versioned Blob container | Backend retrieval endpoint | Canonical reviewed source |
| n8n live workflows | n8n | Scheduled sanitized export | Canonical sanitized backup/export |
| Domain traces and approvals | PostgreSQL | Review/trace cockpit | No routine runtime export |
| Platform logs and metrics | Application Insights/Log Analytics | Workbooks and alerts | No runtime copy |
| Secrets | Key Vault | App Service Key Vault references | Names/documentation only, never values |

### PostgreSQL role

Azure Database for PostgreSQL Flexible Server becomes the transactional source
for state that must be queried, related, approved, or changed atomically.

Initial schema domains:

- `identity`: tenants, users, memberships, roles, twins, twin ownership.
- `knowledge`: concepts, concept revisions, evidence metadata, source links,
  review decisions, merge/supersession links, and quality scores.
- `graph`: nodes, edges, provenance, validity windows, and review state.
- `agents`: agent definitions, config releases, active-version pointers, skill
  definitions, task-agent bindings, and approval state.
- `operations`: workflow runs, traces, approvals, outbox events, idempotency
  keys, indexing status, and dead-letter records.

Every runtime write includes `tenant_id`, `twin_id`, a stable object ID, version,
content hash, actor, correlation ID, and timestamps. Optimistic concurrency
prevents silent overwrites.

### Blob Storage role

Use Blob Storage for large or immutable payloads rather than placing binary or
document bodies in PostgreSQL.

Recommended containers:

- `source-raw`: original uploads, transcripts, and audio.
- `source-normalized`: extracted text and normalized source packages.
- `okf-snapshots`: canonical serialized OKF revisions.
- `evidence`: supporting evidence payloads and manifests.
- `agent-config-releases`: immutable versioned prompt/tool release bundles.
- `audit-exports`: production audit and recovery exports.
- `quarantine`: rejected or malware-scan-pending uploads.

All containers remain private. The backend uses managed identity. Enable blob
and container soft delete, versioning, lifecycle management, and diagnostic
logging. Apply immutable retention only to the approved evidence/audit subset
after policy approval.

### Azure AI Search role

Azure AI Search is a rebuildable retrieval projection, not the authoritative
knowledge database.

Maintain separate logical views or indexes for:

- `working`: `review_needed`, `updated`, and draft content visible only to the
  review workflow.
- `approved`: knowledge eligible for Actor Twin answers and approved skill use.

Each indexed chunk carries `tenant_id`, `twin_id`, concept ID, revision ID,
source/evidence references, review status, content hash, ACL/filter fields,
embedding model/version, and indexing timestamp. Retrieval must filter by
tenant, twin, authorization, and approved state before semantic ranking.

Azure AI Search supports incremental Blob indexing and integrated vectorization,
but production still needs an explicit idempotent event path so database writes,
review promotion, deletion, and merge decisions cannot drift from the index.

### Agent configuration role

Do not store the only active copy of agent instructions inside an n8n node or a
GitHub branch. Use a release process:

1. Review prompt, tool-description, and workflow-source changes in the
   `meids-agent-configs` repository.
2. CI validates contracts, sanitizes workflow exports, creates a release bundle,
   computes a content hash, and signs or records build provenance.
3. Publish the immutable bundle to `agent-config-releases` in Blob Storage.
4. Register the release and approval state in PostgreSQL.
5. Store only the small active-version pointer and rollout feature flags in
   PostgreSQL or Azure App Configuration.
6. Backend and n8n resolve the approved release through a backend endpoint and
   cache it with a short TTL.
7. Rollback changes the active pointer to a previously approved release.

Azure App Configuration is suitable for feature flags, labels, and active
version pointers. It must not replace Key Vault for secrets or Blob/PostgreSQL
for full prompts and documents.

## OKF Knowledge Increment Flow

1. **Ingest:** Backend stores the raw source in Blob and calculates source and
   content hashes. An idempotency key prevents replayed uploads.
2. **Structure:** Knowledge Fabric creates a candidate concept or concept delta.
3. **Check:** Backend evaluates duplicate/merge evidence using vector similarity,
   graph relationships, stable identifiers, and exact content hashes.
4. **Commit:** One database transaction writes the concept revision, evidence
   metadata, review state (`review_needed` or `updated`), and an outbox event.
5. **Project:** A worker consumes the outbox event, writes a canonical Blob
   snapshot, and upserts the working Search index.
6. **Review:** The Knowledge cockpit approves, rejects, merges, or requests a
   revision. Every decision records actor, reason, and prior/new version.
7. **Promote:** Approval creates another outbox event that updates the approved
   Search index and graph projection.
8. **Export:** An approval-triggered or scheduled job opens a pull request with
   sanitized, reviewed OKF snapshots in the knowledge-fabric repository.
9. **Reconcile:** A scheduled job compares PostgreSQL versions, Blob hashes, and
   Search document versions; mismatches enter a dead-letter/recovery queue.

GitHub does not write directly back into production during normal operation. A
GitHub-to-Azure import is an explicit, validated, operator-approved release path
with dry-run, diff, backup, and rollback.

## Reliable Change Propagation

Start with a PostgreSQL transactional outbox plus an App Service worker or Azure
Function. This keeps the concept write and the request to update Blob/Search in
one transaction without requiring a distributed transaction.

Add Azure Service Bus later when throughput, independent consumers, retries, or
cross-service decoupling justify it. Every consumer must be idempotent and store
the event/version it has applied.

## Production Build Order

### Phase A: Harden current UAT before adding data services

- Complete P0-P4 above.
- Capture a UAT performance and reliability baseline.
- Freeze public contracts for concepts, evidence, reviews, graph, agent config,
  and trace correlation.
- Produce Bicep for the existing UAT platform.

Exit gate: Azure UAT passes functional, security, recovery, and observability
checks without relying on browser-local persistence for production claims.

### Phase B: Create an isolated production foundation

- Create production resource group/naming, App Service plan, backend, Static Web
  App, Key Vault, Storage, Search, identities, App Configuration, Log Analytics,
  and Application Insights from Bicep.
- Configure private networking according to the approved topology.
- Configure Entra ID, guest access, custom domain, and production roles.
- Deploy code with production environment protection and OIDC.

Exit gate: stateless production smoke tests pass; UAT remains independent.

### Phase C: Add PostgreSQL and Blob persistence

- Provision PostgreSQL Flexible Server with chosen HA and retention.
- Apply migrations and tenant/twin row-level authorization strategy.
- Create private Blob containers and protection policies.
- Implement the persistence adapters and transactional outbox.
- Migrate UAT seed data through a validated import, not direct file copying.

Exit gate: create/update/review/restore tests pass against Azure persistence.

### Phase D: Activate semantic knowledge retrieval

- Select and deploy the Azure OpenAI embedding model.
- Confirm dimensions and create versioned Search index schemas.
- Disable deterministic vectors in production.
- Backfill approved and working indexes from PostgreSQL/Blob.
- Calibrate duplicate/merge thresholds with labelled UAT examples.
- Test tenant/twin filters, citations, deletions, merges, and full rebuild.

Exit gate: Search is reproducible from authoritative stores and never returns
cross-tenant or unapproved content.

### Phase E: Move active knowledge and agent configuration off GitHub runtime

- Publish reviewed agent release bundles to Blob and register them in PostgreSQL.
- Resolve active versions through backend APIs/App Configuration pointers.
- Change Knowledge Fabric runtime writes to PostgreSQL/Blob/outbox.
- Keep GitHub exports one-way and pull-request based.
- Reconcile n8n live workflows with sanitized repository exports.

Exit gate: deleting a runtime GitHub token does not stop normal chat, retrieval,
ingestion, review, or skill execution.

### Phase F: Production promotion and operations

- Run load, failover, restore, security, and guest-access tests.
- Complete data-protection and threat-model review.
- Establish SLOs, alert ownership, runbooks, on-call process, and cost budgets.
- Execute a rehearsed cutover and rollback plan.
- Monitor the first production period with elevated telemetry and daily review.

## Immediate Recommended Execution Queue

1. Capture and commit a sanitized Azure configuration baseline and Bicep plan.
2. Apply the low-risk P0 transport and health settings in UAT, then rerun Actor
   Twin and backend smoke tests.
3. Create Log Analytics and Application Insights and connect diagnostics.
4. Add alerts, correlation IDs, and a UAT operations workbook.
5. Enable Storage recovery controls and perform a restore drill.
6. Prepare managed-identity Search access; switch only after a successful UAT
   comparison against key-based access.
7. Harden GitHub deployments with environments and OIDC.
8. Run fresh n8n workflow-tool probes, latency tests, and failure injection.
9. Confirm production naming, SKU, network, retention, and embedding decisions.
10. Start Phase B, followed by the planned PostgreSQL and vector-database work.

## Microsoft Guidance Used

- [Azure App Service architecture best practices](https://learn.microsoft.com/en-us/azure/well-architected/service-guides/app-service-web-apps)
- [App Service health checks](https://learn.microsoft.com/en-us/azure/app-service/monitor-instances-health-check)
- [Azure Static Web Apps authentication and authorization](https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-authorization)
- [Deploy App Service with GitHub Actions and OIDC](https://learn.microsoft.com/en-us/azure/app-service/deploy-github-actions)
- [Azure Blob Storage data protection](https://learn.microsoft.com/en-us/azure/storage/blobs/secure-blobs)
- [Blob soft delete](https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-blob-overview)
- [Blob lifecycle management](https://learn.microsoft.com/en-ca/azure/storage/blobs/lifecycle-management-overview)
- [Immutable Blob Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/immutable-storage-overview)
- [Azure AI Search integrated vectorization](https://learn.microsoft.com/en-us/azure/search/vector-search-integrated-vectorization)
- [Index data from Azure Blob Storage](https://learn.microsoft.com/en-us/azure/search/search-how-to-index-azure-blob-storage)
- [Azure App Configuration security](https://learn.microsoft.com/en-us/azure/azure-app-configuration/secure-azure-app-configuration)
- [Azure Database for PostgreSQL high availability](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-high-availability)

## Clarifications to Confirm Before Production Provisioning

1. Use a separate production resource group and separate data services, with the
   current resources retained as UAT. This roadmap recommends **yes**.
2. Make PostgreSQL the authoritative runtime store for OKF and agent release
   metadata, with GitHub as reviewed export/history. This roadmap recommends
   **yes**.
3. Reuse `steraxknowledge1853a19b` only for UAT and create a separate production
   storage account. This roadmap recommends **yes**.
4. Begin graph persistence in PostgreSQL and defer a dedicated graph database
   until measured traversal requirements justify it. This roadmap recommends
   **yes**.
5. Use a PostgreSQL transactional outbox first and introduce Service Bus only
   when scale or independent consumers require it. This roadmap recommends
   **yes**.
