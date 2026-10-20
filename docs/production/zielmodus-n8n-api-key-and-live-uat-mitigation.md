# Zielmodus: n8n API Key and Live UAT Mitigation

## Purpose

Unblock repo-driven updates to the live n8n workflows and mitigate the current live UAT failures:

- Knowledge Fabric ingest is still answered directly by Actor Twin.
- Create-skill delegation still times out or normalizes as Actor Twin/direct.

## Clarification Baseline

Proceed with these assumptions unless the operator changes them:

- The active n8n instance is `https://eraneos-agentic-platform.azurewebsites.net`.
- The current embedded Actor Twin chat workflow id is `eKI3qM7nyCNn9r1q`.
- Knowledge Fabric Agent workflow id is `7Ci86PxXipwvYpKv`.
- Agentic Butler workflow id is `KZOqZRUAnVfFEAYJ`.
- The n8n API key is created in the n8n UI and injected only into a local shell or hosted secret store.
- The key is never committed to the repository and never exposed to GitHub Pages runtime config.

## Configure n8n API Key

In n8n:

1. Log in to the n8n instance.
2. Open `Settings`.
3. Open `n8n API`.
4. Select `Create an API key`.
5. Give it a label such as `meids-local-codex-workflow-update`.
6. Set a short expiration for UAT, for example 1-7 days.
7. If scopes are available, grant the minimum required workflow scopes:
   - workflow read/list
   - workflow update
   - execution read/list, if trace inspection is needed
8. Copy the key once and store it in a password manager.

In PowerShell, set the variables for the current terminal session:

```powershell
$env:N8N_API_BASE_URL = "https://eraneos-agentic-platform.azurewebsites.net"
$env:N8N_API_KEY = "<paste n8n API key>"
$env:N8N_ACTOR_TWIN_WORKFLOW_ID = "eKI3qM7nyCNn9r1q"
$env:N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID = "7Ci86PxXipwvYpKv"
$env:N8N_AGENTIC_BUTLER_WORKFLOW_ID = "KZOqZRUAnVfFEAYJ"
```

Smoke-test the key without printing it:

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "$env:N8N_API_BASE_URL/api/v1/workflows?limit=1" `
  -Headers @{ "X-N8N-API-KEY" = $env:N8N_API_KEY; "accept" = "application/json" }
```

Expected result: JSON with workflow data. If this returns 401/403, rotate or recreate the key with sufficient workflow scopes.

## Apply Live Workflow Mitigations

From the repo root:

```powershell
cd "C:\Users\e729958\Downloads\MeIDs-public-app-sanitized-20260806-01\meids-app-public"

node scripts\prepare-n8n-actor-twin-api-update.cjs --apply
node scripts\prepare-n8n-agent-workflow-api-update.cjs --agent=knowledge_fabric_agent --apply
node scripts\prepare-n8n-agent-workflow-api-update.cjs --agent=agentic_butler --apply
```

The apply scripts:

- validate local workflow artifacts first
- fetch the live workflow
- preserve runtime webhook ids and credentials where possible
- write `live-before`, `update-payload`, `live-after`, and `summary` files under `exports/n8n-live-backups/`
- update live workflows through `PUT /api/v1/workflows/{id}`

## Failed-Test Mitigation

### Failure 1: Knowledge Fabric ingest answered directly

Mitigation:

1. Apply the updated Actor Twin workflow/tool prompt.
2. In the live Actor Twin AI Agent, verify the Knowledge Fabric workflow tool description matches `prompts/actor-twin/tool-descriptions.md`.
3. Verify the Knowledge Fabric tool is connected to the Actor Twin AI Agent as a tool, not only as a disconnected node.
4. Run this UAT prompt:

```text
Remember this public-safe source note as pending OKF evidence: Client alignment meeting moved to Friday and needs a decision log.
```

Expected:

- Actor Twin calls Knowledge Fabric Agent.
- Route is `ingest_or_stage_knowledge`.
- Result is `completed`.
- New/updated OKF material is `review_needed`, `updated`, or `candidate`.

### Failure 2: Create skill times out or normalizes as direct answer

Mitigation:

1. Apply the updated Actor Twin workflow/tool prompt.
2. Apply the updated Agentic Butler workflow.
3. In Agentic Butler, keep create-skill as proposal-only for the first response. Do not generate full executable artifacts inside the same chat turn.
4. Ensure the final Butler response normalizer returns within the n8n chat timeout.
5. Run this UAT prompt:

```text
Create a new skill for preparing a weekly executive steering update from email, calendar, and Teams exports.
```

Expected:

- Actor Twin calls Agentic Butler.
- Route is `create_skill`.
- Result is `approval_required`.
- Output is one concise proposal with mode of action, value/USP, scope, boundaries, task-agent outline, and activation approval.
- No repeated approval loop.

## Validation

Run:

```powershell
npm run check:agents
npm run uat:agents:live
```

If `npm run uat:agents:live` passes, remove the advisory CI gate:

- File: `.github/workflows/intellectual-twin-pages.yml`
- Step: `Validate Chat live n8n UAT artifact`
- Remove: `continue-on-error: true`

Then rerun:

```powershell
npm run check:agents
npm run uat:agents:live
```

## Definition of Done

- n8n API key is configured only in local shell or hosted secret store.
- Actor Twin, Knowledge Fabric Agent, and Agentic Butler live workflows are patched through API or manually aligned to the same source artifacts.
- Live UAT passes 4/4.
- CI live n8n UAT gate can be restored from advisory to strict.

## Execution Result: 2026-09-03

Executed locally:

- `node --check scripts/run-agent-interaction-uat.cjs` passed.
- `npm run check:agents` passed.
- `npm run n8n:actor:update:prepare` prepared an Actor Twin update payload.
- `npm run n8n:agent:update:prepare -- --agent=knowledge_fabric_agent` prepared a Knowledge Fabric update payload.
- `npm run n8n:agent:update:prepare -- --agent=agentic_butler` prepared an Agentic Butler update payload.
- `npm run uat:agents:live` failed with 1/4 passing cases.

Current shell state:

- `N8N_API_BASE_URL` missing.
- `N8N_API_KEY` missing.
- `N8N_ACTOR_TWIN_WORKFLOW_ID` missing.
- `N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID` missing.
- `N8N_AGENTIC_BUTLER_WORKFLOW_ID` missing.

Current live UAT interpretation:

- Direct Actor Twin answer passes.
- Knowledge Fabric ingest is still answered directly by Actor Twin, so the active Actor Twin workflow is not calling the Knowledge Fabric tool.
- Butler email draft regressed to direct Actor Twin answer in the latest live run, so the live Actor Twin tool-selection setup is inconsistent.
- Create-skill still times out and normalizes as direct Actor Twin output.

The immediate blocker is not repo validation. It is live n8n workflow alignment. Configure the n8n API key and apply the prepared payloads, or manually update the Actor Twin AI Agent prompt and both `Call n8n Workflow Tool` descriptions in the n8n UI.
