# Azure infrastructure

This package codifies the current UAT foundation and the proposed isolated
production foundation. It never contains secret values. Runtime secrets remain
in Azure Key Vault and are referenced by App Service settings.

## Validate

```powershell
az bicep build --file infra/azure/main.bicep
az bicep build --file infra/azure/subscription.bicep
az bicep build --file infra/azure/production-data-plane.bicep
az deployment group what-if `
  --resource-group rg-ai-intellectual-twin `
  --template-file infra/azure/main.bicep `
  --parameters infra/azure/uat.bicepparam
az deployment sub what-if `
  --location westeurope `
  --template-file infra/azure/subscription.bicep `
  --parameters infra/azure/prod.bicepparam
```

If subscription-scope deployment rights are unavailable, ask an Azure admin to
create `rg-ai-intellectual-twin-prod` in West Europe and grant the deployment
identity Owner on that resource group. Then validate/deploy `main.bicep` with
`prod-foundation.bicepparam` at resource-group scope.

The initial logically isolated production foundation was deployed on
2026-09-28 into the existing `rg-ai-intellectual-twin` resource group:

```powershell
az deployment group create `
  --name meids-prod-foundation-20260928 `
  --resource-group rg-ai-intellectual-twin `
  --template-file infra/azure/main.bicep `
  --parameters infra/azure/prod-foundation.bicepparam
```

All resources use production-specific names and tags. When the dedicated
production resource group is approved, run the same template and parameters at
that resource-group scope, then migrate data and DNS through the promotion
runbook. Do not move stateful resources in place.

The UAT command is drift analysis only until its output has been reviewed. The
production command is also what-if only until App Service, Search, storage, and
retention SKUs have explicit budget approval.

## Deployment gate

1. UAT managed-identity Search probe is `ready` for both indexes.
2. UAT what-if contains no destructive changes.
3. Production names and region are approved.
4. P1v3, Basic Search, Standard Static Web Apps, and Standard GRS storage costs
   are approved.
5. Entra ID registrations, DNS, GitHub environments, and Key Vault secret
   ownership are assigned.
6. Run production what-if again from the exact commit to deploy or promote.

`uat.bicepparam` mirrors resources inside a shared resource group and references
the existing shared App Service plan. `prod.bicepparam` creates a dedicated plan
and isolated resource group through `subscription.bicep`.
`prod-foundation.bicepparam` creates the same isolated resource set inside an
already approved resource group and remains portable to the future production
resource group.

`production-data-plane.bicep` is the gated first production data package. It
adds private PostgreSQL Flexible Server, delegated application/database
subnets, a dedicated private-endpoint subnet, private DNS, private Search and
Blob endpoints, App Service VNet integration, Entra-only database
authentication, and diagnostics. `main.bicep` keeps Search and Blob public
access disabled when `privateDataPlaneEnabled` is true. Supply an Entra
administrator group and make an explicit HA/geo-backup choice before deploying it. The template is portable
to the future production resource group; stateful resources should be recreated
and migrated rather than moved.

The production-ready parameter file is
`production-data-plane.prod.bicepparam`. It uses the dedicated Entra group
`Me.IDs Production PostgreSQL Administrators`
(`a85b18b9-428a-4169-91e9-c7b1cc0d159e`) and enables zone-redundant HA plus
geo-redundant backup. Before deployment, the network owner must confirm that
`10.42.0.0/16` and its application/database subnets do not overlap with any
connected Azure, VPN, ExpressRoute, or on-premises network.
