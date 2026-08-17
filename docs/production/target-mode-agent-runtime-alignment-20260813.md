# Target Mode: Agent Runtime Alignment

## Goal
Enable the Actor Twin as the routing authority for MeIDs agent interaction:

- answer direct questions itself
- call Knowledge Fabric Agent for retrieval, ingest, OKF staging, graph and vector boundaries
- call Agentic Butler for work artifact generation and approved skill execution
- require human approval only before a generated skill, generated agent, generated task-agent, or external write/send/schedule action becomes active

## Architecture Decision
Use Actor Twin as the top-level n8n orchestrator. Knowledge Fabric Agent and Agentic Butler remain separate workflows for clean ownership, but they are called directly by Actor Twin through n8n HTTP nodes.

Agentic Butler owns skill execution and skill/agent proposal generation. The internal skill orchestrator is not a top-level user-facing workflow; it is a Butler component.

## Current Implementation State

Source artifacts are ready:

- `workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json`
- `workflows/n8n/implementations/actor-twin-direct-orchestrator.uat-live-urls.workflow.json`
- `exports/n8n-live-backups/20260813T152445Z-actor-direct-orchestrator/actor-twin.direct-orchestrator.update-payload.json`

Local validation passes:

- n8n fixture validation
- Actor Twin route validation
- direct-orchestrator import validation
- direct-orchestrator simulation including empty AI output for explicit `create_skill`
- static frontend smoke build

Live UAT status at `2026-08-13T15:30:54Z`:

- `3/4` passed
- `answer_direct` passed
- Agentic Butler work artifact passed: `activate_skill`, no approval gate, delegate trace returned
- Agentic Butler skill creation passed: `create_skill`, approval required, delegate trace returned
- Knowledge Fabric failed: direct probe to `meids/knowledge-fabric/ingest` returns HTTP 200 with an empty body

Interpretation: the live Actor Twin workflow is now mostly aligned. The remaining live blocker is the Knowledge Fabric workflow response: the active production webhook must be replaced with the import-ready AI Agent workflow that ends in `Return JSON`.

## Required Live Alignment

1. Import or API-apply:
   `workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json`
2. Confirm webhook path:
   `meids/actor-twin/chat`
3. Confirm nodes:
   - Receive request
   - Actor Twin AI Agent
   - Normalize route decision
   - Switch by route
   - Call Knowledge Fabric Agent
   - Call Agentic Butler
   - Finalize Actor Twin response
   - Return JSON
   - Actor Twin Chat Model
4. Confirm Actor Twin Chat Model keeps the Eraneos LLM Gateway credential.
5. Publish the workflow.
6. Run:
   `npm run uat:agents:live`

## Required Knowledge Fabric Alignment

Import or API-apply:

`workflows/n8n/import-ready/knowledge-fabric-agent.ai-agent.import.json`

Then confirm:

- production webhook path is `meids/knowledge-fabric/ingest`
- workflow is published
- nodes are:
  - Receive request
  - Knowledge Fabric AI Agent
  - Knowledge Fabric Chat Model
  - Contract response normalizer
  - Return JSON
- `Knowledge Fabric Chat Model` uses the Eraneos LLM Gateway credential
- direct POST to the webhook returns a JSON envelope with `agent_id: knowledge_fabric_agent`, `status: completed`, `output.summary`, and `trace.trace_id`

Prepared API payload:

`exports/n8n-live-backups/20260813T153440Z-knowledge_fabric_agent-ai-agent/knowledge_fabric_agent.update-payload.json`

API apply command once the workflow ID and n8n API key are present:

```powershell
$env:N8N_API_BASE_URL = "https://eraneos-agentic-platform.azurewebsites.net"
$env:N8N_API_KEY = "<n8n-api-key>"
$env:N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID = "<live-knowledge-fabric-workflow-id>"
npm run n8n:agent:update:apply -- --agent=knowledge_fabric_agent
npm run uat:agents:live
```

### Preferred API Apply

Use this path when an n8n API key is available in the local shell:

```powershell
$env:N8N_API_BASE_URL = "https://eraneos-agentic-platform.azurewebsites.net"
$env:N8N_API_KEY = "<n8n-api-key>"
npm run n8n:actor:update:apply
npm run uat:agents:live
```

The prepared API payload is:

`exports/n8n-live-backups/20260813T152445Z-actor-direct-orchestrator/actor-twin.direct-orchestrator.update-payload.json`

### Manual Import Guardrails

If importing through the n8n browser UI:

