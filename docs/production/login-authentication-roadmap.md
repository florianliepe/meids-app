# Login and Authentication Roadmap

## Accepted Decisions

- Identity provider: Microsoft Entra ID.
- External users: invited external users are explicitly allowed.
- Production frontend target: Azure Static Web Apps.
- Requested production subdomain: `intellectual-twin`.
- Multi-twin ownership: supported from day one.
- Actor Twin remains the only user-facing chat.
- n8n remains the agent workflow orchestration layer.

## Recommended Default

Use Azure Static Web Apps authentication with Microsoft Entra ID for the
frontend and a backend `/api/session` endpoint for Me.IDs-specific user, tenant,
role, and twin mapping.

Do not build custom password authentication.

## Runtime Session Contract

```json
{
  "status": "authenticated",
  "provider": "microsoft_entra_id",
  "external_users_allowed": true,
  "user": {
    "id": "entra-user-object-id",
    "email": "user@example.com",
    "name": "User Name",
    "identity_provider": "aad"
  },
  "tenant": {
    "id": "eraneos",
    "name": "Eraneos"
  },
  "roles": ["owner", "reviewer"],
  "active_twin_id": "florian",
  "allowed_twin_ids": ["florian", "lucas"],
  "permissions": {
    "can_chat": true,
    "can_review_knowledge": true,
    "can_create_skill": true,
    "can_approve_skill_activation": true,
    "can_admin_agents": false
  }
}
```

## n8n Context Contract

Actor Twin and all workflow-tool subagents receive scoped context:

```json
{
  "auth_context": {
    "tenant_id": "eraneos",
    "user_id": "entra-user-object-id",
    "user_email": "user@example.com",
    "active_twin_id": "florian",
    "roles": ["owner", "reviewer"],
    "allowed_scopes": ["private", "team_shared", "org_shared"]
  }
}
```

n8n may use this context for scoping and trace attribution. Authorization proof
must come from Azure/backend validation, not from browser-only state.

## Current Implementation Scaffold

- Frontend runtime config contains an `auth` block.
- Frontend login panel supports Microsoft sign-in and sign-out URLs.
- Frontend blocks workspace entry when auth is enabled and no authenticated
  session with assigned twins exists.
- Backend exposes `GET /api/session`.
- Backend reads Azure Static Web Apps/App Service auth headers:
  - `x-ms-client-principal`
  - `x-ms-client-principal-id`
  - `x-ms-client-principal-name`
  - `x-ms-client-principal-roles`
- Local/dev fallback is available only when `MEIDS_AUTH_DEV_USER_EMAIL` is set.

## Production App Settings

```text
MEIDS_TENANT_ID=eraneos
MEIDS_TENANT_NAME=Eraneos
MEIDS_AUTH_ALLOWED_TWIN_IDS=florian,lucas
MEIDS_AUTH_DEFAULT_ROLES=viewer
```

For local testing only:

```text
MEIDS_AUTH_DEV_USER_EMAIL=<developer-email>
MEIDS_AUTH_DEFAULT_ROLES=owner,reviewer
```

## Authorization Model

Roles:

- `viewer`: can chat with assigned twins.
- `reviewer`: can review knowledge.
- `editor`: can create or edit concepts and skill proposals.
- `owner`: can approve new skill or task-agent activation.
- `admin`: can administer agent/workflow configuration.

Permissions are derived server-side from roles.

## Zielmode Instructions

### Package 1: Azure Auth Registration

1. Create or confirm Microsoft Entra app registration.
2. Enable Azure Static Web Apps authentication.
3. Allow invited external users through Entra/B2B.
4. Configure redirect and logout URLs for the `intellectual-twin` subdomain.
5. Configure role assignment source.

Manual/admin action likely required:

- Entra app registration.
- External collaboration settings.
- Custom domain verification.

### Package 2: Backend Authorization

1. Replace environment-only twin mapping with PostgreSQL user/twin/role tables.
2. Resolve `/api/session` from authenticated identity plus database mapping.
3. Add middleware for protected write APIs.
4. Enforce tenant/twin scope on Knowledge Fabric, graph, traces, skills, and
   Actor Twin proxy calls.

### Package 3: Frontend Login UX

1. Enable `auth.enabled=true` in Azure runtime config.
2. Show login page for unauthenticated users.
3. Show access-pending state for authenticated users without assigned twins.
4. Support multi-twin selector from session `allowed_twin_ids`.
5. Hide cockpit surfaces until session is valid.

### Package 4: n8n Auth Context Binding

1. Pass backend-validated `auth_context` to Actor Twin.
2. Propagate `auth_context` to Knowledge Fabric, Agentic Butler, Skill
   Orchestrator, Task Agents, Critical Faculty, and Learning Agent.
3. Add trace attribution for user, tenant, active twin, and workflow id.
4. Reject cross-twin operations unless the backend session permits them.

### Package 5: UAT

1. Test unauthenticated access.
2. Test Eraneos internal user login.
3. Test invited external user login.
4. Test assigned single twin.
5. Test assigned multiple twins.
6. Test no-twin access-pending state.
7. Test unauthorized cross-twin request rejection.

