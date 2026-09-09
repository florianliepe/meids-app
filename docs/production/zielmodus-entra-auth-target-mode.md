# Zielmodus: Entra ID Auth Target Mode

## Status

Date: 2026-09-09

Target mode is prepared. Backend session handling is deployed, but full Azure
authentication activation is blocked until the production Static Web App and
Entra app registration are confirmed.

## Accepted Decisions

- Identity provider: Microsoft Entra ID.
- External users: invited external users are allowed.
- Frontend production target: Azure Static Web Apps.
- Requested subdomain: `intellectual-twin`.
- Multi-twin ownership: enabled from day one.
- Actor Twin remains the only user-facing chat.
- n8n remains the agent workflow orchestration layer.

## Current Azure Findings

Resource group:

```text
rg-ai-intellectual-twin
```

Existing Static Web Apps:

```text
SWA-Intellectual-Twin-Keynote
defaultHostname: mango-beach-0db761103.7.azurestaticapps.net
repositoryUrl: https://github.com/florianliepe/Me.IDs-Keynote
customDomain: intellectual-twin-keynote.eraneos.com

intellectual-twin-insurance
defaultHostname: ashy-mud-0dc57f303.6.azurestaticapps.net
repositoryUrl: https://github.com/florianliepe/Me.IDs-Keynote-Insurance
customDomain: intellectual-twin-insurance.eraneos.com
```

Current app repository:

```text
https://github.com/florianliepe/meids-app.git
```

Backend App Service:

```text
meids-backend-1853a19b
https://meids-backend-1853a19b.azurewebsites.net
```

Backend App Service auth state:

```text
enabled: false
defaultProvider: null
clientId: null
```

Backend session defaults configured:

```text
MEIDS_TENANT_ID=eraneos
MEIDS_TENANT_NAME=Eraneos
MEIDS_AUTH_ALLOWED_TWIN_IDS=florian,lucas
MEIDS_AUTH_DEFAULT_ROLES=viewer
```

Backend session endpoint deployed and verified:

```text
GET https://meids-backend-1853a19b.azurewebsites.net/api/session
status: 401
body: controlled unauthenticated JSON response
```

This confirms the hosted backend has the auth contract endpoint and no longer
returns a static HTML/404 page for the session contract.

## What Is Already Implemented in Code

- Frontend login panel exists.
- Runtime auth config block exists.
- Backend `GET /api/session` exists.
- Backend reads Azure auth headers:
  - `x-ms-client-principal`
  - `x-ms-client-principal-id`
  - `x-ms-client-principal-name`
  - `x-ms-client-principal-roles`
- Azure Static Web Apps route config exists:
  - `frontend/staticwebapp.config.json`
- Auth is intentionally disabled in current UAT runtime config:

```text
auth.enabled=false
```

## Target Architecture

```text
Browser
  -> Azure Static Web Apps auth
  -> Microsoft Entra ID
  -> Me.IDs frontend
  -> Backend /api/session
  -> Backend role/twin mapping
  -> Actor Twin n8n embedded chat or backend-mediated n8n proxy
  -> n8n workflow-tool subagents
```

The frontend may display login/session state. Authorization must be enforced by
Azure and backend, not by browser-only flags.

## Execution Package 1: Select or Create Production Static Web App

Preferred:

Create a new Static Web App bound to:

```text
https://github.com/florianliepe/meids-app.git
branch: main
app_location: frontend
output_location: dist-pages or equivalent build artifact
sku: Standard
region: West Europe
planned domain: intellectual-twin.eraneos.com
```

Alternative:

Repurpose an existing Static Web App only if explicitly approved:

```text
SWA-Intellectual-Twin-Keynote
intellectual-twin-insurance
```

This is not recommended because both are currently linked to keynote
repositories.

## Execution Package 2: Configure Entra ID

Create or confirm an Entra app registration for Me.IDs.

Required redirect/logout URLs after frontend target is selected:

```text
https://<static-web-app-host>/.auth/login/aad/callback
https://intellectual-twin.eraneos.com/.auth/login/aad/callback
https://<static-web-app-host>/.auth/logout
https://intellectual-twin.eraneos.com/.auth/logout
```

External users:

- Enable invited external users through Entra B2B.
- Ensure invited users can authenticate to this application.
- Map them to Me.IDs tenant/twin roles in backend persistence.

## Execution Package 3: Enable Frontend Auth

In production runtime config:

```js
auth: {
  enabled: true,
  provider: "azure_static_web_apps_entra_id",
  loginUrl: "/.auth/login/aad",
  logoutUrl: "/.auth/logout",
  allowInvitedExternalUsers: true,
  plannedSubdomain: "intellectual-twin",
  multiTwinOwnership: true
}
```

## Execution Package 4: Backend Authorization

Short-term:

- Keep `/api/session` active.
- Use Azure auth headers.
- Keep env-based default twin mapping only for UAT.

Production:

- Add PostgreSQL user/twin/role mapping.
- Enforce authenticated session on write APIs.
- Pass backend-validated `auth_context` to Actor Twin and all n8n subagents.

## Execution Package 5: n8n Context Propagation

Every Actor Twin/subagent call receives:

```json
{
  "auth_context": {
    "tenant_id": "eraneos",
    "user_id": "<entra-object-id>",
    "user_email": "<signed-in-email>",
    "active_twin_id": "<selected-twin>",
    "roles": ["viewer"],
    "allowed_scopes": ["private", "team_shared", "org_shared"]
  }
}
```

n8n uses this for scoping and trace attribution. It must not treat unverified
browser-provided identity as authorization proof.

## Execution Package 6: UAT

Test cases:

1. Unauthenticated user sees login only.
2. Internal Eraneos user can sign in.
3. Invited external user can sign in.
4. User without assigned twin sees access-pending state.
5. User with one twin enters Actor Twin workspace.
6. User with multiple twins can select active twin.
7. Cross-twin API request is rejected.
8. Logout clears access.

## Blockers / Admin Request

Ask Azure/Entra admin for:

1. Confirm whether a new Azure Static Web App may be created for
   `florianliepe/meids-app`.
2. If yes, approve/create:

```text
Resource name: meids-app-prod or intellectual-twin
Resource group: rg-ai-intellectual-twin
Region: West Europe
SKU: Standard
Repository: https://github.com/florianliepe/meids-app.git
Branch: main
Custom domain: intellectual-twin.eraneos.com
```

3. Create/confirm Microsoft Entra app registration for the Static Web App.
4. Enable invited external/B2B users for this application.
5. Provide app/client ID or confirm SWA built-in auth configuration.
6. Approve redirect/logout URLs for the default SWA hostname and
   `intellectual-twin.eraneos.com`.
7. Confirm role/group strategy:
   - Entra app roles
   - Entra security groups
   - or Me.IDs backend role table only
8. Confirm whether backend App Service Easy Auth should also be enabled or
   whether frontend SWA auth plus backend `/api/session` validation is enough
   for first production release.

## Current Recommendation

Create a dedicated production Static Web App for `meids-app`. Do not repurpose
the existing keynote Static Web Apps unless the old keynote deployments are
retired.

## Validation Results

Executed locally after backend deployment:

```text
node --check frontend/app.js
frontend/staticwebapp.config.json JSON parse
npm run check:backend
hosted GET /api/session
```

Result:

```text
passed
```

Remaining runtime note:

```text
auth.enabled=false
```

Auth must stay disabled in the GitHub Pages/UAT runtime until Azure Static Web
Apps and Entra ID are configured for the production host.