- import the exact file `workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json`
- ensure only the intended published Actor Twin workflow owns the production webhook path `meids/actor-twin/chat`
- unpublish or move older duplicate workflows using the same path
- after import, open the `Normalize route decision` execution output and verify it contains `route_decision.decision`
- run a delegated test and verify the `Switch by route` node has a non-fallback branch execution
- verify the final response contains `trace.trace_id` and, for delegated routes, `delegate_result.trace.trace_id`

## Expected UAT Results

- `who are you` -> `actor_twin`, `answer_direct`, `completed`
- `Remember this source note...` -> `knowledge_fabric_agent`, `ingest_or_stage_knowledge`, `completed`
- `Write an email... draft only` -> `agentic_butler`, `activate_skill`, `completed`, no approval gate
- `Create a new skill...` -> `agentic_butler`, `create_skill`, `approval_required`

## Frontend Boundary

Actor Twin chat must stay lean:

- no production-path panel
- no n8n contract diagnostics
- no raw JSON payload dump
- no approval card for normal Butler work artifacts
- approval card only for generated skill or generated agent activation
- trace details stay in Review/Trace cockpit

GitHub Pages static mode must not call unavailable backend endpoints for:

- skill elicitation
- concept detail drawers
- trace detail drawers
- voice playback

It should use static fallback or concise hosted-backend-required messaging instead.

## Final Local Hardening

Updated at `2026-08-13`.

The local app and import-ready n8n workflow artifacts now enforce the refined autonomy boundary:

- Actor Twin is the UI-facing route authority.
- Knowledge Fabric Agent can act autonomously when called by Actor Twin; it stages OKF candidates, evidence, graph/vector signals, and review state without requiring chat approval.
- Agentic Butler can act autonomously for normal work artifacts and approved skill execution, including drafts, plans, summaries, and meeting preparation.
- Agentic Butler requires approval only when it proposes a new skill, new agent, new task-agent, new subagent, or any future external write/send/schedule action.
- Skill/agent creation approval means approving the generated concept/specification for activation; it is not required for every Butler run.
- Chat renders clean user-facing artifacts, not raw contract envelopes. Trace/debug/probe details belong in the Review, Traces, and Production cockpits.

### Import Order for Live n8n

Apply the import-ready JSONs in this order:

1. `workflows/n8n/import-ready/knowledge-fabric-agent.ai-agent.import.json`
2. `workflows/n8n/import-ready/agentic-butler.ai-agent.import.json`
3. `workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json`

After import:

- publish all three workflows
- ensure no duplicate active workflow owns the same webhook path
- confirm all chat model nodes use `Eraneos LLM Gateway`
- confirm production webhook paths:
  - `meids/actor-twin/chat`
  - `meids/knowledge-fabric/ingest`
  - `meids/agentic-butler/run`

### UAT Checklist

Run these tests through the GitHub Pages Chat UI after importing all three workflows:

1. `who are you`
   - Expected: direct Actor Twin answer
   - No Agentic Butler card
   - No approval gate

2. `write an email for the dev team to define the next features for MeIDs-App`
   - Expected: delegated via Agentic Butler
   - Status: `completed`
   - No approval gate
   - Output renders as a clean email artifact, not raw JSON

3. `create a new skill for preparing steering committee meetings`
   - Expected: delegated via Agentic Butler
   - Status: `approval_required`
   - Approval is for the skill/agent proposal only
   - No active skill is created until approved

4. `remember this source note: ...`
   - Expected: delegated via Knowledge Fabric Agent
   - Status: `completed`
   - Output shows pending OKF / review-state summary
   - No approval gate in chat

5. Open trace from a delegated result
   - Expected: Review/Trace cockpit opens
   - No `405` HTML error in the drawer

6. Press voice playback on GitHub Pages
   - Expected: either no voice button or hosted-backend-required message
   - No `/api/voice/speak` 405 spam

### Local Validation Evidence

The following validations passed locally after the final hardening:

- `node --check frontend\app.js`
- `node scripts\build-actor-twin-direct-orchestrator-uat.cjs`
- `node scripts\build-ai-agent-workflow-imports.cjs`
- `node scripts\validate-actor-twin-direct-orchestrator-import.cjs`
- `npm run check:backend`
- `npm run check:agents`
- `node scripts\build-pages-static.cjs --output dist-pages-agent-runtime-final --clean --smoke`

The last static build output is:

`dist-pages-agent-runtime-final`

## Live UAT Evidence

Latest live UAT run at `2026-08-13T16:00:46Z`:

