# Zielmodus: Managed-identity Search and production foundation

## Ziel

Prove that the Me.IDs backend reaches Azure AI Search with its system-assigned
managed identity, codify the current UAT foundation in Bicep, and prepare an
isolated production foundation without creating billable production resources
before SKU and budget approval.

## Package 1: managed-identity Search validation

1. Assign `Search Index Data Contributor` to the backend managed identity.
2. Run Search with `AZURE_SEARCH_AUTH_MODE=managed_identity`.
3. Bound token and Search requests with explicit timeouts.
4. Execute an internal startup probe and capture sanitized readiness evidence.
5. Keep Easy Auth enabled throughout validation.
6. Disable the startup probe after evidence capture.

Exit gate: both approved and working indexes report `ready`, or the remaining
platform blocker is isolated and documented with status codes and ownership.

## Package 2: UAT Bicep coverage

1. Model the existing backend, Static Web App, Search, storage, Key Vault,
   managed-identity RBAC, Log Analytics, Application Insights, and diagnostics.
2. Reference the existing shared UAT App Service plan instead of recreating it.
3. Keep secret values out of Bicep and preserve Key Vault as the secret source.
4. Compile Bicep and run group-level what-if.
5. Record all drift; do not apply destructive UAT changes automatically.

Exit gate: templates compile and what-if is reviewed.

## Package 3: isolated production foundation

1. Prepare subscription-scope deployment for `rg-ai-intellectual-twin-prod` in
   West Europe.
2. Use a dedicated App Service plan, backend identity, Search service, storage,
   vault, Static Web App, and observability resources.
3. Enforce managed identity and disable storage shared-key access.
4. Enable Key Vault purge protection and production diagnostics.
5. Run subscription-level what-if only.

Exit gate: explicit human approval of production SKUs/budget, naming, DNS,
Entra ID, and secret ownership. Only then may the production deployment run.

### Execution status: foundation deployed

On 2026-09-28 the approved foundation was deployed as logically isolated
production resources inside the existing `rg-ai-intellectual-twin` resource
group. A dedicated production resource group remains the later promotion
target; the Bicep inputs are portable and do not depend on the current group.

- ARM deployment: `meids-prod-foundation-20260928` (`Succeeded`)
- Backend: `https://meids-prod-backend-1853a19b.azurewebsites.net`
- Frontend: `https://ashy-wave-0dbbe8803.5.azurestaticapps.net`
- Search: `https://srch-meids-prod-1853a19b.search.windows.net`
- Key Vault: `https://kv-meids-prod-1853a19b.vault.azure.net/`
- Storage: `stmeidsprod1853a19b`

Deployment verification confirmed managed identity and RBAC, disabled Search
local authentication, disabled Storage shared-key access, TLS 1.2/HTTPS, Key
Vault RBAC and purge protection, and four diagnostic settings. The deployment
also corrected the Search resource contract so `authOptions` is null whenever
`disableLocalAuth` is true.

The foundation is not a live production release yet. The Static Web App has no
repository binding, the backend application package has not been deployed, and
production indexes, secrets, Entra configuration, DNS, and data migration are
still promotion gates.
