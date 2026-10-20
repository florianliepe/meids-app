# Public Launch Hardening Evidence

Date: 2026-10-20

## Passed controls

- Production Azure AI Search service: `srch-meids-prod-1853a19b`.
- Azure AI Search private endpoint: `10.42.3.4`
- Azure Blob private endpoint: `10.42.3.5`
- Private DNS zones linked for Search and Blob.
- Production Search and Storage public network access disabled after private
  probes. A control-plane recheck found the legacy
  `srch-intellectual-twin` service public; it was also set to disabled and
  returned to `running` / `Succeeded` on 2026-10-20.
- Post-closure backend managed-identity Search startup probe: `ready` using
  document queries over the private endpoint.
- Search document counts at the 2026-10-20 15:05 UTC probe: approved `1`,
  working `5`.
- Blob projection completed for concept
  `b706d417-1ab2-4fe4-acfa-cd2a4a931b4f`, revision `3`.
- PostgreSQL server ready with healthy same-zone HA, 35-day backup retention,
  geo backup, and private networking.
- The 2026-10-20 West Europe capability query reports
  `ZoneRedundantHa=Disabled` and `ZoneRedundantHaAndGeoBackup=Disabled` for
  Flexible Server. The SameZone exception therefore remains a regional
  capability constraint, not an unattempted configuration choice.
- Azure Static Web Apps backend linkage points to
  `meids-prod-backend-1853a19b`.
- Backend health is `ok`; PostgreSQL is `ready`; voice transcription is
  `configured`; Search uses managed identity with no Search API key.
- Embedding authentication is already set to managed identity. The only
  missing embedding settings are the approved Azure OpenAI endpoint and
  deployment name; dimensions remain `1536`.
- The existing Eraneos gateway secret was copied into
  `kv-meids-prod-1853a19b` and the backend setting uses a resolved Key Vault
  reference. The secret value was not printed or stored in source control.
- Frontend runtime and application assets use release identifier
  `20261020-public-launch-auth`.
- Actor Twin, Knowledge Fabric, and Agentic Butler workflows were backed up,
  patched, and republished.
- Actor specialist tools now map `query`, `knowledge_access_token`,
  `tenant_id`, `user_id`, `twin_id`, and `organization_id`.
- Knowledge Fabric and Butler Execute Workflow Triggers expose the same typed
  input contract.
- Workflow backups are stored under
  `exports/n8n-live-backups/20261020T143450Z-public-launch-auth-context/`.
- Source baseline `43d65a9` is pushed to `origin/main`.
- GitHub backend deployment uses OIDC identity
  `id-meids-github-deployer`, federated only to the repository's `main`
  branch and scoped as `Website Contributor` on
  `meids-prod-backend-1853a19b`.
- Frontend Azure Static Web Apps and GitHub Pages deployments were triggered
  by the source-baseline push; backend deployment is path-scoped to backend or
  package changes.

## Code fixes included

- Transactional knowledge metadata update and outbox completion.
- RLS context restoration for asynchronous outbox processing.
- Production projector setting preservation during backend deployment.
- Managed-identity Azure OpenAI embedding support with API-key fallback.
- Explicit n8n auth and identity context propagation.
- Frontend runtime cache invalidation for Azure Static Web Apps.

## Open launch gates

| Gate | State | Evidence/next action |
| --- | --- | --- |
| Authenticated Knowledge Fabric chat UAT | Ready to run | Submit one authenticated knowledge-staging request and verify the fresh n8n execution reports `_auth_diagnostic.present=true`. |
| Agentic Butler skill UAT | Blocked | The `Me.IDs Eraneos LLM Gateway` credential expired on 2026-10-17. Rotate it in n8n and rerun a draft-only skill. |
| Semantic production embeddings | Blocked | No Azure OpenAI resource is available in the visible subscriptions. Provision an approved 1,536-dimension deployment and grant the backend identity access. |
| Retention approval | Blocked | Complete and approve `knowledge-retention-policy-template.md`. |
| Zone-redundant PostgreSQL HA | Accepted exception | Azure rejected alternate-zone allocation in West Europe; obtain risk-owner sign-off and recheck capacity before launch. |

## UAT acceptance criteria

1. No token, credential, vector, or internal authorization field appears in the
   frontend response or trace summary.
2. A delegated Knowledge Fabric request creates or updates exactly one
   `review_needed` record for the authenticated active twin.
3. Duplicate checking is HTTP-backed and returns vector/graph score evidence.
4. Butler normal skill execution completes without human approval; only new
   skill or generated-agent activation requests enter approval.
5. Search can be rebuilt completely from PostgreSQL/Blob without deterministic
   production vectors.
