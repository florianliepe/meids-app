# Public Launch Human Actions

Date: 2026-10-20

Only the actions below still require a person because they involve a secret,
tenant approval, legal ownership, or launch-risk acceptance.

Backend deployment itself no longer requires a publish profile: GitHub OIDC is
configured with a repository-and-branch-bound identity and App-Service-only
Azure role assignment.

## 1. Rotate the n8n LLM Gateway credential

Do not paste the key into chat, workflow JSON, or source control.

1. Open n8n and select **Credentials**.
2. Open **Me.IDs Eraneos LLM Gateway**.
3. Replace the expired gateway key with a newly issued key from the approved
   Eraneos AI Gateway project.
4. Use n8n's credential test, then save the credential.
5. Open **Me.IDs Agentic Butler - staging** and execute a normal draft task.
6. Confirm the execution succeeds and returns `approval_required: false`.
7. Execute a new-skill creation request and confirm that only this request
   enters approval.

Acceptance: no secret appears in execution output, frontend output, exported
workflow JSON, or Git history.

The production backend voice setting is already bound to the corresponding
secret in `kv-meids-prod-1853a19b`; this manual step is only for n8n's internal
credential store, because external secrets are unavailable and the UAT API key
does not have credential-management scope.

## 2. Provision production embeddings

Recommended deployment: Azure OpenAI `text-embedding-3-small`, 1,536
dimensions, managed-identity authentication.

1. Request or create an Azure OpenAI resource in the approved production
   subscription and region.
2. Deploy `text-embedding-3-small` with sufficient quota for ingestion and
   rebuild traffic.
3. Assign the managed identity of
   `meids-prod-backend-1853a19b` the **Cognitive Services OpenAI User** role on
   the Azure OpenAI resource.
4. Set these App Service settings:

   ```text
   AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
   AZURE_OPENAI_EMBEDDING_DEPLOYMENT=<deployment-name>
   AZURE_OPENAI_AUTH_MODE=managed_identity
   AZURE_OPENAI_EMBEDDING_DIMENSIONS=1536
   ```

5. Restart the backend App Service.
6. Run one semantic embedding probe, ingest one reviewed OKF concept, and
   verify that Azure AI Search receives exactly 1,536 numeric dimensions.
7. Run a complete PostgreSQL-to-Search rebuild and compare document counts.

Acceptance: no deterministic production vectors, no API key in application
settings, and retrieval returns semantically relevant results.

## 3. Approve retention governance

1. Complete `knowledge-retention-policy-template.md` with the data owner,
   Legal/Records, and Security.
2. Approve durations for approved, working, rejected, source, learning, trace,
   audit, and export data.
3. Approve user-offboarding and legal-hold behavior.
4. Only after approval, translate the schedule into Blob lifecycle rules,
   PostgreSQL jobs, Search deletion propagation, and n8n execution retention.
5. Test deletion and legal hold in a non-production tenant before activation.

## 4. Accept or close the PostgreSQL HA exception

1. Record the launch-risk owner for same-zone HA.
2. Confirm that 35-day backup retention, geo backup, and restore testing are
   acceptable for the launch window.
3. Open an Azure capacity request for zone-redundant PostgreSQL Flexible
   Server in West Europe, or approve an alternative supported region.
4. Recheck capacity before launch and quarterly thereafter.
5. When capacity is available, enable ZoneRedundant HA in a maintenance window
   and run failover plus restore UAT.

## 5. Perform final authenticated chat acceptance

1. Sign in to the Azure Static Web App.
2. Select the intended active twin.
3. Ask the Actor Twin to remember a clearly marked UAT concept.
4. In n8n, open the fresh Knowledge Fabric execution and confirm
   `_auth_diagnostic.present` is `true`.
5. In Me.IDs Knowledge review, confirm exactly one `review_needed` record was
   created for the selected twin.
6. Confirm the chat answer and trace contain no access token, vector, or secret.
7. Remove or reject the UAT concept according to the approved test-data rule.
