# Zielmodus: Admin Cockpit MVP

Date: 2026-10-23

## Objective

Provide a separate Me.IDs administration page for platform owners and delegated
administrators without creating a second identity system or exposing private
knowledge and agent payloads.

## Scope

1. Add `/admin/` as a separate Azure Static Web Apps page.
2. Show the Admin Cockpit entry only when `/api/session` reports effective
   `admin` or `owner` authorization.
3. Recheck authorization in every admin API. Frontend visibility is not a
   security control.
4. List users, provisioning state, assigned twins, roles, and last observed
   authenticated activity.
5. Allow owners to manage `editor` and `admin`; allow admins to manage
   `editor`. Keep `owner` immutable in the cockpit.
6. Show aggregate knowledge, learning, outbox, agent-trace, approval, and
   dependency health. Do not return prompt text or knowledge content.
7. Show tenant-scoped audit events with a bounded, allowlisted context summary.
8. Keep access requests in Microsoft Entra Entitlement Management/My Access.

## Decision Log

| ID | Decision | Reason |
|---|---|---|
| ADM-001 | Reuse the existing Entra session; do not add a second admin login. | One identity lifecycle and no extra credential surface. |
| ADM-002 | Protect data server-side and use the Static Web Apps route only as defense in depth. | Client-side navigation cannot protect APIs. |
| ADM-003 | Govern `owner` through the Entra app role and owner group only. | Prevent local privilege escalation and preserve tenant governance. |
| ADM-004 | Store `editor` and `admin` in PostgreSQL and audit every change. | Supports application-specific least privilege without Graph write permissions. |
| ADM-005 | Keep pre-admission requests in Entra My Access. | Avoid rebuilding approvals, expiry, guest lifecycle, and access reviews. |
| ADM-006 | Expose aggregate operations data only. | Operators need trends and queues, not private prompts or documents. |
| ADM-007 | Treat trace-based usage as partial coverage. | Embedded n8n chat does not yet emit normalized token and latency telemetry. |

## Deferred

- Token and cost attribution after normalized post-turn telemetry exists.
- Read-only Microsoft Graph synchronization of Entitlement Management requests.
- User suspension and twin ownership transfer workflows.
- Direct n8n workflow mutation or credential management.
- Entra owner-group mutation from the application.

## Acceptance Gates

- Non-admin users cannot load admin data through direct API calls.
- Admins cannot grant or revoke `admin` or `owner` unless policy permits it.
- Owners cannot grant or revoke `owner` through Me.IDs.
- Role changes produce an `application_roles_updated` audit event.
- Admin aggregate queries remain tenant-scoped.
- The Azure artifact contains `/admin/index.html` and its assets.
- Desktop and mobile browser checks show no overlap or clipped controls.
