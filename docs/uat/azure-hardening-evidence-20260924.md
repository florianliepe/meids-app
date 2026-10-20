# Azure UAT Hardening Evidence - 24 September 2026

Roadmap: [Azure UAT, Production Hardening, and Data Roadmap](../production/azure-uat-production-hardening-and-data-roadmap.md)

## Scope

This record covers the first reversible UAT hardening package. It contains no
secret values. It does not claim production readiness or change n8n workflow
definitions, database behavior, private networking, or the production SKU.

## Azure Targets

| Component | Resource |
| --- | --- |
| Resource group | `rg-ai-intellectual-twin` |
| Static frontend | `intellectual-twin` |
| Backend | `meids-backend-1853a19b` |
| Storage | `steraxknowledge1853a19b` |
| Search | `srch-intellectual-twin` |
| Key Vault | `Intellectual-twin-vault` |
| Log Analytics | `log-meids-uat-weu` |
| Application Insights | `appi-meids-uat-weu` |
| Alert action group | `ag-meids-uat-ops` |

## Applied Changes

### Backend transport and health

| Setting | Before | After |
| --- | --- | --- |
| HTTPS-only | Off | On |
| TLS minimum | 1.2 | 1.2 |
| FTPS | FTPS only | Disabled |
| HTTP/2 | Off | On |
| Always On | Off | On |
| ARR affinity | On | Off |
| Health path | None | `/api/health` |
| Failed health pings before exclusion | Default | 5 |

App Service Easy Auth continues to protect direct backend requests. An anonymous
direct request returns `401`; HTTP redirects to HTTPS. Azure's platform health
integration reached the protected route and emitted `HealthCheckStatus=100`.

### Storage recovery

- Blob versioning enabled.
- Blob soft-delete retention set to 14 days.
- Container soft-delete retention set to 14 days.
- Dedicated private test container: `meids-uat-recovery-drill`.
- Drill object: `restore-check-20260924.txt`.
- Drill result: delete created recoverable versions; the prior version was
  downloaded, content-verified, and promoted as the current version.

The signed-in UAT operator received `Storage Blob Data Contributor` at the
storage-account scope for the drill. No storage account key was retrieved.

### Observability

- Workspace `log-meids-uat-weu` created in West Europe with 30-day retention.
- Workspace-based Application Insights `appi-meids-uat-weu` created and connected
  to the backend through an App Service setting.
- Diagnostic settings created:
  - `diag-meids-backend-uat`
  - `diag-meids-vault-uat`
  - `diag-meids-search-uat`
  - `diag-meids-blob-uat`
- Initial ingestion confirmed:
  - 9 `AppRequests` records.
  - 71 `AppServiceConsoleLogs` records.
- Backend metrics during the validation window:
  - HTTP 5xx: 0.
  - Average response time: approximately 0.08 to 0.13 seconds.
  - Health check: 100.

### Alerts

| Alert | Severity | Condition |
| --- | --- | --- |
| `alert-meids-uat-backend-http5xx` | 2 | More than 5 HTTP 5xx responses in 5 minutes |
| `alert-meids-uat-backend-latency` | 3 | Average response time above 5 seconds for 5 minutes |
| `alert-meids-uat-backend-health` | 1 | Health-check average below 1 for 5 minutes |

Alerts use the common alert schema and notify the Azure account operator through
`ag-meids-uat-ops`.

### Managed-identity preparation

The backend system-assigned identity now has:

- `Key Vault Secrets User` on the Me.IDs vault (existing).
- `Search Index Data Contributor` on the UAT Search service.
- `Storage Blob Data Contributor` on the UAT storage account.

This prepares comparison testing only. Azure AI Search local authentication and
the current application credential path remain active. They must not be disabled
until identity-based retrieval and indexing pass UAT.

### Resource governance

The frontend, backend, Search, Storage, and Key Vault now use consistent tags:

- `application=meids`
- `environment=uat`
- `component=<resource role>`
- `owner=florian`
- `data-classification=internal|confidential|restricted`

## Functional Validation

| Test | Result |
| --- | --- |
| Azure Static Web App root | HTTP 200 |
| Direct backend HTTP | Redirects to HTTPS |
| Direct backend HTTPS without identity | HTTP 401, expected Easy Auth boundary |
| Authenticated frontend after backend restart | Passed |
| n8n Actor Twin connection indicator | Connected |
| Actor Twin live prompt | Passed |
| Expected response | `AZURE UAT READY` |
| Backend request metric | Present |
| Backend 5xx metric | Zero in validation window |
| Azure health metric | 100 |
| Blob delete/restore drill | Passed |
| Log Analytics ingestion | Passed |

## Boundaries Deliberately Left Unchanged

- Key Vault purge protection remains off pending the irreversible-change gate.
- Search and Key Vault public network access remain enabled pending the complete
  VNet/private-DNS design.
- Azure AI Search local authentication remains enabled.
- The Basic B1 single-instance App Service plan remains unchanged.
- UAT and production resources are not yet isolated.
- No PostgreSQL production database, outbox worker, or production Blob container
  structure has been provisioned.
- No deterministic-vector setting was changed.
- No production domain, DNS record, or Conditional Access policy was changed.

## Next Gated Actions

1. Compare backend Search retrieval and upsert using managed identity, then remove
   the Search key from the application path and disable local Search auth.
2. Confirm production resource group, naming, App Service SKU, instance count,
   and cost budget.
3. Approve Key Vault purge protection and retention policy.
4. Approve the private endpoint/VNet/private DNS topology for backend, Search,
   Storage, Key Vault, PostgreSQL, and Azure OpenAI.
5. Add Bicep modules and drift reporting before creating production resources.
6. Provision isolated production observability and platform resources.
7. Provision PostgreSQL and the authoritative Blob container structure.
8. Configure Azure OpenAI embeddings and rebuildable approved/working Search
   indexes only after the authoritative stores are live.
