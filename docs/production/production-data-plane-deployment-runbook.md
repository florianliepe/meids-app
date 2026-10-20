# Production Data Plane Deployment Runbook

Prepared: 2026-10-06

## Resolved

- Resource group: `rg-ai-intellectual-twin` for the first production stage.
- Region: West Europe.
- PostgreSQL administrator: Entra security group
  `Me.IDs Production PostgreSQL Administrators`.
- Administrator object ID: `a85b18b9-428a-4169-91e9-c7b1cc0d159e`.
- Backend managed-identity object ID: `f57f4cde-c475-489b-8c34-ad81c3d66e23`.
- Backend managed-identity name: `meids-prod-backend-1853a19b`.
- Authentication: Entra-only; no PostgreSQL password.
- Network topology: private VNet injection and App Service VNet integration.
- IaC and parameter compilation: passed.
- Group-backed Azure what-if: passed on 2026-10-06.
- Signing key: created in `kv-meids-prod-1853a19b` after granting the signed-in
  operator the narrowly scoped `Key Vault Secrets Officer` role.
- PostgreSQL server: `psql-meids-prod-1853a19b`.
- PostgreSQL database: `meids_prod`.
- Backend URL: `https://meids-prod-backend-1853a19b.azurewebsites.net`.
- Passwordless runtime probe: passed on 2026-10-06 (`SELECT 1` through the
  backend system-assigned managed identity and private endpoint).
- Schema migrations `001` through `003`: applied on 2026-10-06.
- Twin profile CRUD migrations `004` and `005`: applied on 2026-10-14. The
  runtime role can create and update owned twin profiles, assignments, and the
  persisted active-twin selection without database-admin credentials.
- App Service Key Vault reference for `MEIDS_AUTH_CONTEXT_SIGNING_KEY`:
  `Resolved` on 2026-10-06.
- Production identity seed applied on 2026-10-14:
  - tenant `eraneos`;
  - user `florian`, mapped to Entra object
    `4277841b-d713-47b6-8168-172ac3cde535`;
  - twins `florian` and `lucas`, both assigned with role `owner`;
  - `lucas` is explicitly a demo twin owned by Florian.
- Database-backed authorization enabled on 2026-10-14. A synthetic Static Web
  Apps principal probe resolved both twins from PostgreSQL and returned a signed
  knowledge-access token.
- Azure Static Web App `intellectual-twin` cut over on 2026-10-14 from
  `meids-backend-1853a19b` to `meids-prod-backend-1853a19b`; linked-backend
  provisioning state is `Succeeded`.
- Actor Twin embedded-chat endpoint validated from the Azure frontend origin on
  2026-10-14: CORS preflight `204`, session load `200`, and an Actor Twin
  message response `200` with the expected routing-authority identity.
- Authenticated Twin lifecycle UAT passed on 2026-10-14 against Azure Static
  Web Apps and production PostgreSQL: create, reload, update, activate another
  twin, reactivate the created twin, reload again, and load the persisted
  profile into the editor. Test twin: `twin-crud-uat-20261014`.
- PostgreSQL `pgcrypto` extension: allow-listed through the `azure.extensions`
  server parameter and represented in Bicep.
- Resilience adjustment: West Europe first rejected the combined
  zone-redundant HA and geo-backup storage SKU, then rejected an HA-only retry
  with `HADisabledForRegion`. The deployable first-stage profile therefore uses
  35-day retention and geo-redundant backup without HA. Enable zone-redundant
  HA when regional capacity reopens or during the isolated production move.

## Human Validation Gate

Status: approved on 2026-10-06.

Confirm both decisions before deployment:

1. Network team confirms `10.42.0.0/16` is non-overlapping with connected
   Azure VNets, VPN, ExpressRoute, and on-premises networks. Planned subnets are
   `10.42.1.0/24` for App Service integration and `10.42.2.0/24` for PostgreSQL.
2. Budget owner accepts `Standard_D2ds_v5` and 35-day backup retention. The
   intended zone-redundant HA setting is temporarily unavailable for new West
   Europe servers. Geo-redundant backup is enabled at creation for regional
   recovery; HA activation remains a mandatory hardening follow-up.

