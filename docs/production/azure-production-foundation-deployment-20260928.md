# Azure production foundation deployment evidence

## Result

The Me.IDs production foundation deployment `meids-prod-foundation-20260928`
completed successfully on 2026-09-28 in `rg-ai-intellectual-twin`. This is a
logically isolated foundation in the current resource group, intended to be
recreated later in a dedicated production resource group from the same Bicep.

## Provisioned resources

| Capability | Resource | Verified state |
| --- | --- | --- |
| App Service plan | `asp-meids-prod-weu` | Premium V3, dedicated |
| Backend | `meids-prod-backend-1853a19b` | Running, system identity, HTTPS only |
| Frontend | `meids-prod-frontend-1853a19b` | Standard Static Web App |
| Search | `srch-meids-prod-1853a19b` | Basic, running, local auth disabled |
| Storage | `stmeidsprod1853a19b` | GRS, TLS 1.2, shared key disabled |
| Key Vault | `kv-meids-prod-1853a19b` | RBAC, soft delete and purge protection |
| Observability | `log-meids-prod-weu`, `appi-meids-prod-weu` | Provisioned |

## Managed identity access

Backend principal `f57f4cde-c475-489b-8c34-ad81c3d66e23` has only these data
roles on the new production resources:

- `Search Index Data Contributor`
- `Storage Blob Data Contributor`
- `Key Vault Secrets User`

Diagnostic settings completed for App Service, Search, Key Vault, and Blob
Storage. The frontend host responds with HTTP 200. The backend health endpoint
returns HTTP 503 as expected because infrastructure has been provisioned but no
backend application package has been released.

## Deployment correction

The first apply exposed an Azure Search API constraint: `authOptions` must be
null when `disableLocalAuth` is true. `infra/azure/main.bicep` now emits the AAD
or API-key auth options only when local authentication remains enabled. The
corrected template compiled, validated, produced no deletes in what-if, and
deployed successfully.

## Promotion gates

1. Deploy and smoke-test the backend package.
2. Bind the frontend repository and protected production deployment workflow.
3. Configure production Key Vault secrets and App Service references.
4. Configure Entra ID access, invited guests, and application roles.
5. Create versioned Search indexes and authoritative persistence stores.
6. Migrate reviewed data; do not copy mutable runtime state directly.
7. Validate n8n endpoints, CORS, traces, recovery, load, and rollback.
8. Bind the approved custom domain and complete cutover.

For the future dedicated production resource group, deploy the same
`main.bicep` with `prod-foundation.bicepparam`, verify it independently, migrate
state through supported export/import paths, and switch DNS only after smoke
and rollback gates pass.
