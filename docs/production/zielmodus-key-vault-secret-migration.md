# Zielmodus: Key Vault secret migration

## Target

Keep API keys and connection passwords in Azure Key Vault. The Me.IDs backend
reads them through App Service Key Vault references under its managed identity.
The browser and static frontend receive no secret values. Use one vault per
environment before adding a separate production slot or app.

## Package 1: Inventory and authority (completed 2026-09-22)

- Vault: `Intellectual-twin-vault` in `rg-ai-intellectual-twin`, Azure RBAC mode.
- Backend: `meids-backend-1853a19b`, system-assigned managed identity enabled.
- Backend identity has `Key Vault Secrets User` on the vault.
- Operator has `Key Vault Secrets Officer` on the vault for migration.
- Current backend settings held `N8N_API_KEY` and `AZURE_SEARCH_API_KEY`.
- Do not mistake endpoint URLs, index names, model names, and feature flags for
  secrets. Keep those as ordinary App Service settings.

## Package 2: Move live backend keys (completed 2026-09-22)

| App Service setting | Vault secret | Status |
| --- | --- | --- |
| `N8N_API_KEY` | `meids-n8n-api-key` | App Service reference resolved |
| `AZURE_SEARCH_API_KEY` | `meids-azure-search-api-key` | App Service reference resolved |

The vault values were checked against the prior App Service values before
switching. `AZURE_KEY_VAULT_URI` is set to the vault URI for the backend's
secret-store readiness check. The deployment script preserves existing Key Vault
references when `-ApplySecretSettings` is used and suppresses setting values in
its normal output.

## Package 3: Add remaining credentials when their runtime is configured

| Runtime consumer | Secret name | App setting / action |
| --- | --- | --- |
| Backend voice gateway | `meids-eraneos-ai-gateway-api-key` | `ERANEOS_AI_GATEWAY_API_KEY` |
| Backend OpenAI fallback | `meids-openai-api-key` | `OPENAI_API_KEY`, only if used |
| Backend embeddings | `meids-azure-openai-api-key` | `AZURE_OPENAI_API_KEY`, only if used |
| Backend database | `meids-database-url` | `DATABASE_URL`, once PostgreSQL exists |
| Backend authenticated n8n webhook | `meids-n8n-webhook-auth-token` | `N8N_WEBHOOK_AUTH_TOKEN`, if enabled |

Create each secret from its provider or current protected setting. Verify the
stored value without printing it, then use a versionless App Service reference:

```text
@Microsoft.KeyVault(SecretUri=https://intellectual-twin-vault.vault.azure.net/secrets/<secret-name>)
```

Check the reference status in App Service Configuration; it must say `Resolved`.
Do not create placeholder secrets for credentials that have not been issued.
Prefer managed identity for Azure Search and Azure OpenAI when those services
and this code path support it, which would remove those API keys entirely.

## Package 4: n8n and deployment credentials

### Live n8n inventory (checked 2026-09-24)

The active n8n instance is version `2.40.5`. Its Settings menu does not expose
`External Secrets`, and public instance settings do not report enterprise
features. The current instance therefore cannot yet replace credential values
with Azure Key Vault references.

The Me.IDs workflows reference these shared credentials:

| n8n credential | Used by | Intended vault secret |
| --- | --- | --- |
| `Eraneos LLM Gateway` (`openAiApi`) | Actor Twin, Knowledge Fabric, Agentic Butler, Knowledge Retrieval Interviewer, Skill Orchestrator, Task Agent, Critical Faculty, Learning Agent | `meids-eraneos-llm-gateway-api-key` |
| `GitHub account` (`githubApi`) | Skill Orchestrator file and issue tools; must be split | `meids-github-agent-config-read-pat` and `meids-github-skill-proposal-pat` |

Because this n8n edition cannot consume Key Vault references, use Key Vault as
the controlled source/recovery store and n8n's encrypted credential store as the
runtime copy. Every rotation must update both stores in one maintenance window.
Never paste a secret into chat, source files, command history, or workflow JSON.

### Current-edition operating model

1. Create or rotate the provider key/PAT in its source portal.
2. Store it directly in Key Vault with the secure prompt helper. The value stays
   out of shell history and is never printed:

   ```powershell
   .\scripts\set-meids-key-vault-secret.ps1 -SecretName meids-eraneos-llm-gateway-api-key -Purpose llm-gateway
   .\scripts\set-meids-key-vault-secret.ps1 -SecretName meids-github-agent-config-read-pat -Purpose github-agent-config-read
   .\scripts\set-meids-key-vault-secret.ps1 -SecretName meids-github-skill-proposal-pat -Purpose github-skill-proposal
   ```