Both validations were approved. The PostgreSQL administrator group is
`Me.IDs Production PostgreSQL Administrators`
(`a85b18b9-428a-4169-91e9-c7b1cc0d159e`).

## Deployment

After approval:

```powershell
az deployment group create `
  --name meids-prod-data-plane-20261006 `
  --resource-group rg-ai-intellectual-twin `
  --template-file infra/azure/production-data-plane.bicep `
  --parameters infra/azure/production-data-plane.prod.bicepparam
```

Capture the `databaseHost` output. Do not enable application database traffic
until the bootstrap and isolation tests are complete.

## Passwordless Bootstrap

The database has private networking, so run this from the deployed backend App
Service/Kudu environment after VNet integration is active. Acquire a short-lived
admin token locally immediately before the command:

```powershell
$token = az account get-access-token `
  --resource-type oss-rdbms `
  --query accessToken -o tsv
```

Pass it only to the one-off process as `POSTGRES_ADMIN_ACCESS_TOKEN`. Do not save
it as an App Service setting, Key Vault secret, workflow credential, file, or CI
variable. Execute:

```text
POSTGRES_ADMIN_HOST=<databaseHost>
POSTGRES_ADMIN_USER=Me.IDs Production PostgreSQL Administrators
POSTGRES_ADMIN_ACCESS_TOKEN=<short-lived token>
POSTGRES_RUNTIME_PRINCIPAL_NAME=meids-prod-backend-1853a19b
POSTGRES_RUNTIME_PRINCIPAL_OBJECT_ID=f57f4cde-c475-489b-8c34-ad81c3d66e23
DATABASE_NAME=meids_prod
npm run db:bootstrap:production
```

The script creates the backend managed identity as a non-admin PostgreSQL
principal, applies immutable migrations, grants only `meids_app_runtime`, and
does not persist the token.

## Backend Activation

Set these App Service settings only after bootstrap succeeds:

```text
POSTGRES_AUTH_MODE=managed_identity
DATABASE_HOST=<databaseHost>
DATABASE_PORT=5432
DATABASE_NAME=meids_prod
DATABASE_USER=meids-prod-backend-1853a19b
DATABASE_SSL=true
MEIDS_STORAGE_MODE=postgres
MEIDS_DATABASE_SCHEMA_MANAGED=true
MEIDS_AUTHZ_DATABASE_ENABLED=false
```

The database-backed authorization flag intentionally remains `false` until the
initial tenant, user, and twin assignments are seeded and reviewed. Change it
to `true` only after that gate passes.

Then create Key Vault secret `meids-auth-context-signing-key` from at least 32
random bytes, reference it as `MEIDS_AUTH_CONTEXT_SIGNING_KEY`, and set
`MEIDS_ENFORCE_KNOWLEDGE_AUTH=true` only after Search indexes have been rebuilt
with ACL fields.

The narrow permission required to create/rotate this secret is `Key Vault
Secrets Officer` at the production vault scope. An authorized RBAC administrator
can assign it with:

```powershell
$vaultId = az keyvault show `
  --name kv-meids-prod-1853a19b `
  --query id -o tsv

az role assignment create `
  --assignee-object-id 4277841b-d713-47b6-8168-172ac3cde535 `
  --assignee-principal-type User `
  --role "Key Vault Secrets Officer" `
  --scope $vaultId
```

After the secret is created, remove the temporary human assignment if ongoing
manual secret administration is not required. The backend already has the
runtime `Key Vault Secrets User` role and does not need write access.

## Data Initialization

1. Insert the tenant, initial user, security groups, and twin assignments.
2. Import approved OKF concepts and evidence into PostgreSQL and Blob Storage.
3. Import approved agent releases and user/twin assignments.
4. Rebuild working and approved Azure AI Search indexes with ACL projections.
5. Publish the n8n Knowledge Fabric workflow that forwards the short-lived
   authorization token without exposing it to the model.

## Current Activation Gates

The Azure Static Web App `intellectual-twin` is linked to the production App
Service `meids-prod-backend-1853a19b`. Azure permits only one linked backend per
Static Web App; rollback therefore means unlinking production and relinking
`meids-backend-1853a19b`.