- `2/4` passed
- passed: Agentic Butler normal work artifact route
- passed: Agentic Butler new skill proposal route
- failed: direct Actor Twin answer returned `{}` instead of a usable answer
- failed: Knowledge Fabric ingest route returned `answer_direct` / `{}` instead of delegated Knowledge Fabric output

Evidence file:

`docs/uat/agent-interaction-uat-results.json`

Required action:

Import and publish the regenerated Actor Twin direct-orchestrator workflow:

`workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json`

This regenerated version includes a direct-answer fallback so identity/purpose questions cannot finalize as `{}` when the AI node output is empty. After importing Actor Twin, also re-import/publish the Knowledge Fabric and Agentic Butler AI-agent workflows to keep all three contracts aligned.

Verification command:

```powershell
npm run uat:agents:live
```

## Current Evidence Update

Latest live UAT run at `2026-08-13T16:08:03Z`:

- `3/4` passed
- passed: Actor Twin direct answer route
- passed: Knowledge Fabric ingest/stage route
- passed: Agentic Butler normal work artifact route, no approval gate
- failed: Agentic Butler create-skill route did not produce a delegate trace because the live Actor Twin workflow stopped on a pre-delegation approval branch

Local fix applied:

- regenerated `workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json`
- removed the pre-delegation `route_decision.approval_required` switch branch
- enforced that all `target_agent: agentic_butler` routes, including `create_skill`, call Agentic Butler first
- added validator coverage: `skill_creation_delegates_before_approval`

Required live action:

Import and publish the regenerated Actor Twin workflow again:

`workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json`

Expected result after import:

- `Create a new skill...` routes to Agentic Butler
- Actor Twin final response remains `approval_required`
- `delegate_result.agent_id` is `agentic_butler`
- `trace.delegate_trace_id` is present

## Live UAT Green State

Latest live UAT run at `2026-08-13T16:23:03Z`:

- `4/4` passed
- passed: Actor Twin direct answer route
- passed: Knowledge Fabric ingest/stage route with delegate trace
- passed: Agentic Butler normal work artifact route with delegate trace and no approval gate
- passed: Agentic Butler create-skill route with delegate trace and `approval_required`

Evidence file:

`docs/uat/agent-interaction-uat-results.json`

Validation command:

```powershell
npm run uat:agents:live
```

Conclusion:

- Actor Twin now directly orchestrates Knowledge Fabric Agent and Agentic Butler through the live n8n workflow.
- Agentic Butler can execute normal Actor Twin delegated work autonomously.
- Approval is reserved for generated skill/agent activation, not ordinary Butler execution.

## 2026-08-17 Embedded n8n Chat UAT Update

Current frontend target state is confirmed:

- GitHub Pages uses the embedded n8n Actor Twin chat as the only visible Actor Twin chat input.
- The retired local/generic chat composer is not present in the user-facing Actor Twin surface.
- Interaction setup remains available as n8n context: posture, source scopes, vector-cache retrieval mode, knowledge-graph usage, websearch, voice-answer preference, and applied skill hints.
- Static GitHub Pages mode remains local-browser scoped for setup/review persistence until the hosted backend/API is available.

Latest live UAT run:

```powershell
node scripts\run-agent-interaction-uat.cjs
```

Evidence file:

`docs/uat/agent-interaction-uat-results.json`

Result:

- `1/4` passed
- passed: Actor Twin direct answer route through embedded n8n chat
- failed: Knowledge Fabric handoff because the live Knowledge Fabric workflow returns `Simple Memory1` sub-node failure
- failed: Agentic Butler normal work artifact handoff because the live Butler route times out or returns the missing-node failure in prior runs
- failed: Agentic Butler create-skill handoff because live Butler reports `Referenced node doesn't exist` and returns `completed` instead of `approval_required`

Current interpretation:

- This is no longer a frontend routing/composer issue.
- The active embedded Actor Twin chat endpoint is reachable and can answer directly.
- Remaining failures are downstream n8n worker-workflow issues:
  - repair/remove/reconnect the Knowledge Fabric `Simple Memory1` node
  - repair the Agentic Butler workflow/tool reference that returns `Referenced node doesn't exist`
  - ensure create-skill returns `approval_required` only for generated skill/agent activation, while normal Butler artifacts return `completed`

Next Zielmodus execution boundary:

1. Repair the live Knowledge Fabric workflow memory/tool wiring.
2. Repair the live Agentic Butler workflow/tool reference.
3. Re-run embedded-chat live UAT until all four cases pass.
4. Keep production/review diagnostics in cockpit views; do not reintroduce local generic chat controls into Actor Twin.
