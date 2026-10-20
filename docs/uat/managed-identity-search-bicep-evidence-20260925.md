# Managed-identity Search and Bicep evidence

Date: 2026-09-25

## UAT managed-identity validation

- Backend: `meids-backend-1853a19b`
- Managed identity: system-assigned
- Search: `srch-intellectual-twin`
- Role: `Search Index Data Contributor`
- Runtime mode: `AZURE_SEARCH_AUTH_MODE=managed_identity`
- Search API key removed from the backend App Service settings after validation.
- Easy Auth remained enabled during the final validation.

The initial index-statistics probe returned `403`. This was expected for a
least-privilege document role because index statistics require broader service
metadata permissions. The readiness probe was changed to execute the same
document query operation used by the runtime.

Final sanitized App Service probe:

```json
{
  "event": "azure_search_startup_probe",
  "status": "ready",
  "authentication": "managed_identity",
  "indexes": {
    "approved": {
      "name": "meids-okf-approved-v1",
      "status": "ready",
      "validation": "document_query",
      "document_count": 2
    },
    "working": {
      "name": "meids-okf-working-v1",
      "status": "ready",
      "validation": "document_query",
      "document_count": 0
    }
  }
}
```

The one-shot startup probe was disabled after evidence capture. UAT Search local
authentication remains enabled as a migration fallback, but the backend no
longer receives the admin key. Production Bicep disables Search local auth.
After cleanup, App Service reported `Running` / `Normal` and five consecutive
five-minute `HealthCheckStatus` samples at 100%.

## Runtime hardening added

- App Service managed-identity token requests use native HTTP, bounded timeout,
  one shared in-flight request, and bounded retry/backoff.
- Azure AI Search requests use native HTTPS with a 10-second timeout.
- Managed-identity readiness validates document access instead of requiring a
  broader Search service role.
- UAT container startup allowance is 600 seconds because the current shared B1
  plan showed 140-230 second cold-start behavior. Production sizing must not
  copy this constraint without load/startup testing.

## UAT Bicep result

- `infra/azure/main.bicep` compiled successfully.
- Resource-group validation succeeded.
- UAT what-if succeeded.
- Existing RBAC assignment IDs and diagnostic setting names are adopted through
  UAT parameters, so the final what-if proposes no duplicate creations.
- Full UAT what-if reports property drift on 15 resources. It was not applied;
  this remains a review/adoption gate in the shared resource group.

## Production foundation result

- `infra/azure/subscription.bicep` compiled successfully.
- `infra/azure/main.bicep` with `prod-foundation.bicepparam` passed Azure
  resource-group validation.
- A safe what-if against the current authorized scope proposed 17 isolated
  resource creations and no deployment was executed.
- The intended target resource group is `rg-ai-intellectual-twin-prod` in West
  Europe.
- Production defaults currently model P1v3 App Service, Basic Search, Standard
  Static Web Apps, Standard GRS storage, Key Vault purge protection, managed
  identity, diagnostics, and disabled Search/storage local-key access.

## Remaining authorization and approval gate

Subscription-scope validation failed because the current user does not have
`Microsoft.Resources/deployments/validate/action` at subscription scope. Use
the least-privilege route:

1. Azure admin creates `rg-ai-intellectual-twin-prod` in West Europe.
2. Azure admin grants the deployment identity Owner on that resource group.
3. Approve the proposed production SKUs and budget.
4. Run `main.bicep` with `prod-foundation.bicepparam` in the new resource group.

Alternatively, grant a controlled deployment identity subscription-scope rights
to create resource groups and validate/execute deployments. No production
resource was created in this package.