Before enabling database-backed authorization, confirm and seed:

- initial internal tenant ID and display name;
- each production user's Entra object ID and email;
- the production twin IDs owned by or shared with each user;
- each assignment role (`owner`, `editor`, `reviewer`, or `viewer`).

The seed is verified and `MEIDS_AUTHZ_DATABASE_ENABLED=true` is active. Complete
one interactive `/api/session` test through the linked Static Web App. Keep
`MEIDS_ENFORCE_KNOWLEDGE_AUTH=false` until the Search ACL projection is rebuilt
and negative cross-user/twin retrieval tests pass.

### 2026-10-14 production activation evidence

- Entra user `4277841b-d713-47b6-8168-172ac3cde535` maps to the stable internal
  user ID `florian` in tenant `eraneos`.
- Twins `florian` and `lucas` are assigned to that user with role `owner`.
  `lucas` is intentionally a demo twin; this avoids creating a synthetic Entra
  identity while retaining normal tenant/twin authorization checks.
- The Azure Static Web App is linked to `meids-prod-backend-1853a19b` with
  provisioning state `Succeeded`.
- App Service Authentication has `azureStaticWebApps.enabled=true`, requires
  authentication, and names
  `victorious-flower-0f10a8303.6.azurestaticapps.net` as the linked client.
- Direct backend requests return `401`, including requests carrying a forged
  `x-ms-client-principal` header. Anonymous `/api/session` through the Static
  Web App returns the intended application-level `401` response with the Entra
  login URL.
- The n8n Actor Twin chat endpoint accepts the Azure frontend origin, session
  initialization succeeds, and the four-case chat UAT passes.
- Production alerts monitor HTTP 5xx volume, average response latency, and App
  Service health-check status through `ag-meids-uat-ops`. Rename or replace the
  shared action group when production operations ownership diverges from UAT.
- PostgreSQL uses private networking, 35-day retention, geo-redundant backups,
  and synchronous high availability. Azure reported no alternate-zone capacity
  for the current server placement, so the initial standby is same-zone. Moving
  to zone-redundant HA remains a promotion item when regional capacity permits.

The identifiers above are deliberately lowercase stable application keys.
They are independent of email addresses and provider display names, while the
Entra object ID remains the authoritative external identity binding.

One manual browser check remains because the automated Chrome session blocked
the Microsoft identity callback locally: sign in through the production Static
Web App, verify that both `florian` and `lucas` are selectable, then run one
Actor Twin chat turn for each twin.

## Mandatory UAT

- User A can retrieve User A private knowledge.
- User A cannot retrieve User B private knowledge, including by supplying a
  raw Search filter or another twin ID.
- Explicit user, group, twin, and organization grants work and are revocable.
- Active-twin and all-assigned-twins modes return only assigned knowledge.
- Backend reconnects after managed-identity token renewal.
- PostgreSQL is unreachable publicly.
- Search is unreachable from the browser and applies backend-generated ACLs.
- Removing a grant removes results after the projection refresh.

## Promotion Gate

Production traffic can start only when migrations, identity mapping, Search
rebuild, negative isolation tests, restore test, monitoring alerts, and rollback
instructions all pass.

### Rebuild and restore rehearsal

Use signed `POST /api/knowledge/rebuild-search` to reconstruct working and
approved Search projections from authorized PostgreSQL revisions. This route is
machine-facing, excluded from the interactive App Service login redirect, and
still rejects missing or invalid signed knowledge-access tokens.

Validate a point-in-time restore from the VNet-integrated backend host:

```powershell
./scripts/validate-postgres-restore-app-service.ps1 `
  -AppName "meids-prod-backend-1853a19b" `
  -RestoreHost "<temporary-restore-server>.postgres.database.azure.com" `
  -AdminPrincipalName "Me.IDs Production PostgreSQL Administrators"
```

The helper uses a short-lived Entra PostgreSQL token, emits only aggregate
schema/data counts, and discards the token after the command. Delete the
temporary restore server only after the counts and latest migration are
captured. The 2026-10-19 rehearsal validated migration `007`, all core domain
tables, and private connectivity before deleting the disposable server.
