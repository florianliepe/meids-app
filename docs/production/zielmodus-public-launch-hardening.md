# Zielmodus: Public Launch Hardening

Date: 2026-10-20

## Objective

Close the remaining Me.IDs public-launch gates without weakening the signed
knowledge boundary, review workflow, or private PostgreSQL data plane.

## Execution order

1. **Inventory and freeze assumptions**
   - Confirm production resource identities, VNet integration, Search/Storage
     network state, embedding configuration, and PostgreSQL HA state.
   - Preserve existing user changes and avoid replacing production resources.
2. **Private Search and Blob networking**
   - Add a dedicated private-endpoint subnet.
   - Create and link `privatelink.search.windows.net` and
     `privatelink.blob.core.windows.net` private DNS zones.
   - Create private endpoints for Azure AI Search and Blob Storage.
   - Prove private DNS and managed-identity access from the VNet-integrated
     backend before disabling public network access.
3. **Production embeddings**
   - Use a 1,536-dimension approved embedding deployment compatible with the
     current Search index contract.
   - Store credentials in Key Vault and expose only Key Vault references to the
     backend. Prefer managed identity when the selected provider supports it.
   - Run a semantic embedding probe and a full PostgreSQL-to-Search rebuild.
4. **n8n publication recovery**
   - Identify the Azure resource and owner for
     `eraneos-agentic-platform.azurewebsites.net`.
   - Take an n8n workflow export before maintenance.
   - Restart only in an approved window, republish the canonical Knowledge
     Fabric workflow, and verify the response sanitizer on a fresh execution.
5. **Retention governance**
   - Keep approved knowledge without automatic expiry until Legal/Records
     Management approves a schedule.
   - Continue automatic cleanup only for quarantine, exports, and non-current
     object versions according to the existing lifecycle policy.
   - Record the approved schedule before adding destructive lifecycle rules.
6. **PostgreSQL availability revalidation**
   - Retain healthy same-zone HA while Azure reports no usable alternate zone.
   - Recheck zone-redundant capability before public launch and during each
     quarterly resilience review; never disable HA as part of the check.
7. **Launch UAT and evidence**
   - Test backend health, private Blob/Search connectivity, signed staging,
     review promotion, tenant isolation, vector retrieval, restore readiness,
     and Actor Twin chat routing.
   - Record any human-only action with exact commands and acceptance criteria.

## Stop conditions

- Do not disable a public endpoint until the backend resolves and reaches the
  corresponding private endpoint.
- Do not create deterministic or synthetic vectors for production relevance.
- Do not restart the shared n8n host without a workflow export, resource owner,
  and maintenance window.
- Do not add automatic deletion for approved knowledge without an approved
  retention policy.
- Do not replace the PostgreSQL server merely to obtain another availability
  zone.

## Exit criteria

- Search and Blob are privately reachable from the backend and reject public
  network traffic.
- New content receives semantic 1,536-dimension embeddings and is rebuildable.
- Fresh n8n executions use the canonical response sanitizer.
- Retention ownership and schedule are approved.
- Same-zone HA is accepted as an exception or zone-redundant HA is enabled.
- All launch UAT checks and decision records are green.

## Execution status

| Package | Status | Current action |
| --- | --- | --- |
| Inventory | Complete | Production identities, VNet integration, Search, Storage, PostgreSQL, n8n workflow IDs, and frontend/backend linkage are recorded. |
| Private Search/Blob | Complete | Production private endpoints and DNS are active; public access is disabled on both production and legacy Search plus production Storage; managed-identity configuration and Blob projection probes passed. |
| Embeddings | Human-gated | No Azure OpenAI resource is available in the visible subscriptions. Provision an approved `text-embedding-3-small` deployment and assign the backend identity before activation. |
| n8n recovery | Partially complete | Actor-to-specialist typed context propagation is published. Knowledge UAT needs one authenticated browser submission; Butler requires rotation of its expired LLM Gateway credential. |
| Retention | Conservative default active | No automatic deletion of approved knowledge; final schedule requires Legal/Records approval. |
| PostgreSQL HA | Accepted exception | Same-zone HA remains healthy; zone-redundant allocation was rejected by Azure. |
| Launch UAT | In progress | Infrastructure and persistence probes pass. Authenticated chat delegation and Butler credential rotation remain. |

The backend voice boundary is also closed: the gateway key is held in the
production Key Vault, consumed through a resolved App Service Key Vault
reference, and reported as configured by `/api/health`.

## Public-launch gate

Do not label the environment public-launch ready until all four conditions are
true:

1. An authenticated Actor Twin chat successfully stages a Knowledge Fabric
   concept for the active twin and returns no credential material.
2. The `Me.IDs Eraneos LLM Gateway` n8n credential is rotated and a normal
   Butler skill execution succeeds without an approval loop.
3. The production embedding deployment returns 1,536-dimensional semantic
   vectors and a full Search rebuild succeeds.
4. The launch owner signs the temporary retention and same-zone HA exceptions,
   or the corresponding final controls are implemented.
