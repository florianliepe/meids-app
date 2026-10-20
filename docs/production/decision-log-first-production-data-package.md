# Decision Log: First Production Data Package

Date: 2026-10-19

| ID | Decision | Rationale | Status |
| --- | --- | --- | --- |
| D-001 | PostgreSQL is the transactional source of truth. | Review state, revision lineage, access grants, and outbox creation need atomic consistency. | Accepted |
| D-002 | Azure AI Search is a rebuildable projection, split into working and approved indexes. | This prevents unreviewed knowledge from leaking into normal Actor Twin retrieval and permits deterministic rebuilds. | Accepted |
| D-003 | Blob Storage holds immutable source and rendered revision artifacts; PostgreSQL stores metadata and canonical structured content. | Large artifacts and version recovery belong in object storage, while relational state and authorization remain queryable and transactional. | Accepted |
| D-004 | n8n orchestrates agents but does not persist canonical domain state. | It reduces split-brain behavior and keeps retries, audit, and review semantics in one backend boundary. | Accepted |
| D-005 | Knowledge and learning writes default to `review_needed`; only an explicit reviewer action produces an approved projection. | Human review remains the publication gate without blocking automatic capture and structuring. | Accepted |
| D-006 | Search index deployment uses Microsoft Entra/Azure CLI for operators and managed identity for runtime. | Local/admin keys remain disabled and secrets do not enter scripts or logs. | Accepted |
| D-007 | Lifecycle automation deletes only disposable quarantine/export data; approved knowledge is not automatically expired. | Retention for approved intellectual capital requires an explicit governance decision. | Accepted |
| D-008 | Same-zone HA remains in service until zone-redundant HA is proven available in West Europe. | Availability improves without risking a destructive PostgreSQL replacement when zonal capacity is constrained. | Accepted exception; validated 2026-10-19 |
| D-009 | Private endpoints for Storage and Search are a launch gate, not bundled into the isolated data-package deployment. | A dedicated endpoint subnet and private DNS design must be added without mutating delegated app/database subnets. | Deferred launch gate |
| D-010 | Machine-facing knowledge write endpoints use short-lived signed knowledge-access tokens and remain outside the App Service browser-login redirect. | n8n cannot complete an interactive Entra browser login. Signed claims preserve tenant, user, twin, role, and visibility scope while other backend routes remain protected by Easy Auth. | Accepted |
| D-011 | Caller-supplied vectors are allowed for controlled UAT only; deterministic hash vectors remain disabled in production. | Synthetic vectors prove the data path but are not semantically valid retrieval embeddings. Production Search completeness requires an approved embedding provider and backfill. | Accepted, embedding provider pending |
| D-012 | Runtime managed identities receive data-plane roles; the human operator is not granted routine Blob or Search document-reader access. | This preserves least privilege while letting App Service project artifacts and documents. Operational evidence comes from signed application probes and audit state. | Accepted |
| D-013 | n8n production workflow changes must use the publish endpoint, not only the legacy activate endpoint. | n8n separates autosaved drafts from published versions; activation alone left production webhooks on an older history snapshot. | Accepted |
| D-014 | If no real embedding is available, the outbox completes the Blob artifact projection and records Search as `deferred_missing_embedding` for later backfill. | Durable capture must not dead-letter merely because the derived vector projection is temporarily unavailable. | Accepted |
| D-015 | Same-zone PostgreSQL HA is the current production exception. | The server is healthy with geo-redundant backup and 35-day retention. A fresh 2026-10-19 request for standby zone 2 was rejected because this location exposes only one availability zone to the subscription. | Accepted exception; recheck before public launch |
| D-016 | Search rebuild is an authorized backend operation sourced from PostgreSQL, not an operator-side Search-key script. | PostgreSQL remains canonical, RLS and signed twin assignments constrain the source rows, and the App Service managed identity owns the Search data-plane write. | Accepted; live rebuild passed |
| D-017 | Point-in-time restore drills use a disposable private PostgreSQL server and a VNet-hosted validation probe. | The production server is untouched, private networking is exercised, restored data is counted without export, and the temporary server is deleted after evidence capture. | Accepted; first drill passed |

## Variable choices

- Containers: `knowledge-sources`, `okf-working`, `okf-approved`, `learning-artifacts`, `quarantine`, `exports`.
- Search indexes: `meids-okf-working-v1`, `meids-okf-approved-v1`.
- Default review state: `review_needed`.
- Outbox claim batch: 25 events; small enough for bounded App Service work and large enough to amortize connection overhead.
- Outbox maximum attempts: 8; retries are visible and finite before dead-letter handling.
- Quarantine retention: 30 days; exports retention: 90 days; non-current versions: 90 days.

## Open decisions requiring human validation

1. Approved-knowledge legal retention and deletion policy.
2. Final production custom domain and Entra access policy.
3. Whether Search/Storage public endpoints may remain enabled during controlled UAT before private endpoints are completed.
4. Approved production embedding provider, endpoint, deployment name, dimensions, and credential/managed-identity policy. Existing UAT vectors prove the path but do not satisfy semantic-production quality.
5. Maintenance window for recovery or restart of the n8n publication worker, which currently leaves the editor in `Publishing...` after API-driven version publication.
