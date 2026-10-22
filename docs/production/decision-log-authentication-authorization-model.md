# Me.IDs Authentication And Authorization Decision Log

## Decision

Successful authentication through the assigned, single-tenant `Intellectual-Twin`
Enterprise Application admits an identity as a standard Me.IDs user. PostgreSQL
creates the application user just in time. Internal Eraneos users and accepted B2B
guests use the same baseline flow.

The Enterprise Application must keep `Assignment required` enabled. Internal users
are admitted through an assigned workforce group. Guests must be invited into the
Eraneos tenant and directly assigned through the governed Me.IDs users group.

## Authorization Layers

1. **Entra application assignment** controls who may authenticate to Me.IDs.
2. **Application roles** in `identity.user_application_role` control global rights:
   `user`, `editor`, `admin`, and `owner`.
3. **Twin access roles** in `twin.user_twin_access` control access to a particular
   twin: `owner`, `editor`, `reviewer`, and `viewer`.
4. **PostgreSQL row-level security and signed knowledge context** restrict knowledge
   reads and writes to assigned users, twins, groups, and visibility scopes.

Owning a personal twin never makes a user an application owner.

## Bootstrap Owners

Only the immutable Entra object IDs for Florian Liepe and Adem Korkutan are listed
in `MEIDS_AUTHZ_OWNER_USER_IDS`. Their next authenticated request records the
application owner role in PostgreSQL. Owner and admin users can subsequently grant
or revoke application roles through the audited administration API.

## Administration API

- `GET /api/admin/users` lists users, application roles, and assigned twin count.
- `POST /api/admin/users/roles` replaces a user's application roles.
- Every user retains the baseline `user` role.
- Only an owner may grant or revoke `owner`.
- The final owner cannot be removed.
- Changes are written to `audit.event`.

Example request body:

```json
{
  "user_id": "entra-user-id",
  "roles": ["user", "editor"]
}
```

## Risks And Controls

| Risk | Control |
|---|---|
| Enterprise Application assignment is disabled | Public launch check must verify `appRoleAssignmentRequired=true`. |
| A non-Entra identity reaches the backend | JIT accepts only configured identity providers and validates the tenant claim when present. |
| Group claims exceed token limits | Baseline access does not depend on group claims. Application roles are stored in PostgreSQL. |
| Personal twin ownership leaks global privilege | Global and twin roles use separate tables and queries. |
| Bootstrap owner configuration becomes stale | Object IDs are auditable and should move to an Azure deployment parameter or governed database bootstrap after production stabilization. |
| Guest access is too broad | Guests require invitation acceptance plus direct Enterprise Application assignment. |
