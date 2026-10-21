# Zielmodus: Entra Group Access and Me.IDs Onboarding

Date: 2026-10-21

## Objective

Remove the post-login loop, admit only governed Eraneos and B2B identities, and
provision an authorized user's Me.IDs database identity before the user creates
their first twin.

## Root cause

Microsoft Entra authentication succeeds. The backend then returns HTTP 403
because the signed-in Entra object has no active row in `identity.app_user`.
The frontend previously handled every session error as unauthenticated and sent
the user back to sign-in, producing the observed loop.

## Target authorization layers

1. **Entra admission:** the `Me.IDs Users` security group is assigned to the
   Me.IDs enterprise application. `User assignment required` is enabled.
2. **Entra privilege:** the `Me.IDs Owners` security group receives the
   `MeIDs.Owner` application role. Its members are also direct members of
   `Me.IDs Users`.
3. **Me.IDs provisioning:** an admitted identity is inserted or refreshed in
   `identity.app_user` on its first session request. `MeIDs.User` becomes the
   read-oriented `viewer` role. The user can then create a first twin and owns
   that twin.
4. **Data authorization:** `twin.user_twin_access`, tenant ID, user ID, and
   knowledge visibility continue to enforce access to specific twins and
   knowledge. Entra group membership never grants blanket access to another
   user's knowledge.

## Azure objects created

| Object | Object ID | Owners | Initial members |
|---|---|---|---|
| `Me.IDs Users` | `6d05aad5-e0ea-4bc5-84b0-003f43611079` | Florian Liepe, Adem Korkutan | Florian Liepe, Adem Korkutan |
| `Me.IDs Owners` | `849d2888-ecd3-42e8-ad91-fd3178b83734` | Florian Liepe, Adem Korkutan | Florian Liepe, Adem Korkutan |

The backend App Service has the two group IDs and
`MEIDS_AUTHZ_JIT_ENABLED=true`. Provisioning still requires an explicit group
or application-role claim; a merely authenticated identity is not admitted.

## External guest procedure

1. Invite the external identity through Microsoft Entra B2B and wait until the
   invitation is accepted.
2. Add the resulting guest object directly to `Me.IDs Users`.
3. Add it to `Me.IDs Owners` only when privileged application administration is
   explicitly required.
4. Do not rely on a nested source group. Enterprise-application group
   assignment does not expand nested groups.
5. Review guest membership quarterly. Remove stale group membership and, when
   policy permits, disable or remove the B2B identity.

After the guest object exists, an operator can apply direct membership with:

```powershell
.\scripts\add-meids-entra-user.ps1 -UserObjectId '<entra-object-id>'
```

Use `-Owner` only for explicitly approved privileged operators. If Entra ID
Governance or P2 licensing is unavailable, perform and record the quarterly
membership review manually.

## Azure admin blocker and exact request

The current subscription owner can create Azure resources and Entra groups but
cannot register an Entra application. An Entra administrator must perform one
of these options:

- Temporarily assign Florian Liepe the **Application Developer** directory role,
  then let the deployment script create the application; or
- Create the application with the following exact settings.

### Admin-created application

1. Create a single-tenant app registration named `Me.IDs Production` in tenant
   `213a6ca3-4808-4047-8aca-814d2cde4474`.
2. Add web redirect URI
   `https://victorious-flower-0f10a8303.6.azurestaticapps.net/.auth/login/aad/callback`.
3. Add application role `Me.IDs User`, value `MeIDs.User`, allowed member type
   `Users/Groups`.
4. Add application role `Me.IDs Owner`, value `MeIDs.Owner`, allowed member type
   `Users/Groups`.
5. Set token configuration group claim to `Security groups`.
6. Add Florian Liepe (`4277841b-d713-47b6-8168-172ac3cde535`) and Adem Korkutan
   (`5c3a147c-0a3b-4d85-bed9-d63653bb5d0d`) as application owners.
7. In the enterprise application, set `Assignment required?` to `Yes`.
8. Assign `Me.IDs Users` to `MeIDs.User` and `Me.IDs Owners` to `MeIDs.Owner`.
9. Create a client secret and store it directly as the Azure Static Web App
   setting `AZURE_CLIENT_SECRET`. Do not send the secret in chat or commit it.
10. Store the application/client ID as Static Web App setting
    `AZURE_CLIENT_ID` and provide only that non-secret ID to the project owner.

After the admin step, add the custom single-tenant provider to
`frontend/staticwebapp.config.json`, deploy it, and verify that an unassigned
identity is blocked by Entra while a direct `Me.IDs Users` member receives a
200 session and can create a first twin.

## UAT gates

1. Unauthenticated browser receives the Microsoft sign-in page.
2. Authenticated but unassigned identity is rejected without a login loop.
3. Direct `Me.IDs Users` member gets `viewer`, no cross-user twins, and can
   create a new owned twin.
4. `Me.IDs Owners` member receives owner permissions.
5. Direct B2B guest membership follows the same user flow.
6. Removing group assignment blocks the next fresh login/session.
7. A user cannot list, retrieve, or search another user's private knowledge.

## Decision log

| ID | Decision | Reason |
|---|---|---|
| ENTRA-001 | Separate app admission from data authorization. | Group membership is appropriate for entry; PostgreSQL remains authoritative for tenant, twin, and knowledge access. |
| ENTRA-002 | Use two security groups instead of one broad Eraneos group. | It gives least-privilege defaults and a small, reviewable privileged set. |
| ENTRA-003 | Map `MeIDs.User` to `viewer`. | New users start read-oriented but can own the twin they explicitly create. |
| ENTRA-004 | Require direct group membership for app assignment. | Microsoft Entra enterprise application assignments do not cascade through nested groups. |
| ENTRA-005 | Treat HTTP 403 as access pending, not unauthenticated. | Reauthentication cannot create a missing authorization mapping and caused the loop. |
| ENTRA-006 | Review guest access quarterly. | External access needs periodic recertification by accountable group owners. |
| ENTRA-007 | Provision Adem without a seeded twin as the temporary UAT bridge. | Authentication is valid but the preconfigured SWA provider cannot emit the not-yet-created Me.IDs application roles. A database identity removes the immediate block while preserving user-owned first-twin creation. |