3. In n8n, update the matching credential manually with the same new value. Do
   not reveal or copy the Key Vault value into chat; paste it from the provider
   portal or a temporary local secure source directly into n8n.
4. Test all consumers before revoking the old provider key.
5. Revoke the old provider key and record only its identifier and rotation date.

Split the existing `GitHub account` credential into:

| n8n credential | Repository | Fine-grained PAT permissions |
| --- | --- | --- |
| `Me.IDs Agent Config Reader` | `florianliepe/meids-agent-configs` | Contents: read; Metadata: read |
| `Me.IDs Skill Proposal Issues` | Explicit approved proposal repository only | Issues: read/write; Metadata: read |

Bind `Get a file` to the reader credential. Bind `Edit an issue in GitHub` to
the issue credential and replace its model-selected owner/repository with fixed,
approved repository values. This prevents the model from targeting another
repository that happens to be allowed by a broader token.

Create additional PATs only when an active node needs them:

| Future n8n duty | Repository | Fine-grained PAT permissions |
| --- | --- | --- |
| Publish approved OKF documents | `florianliepe/meids-knowledge-fabric` | Contents: read/write; Metadata: read |
| Read active agent configuration | `florianliepe/meids-agent-configs` | Reuse reader credential |

The app repository does not currently need an n8n PAT. GitHub Actions deploys it
with its own GitHub/Azure deployment credentials.

Do not grant account, organization, administration, actions/workflow, secrets,
environments, or unrelated repository access to any n8n PAT.

- n8n workflow credentials stay in n8n's encrypted credential store. Key Vault
  is the governed recovery copy, with manual synchronized rotation.
- Keep the Static Web Apps deployment token in GitHub Actions secret
  `AZURE_STATIC_WEB_APPS_API_TOKEN_INTELLECTUAL_TWIN` while that action deploys
  by token. Keep the App Service publish profile in its GitHub Actions secret
  until backend deployment uses Azure login with workload identity federation.
  Moving a copy of either token into Key Vault does not remove the CI secret.
- Do not put provider keys in `frontend/runtime-config.js`, Pages build inputs,
  n8n workflow JSON exports, logs, or repository documents.

## Package 5: Verify and rotate

1. Verify Key Vault references report `Resolved` and the SWA `/api/session`
   endpoint returns JSON rather than a missing-backend error.
2. For each provider rotation, create a new version of the existing vault
   secret, run provider-specific live probes, then revoke the old provider key.
3. App Service refreshes versionless references after configuration changes or
   within its cache window; use the config-reference refresh API for immediate
   rotation validation.
4. Enable purge protection and narrow vault network access after all runtime
   consumers and recovery procedures are verified. Soft delete is enabled now.
5. Audit vault access, alerts, and ownership. Avoid granting runtime identities
   `Secrets Officer` or broad resource-group roles.

## Current verification

- App Service reference status: both migrated settings `Resolved` with
  `SystemAssigned` identity.
- Static Web App `/api/session`: HTTP 401 JSON for an unauthenticated request,
  as expected.
- Vault still permits public network access. The next network hardening pass
  needs a tested private-access path for every consumer.
- n8n External Secrets is unavailable. The documented manual two-store rotation
  process is the active boundary.
- `Me.IDs Eraneos LLM Gateway` was created from the Key Vault value and bound to
  all eight Me.IDs agent workflows. A minimal `claude-sonnet-5` probe and Actor
  Twin embedded-chat probe both returned HTTP 200.
- `Me.IDs Agent Config Reader` is bound to `Get a file`, fixed to
  `florianliepe/meids-agent-configs` and `README.md`.
- `Me.IDs Skill Proposal Issues` is bound to `Edit an issue in GitHub`, with the
  owner and repository fixed to `florianliepe/meids-agent-configs`. Its PAT is
  unable to read repository contents (HTTP 403), confirming the intended split.
- Canonical exports in `florianliepe/meids-agent-configs/workflows/n8n` now
  reference the rotated Me.IDs LLM credential. Historical live backups in the
  application workspace retain their original credential IDs and are not part
  of the canonical workflow package.

## References

- [App Service Key Vault references](https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references)
- [Key Vault RBAC guide](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide)
- [n8n external secrets](https://docs.n8n.io/administer/manage-credentials/use-external-secret-stores/)
- [Static Web Apps deployment tokens](https://learn.microsoft.com/en-us/azure/static-web-apps/deployment-token-management)
