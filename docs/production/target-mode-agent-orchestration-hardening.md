# Target Mode: Actor Twin Direct Agent Orchestration

## Goal
Harden MeIDs agent interaction so the Actor Twin is the visible decision authority while n8n worker workflows run behind it as callable tools.

## Architecture
- Actor Twin workflow receives the chat request, interprets intent, and emits one `route_decision`.
- `answer_direct` stays inside Actor Twin.
- `retrieve_knowledge` and `ingest_or_stage_knowledge` call Knowledge Fabric Agent.
- `activate_skill` and normal work artifacts call Agentic Butler autonomously.
- `create_skill` calls Agentic Butler and returns `approval_required` before generated skill, task-agent, subagent, or agent activation.
- Graph Curator remains an internal Knowledge Fabric component.
- Skill Orchestrator remains an internal Agentic Butler component.

## Approval Boundary
- No approval for Actor Twin delegation to Knowledge Fabric Agent.
- No approval for Agentic Butler drafts, plans, meeting prep, summaries, backlog/status updates, or internal skill runs.
- Approval is required before a generated skill or agent becomes active.
- Future external side-effect tools such as send, schedule, publish, delete, or commit must add an explicit approval gate before execution.

## n8n Import Order
1. Import and publish:
   `workflows/n8n/import-ready/agentic-butler.ai-agent.import.json`
2. Import and publish:
   `workflows/n8n/import-ready/knowledge-fabric-agent.ai-agent.import.json`
3. Import and publish:
   `workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json`

The Actor Twin import includes direct public UAT URLs for Knowledge Fabric Agent and Agentic Butler. Production hardening should move those calls behind backend proxy endpoints and hosted secrets.

## UAT Checklist
| ID | Prompt | Expected route | Expected target | Expected status |
|---|---|---|---|---|
| UAT-AI-001 | Who are you? | `answer_direct` | `actor_twin` | `completed` |
| UAT-AI-002 | Remember this public-safe source note as pending OKF evidence... | `ingest_or_stage_knowledge` | `knowledge_fabric_agent` | `completed` |
| UAT-AI-003 | Write an email for the dev team... Draft only; do not send. | `activate_skill` | `agentic_butler` | `completed` |
| UAT-AI-004 | Create a new skill for preparing a weekly executive steering update... | `create_skill` | `agentic_butler` | `approval_required` |

Run:

```powershell
npm run uat:agents:live
```

## Current Live UAT Finding
As of 2026-08-13T16:17:04Z, local contract validation passes but live UAT is `2/4`.

Passing:
- `answer_direct` for identity / ordinary Actor Twin answers.
- Knowledge Fabric handoff returns a delegated `knowledge_fabric_agent` response with a delegate trace.

Failing:
- Agentic Butler draft-only work artifact is classified as `activate_skill`, but the live response has no `delegate_trace_id`; Actor Twin appears to describe a handoff without actually executing `Call Agentic Butler`.
- Agentic Butler create-skill returns `{}` / `answer_direct` instead of delegated `create_skill` with `approval_required`.

Interpretation:
- The verified local import artifact is correct, including executable simulation of the exact n8n `Normalize route decision` code.
- The active live n8n workflow behind `/webhook/meids/actor-twin/chat` still does not match the verified import artifact for Agentic Butler branches, or the published version is not the recently regenerated version.
- The regenerated import has exactly three switch rules: `answer_direct`, `knowledge_fabric_agent`, and `agentic_butler`. It has no pre-delegation `route_decision.approval_required` branch, so `create_skill` must call Agentic Butler first and only then return approval for skill/agent activation.
- Treat live UAT failure as runtime import/publish drift until the active workflow is re-imported and verified.

Required runtime action:
- Validate the import artifact locally before applying it:
  `node scripts/validate-actor-twin-direct-orchestrator-import.cjs`
- Simulate the n8n `Normalize route decision` node before applying it:
  `node scripts/simulate-actor-twin-direct-orchestrator-import.cjs`
- Prepare an n8n API update payload from the verified artifact:
  `npm run n8n:actor:update:prepare`
- If backend-only n8n API credentials are available, apply the update:
  ```powershell
  $env:N8N_API_BASE_URL = "https://eraneos-agentic-platform.azurewebsites.net"
  $env:N8N_API_KEY = "<backend-only-n8n-api-key>"
  $env:N8N_ACTOR_TWIN_WORKFLOW_ID = "fDn8yXo3W41hh3yR"
  npm run n8n:actor:update:apply
  ```
- Import and publish the regenerated workflow file:
  `workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json`
- Apply it to the workflow that owns the production webhook path:
  `meids/actor-twin/chat`
- Verify before publishing that the active workflow contains these nodes in order:
  `Receive request` -> `Actor Twin AI Agent` -> `Normalize route decision` -> `Switch by route` -> `Call Knowledge Fabric Agent` / `Call Agentic Butler` -> `Finalize Actor Twin response` -> `Return JSON`
- Verify the `Normalize route decision` node gives precedence to parsed embedded Actor Twin JSON before fallback/default routing. The knowledge-ingest test currently fails when this node defaults to `answer_direct` while the embedded AI output already says to hand off to Knowledge Fabric.
- Verify `Switch by route` has no condition using `route_decision.approval_required`. Approval handling belongs after Agentic Butler returns for `create_skill`, not before delegation.
- Verify output 2 of `Switch by route` connects to `Call Agentic Butler`.
- Then rerun:
  `npm run uat:agents:live`

Expected result after import:
- `4/4` live UAT cases pass.

## API Apply Guard
`scripts/prepare-n8n-actor-twin-api-update.cjs` defaults to dry-run. It validates the import file, simulates the route normalizer, writes an update payload under `exports/n8n-live-backups/`, and does not contact n8n unless `--apply` is passed.

When `--apply` is used, the script:
- requires `N8N_API_BASE_URL` and `N8N_API_KEY`;
- reads the current live Actor Twin workflow first;
- writes `actor-twin.live-before.json`;
- preserves live webhook IDs and model credentials by node name;
- applies the verified 9-node direct-orchestrator payload through `PUT /api/v1/workflows/{id}`;
- writes `actor-twin.live-after.json`.

The API key must remain backend/operator-only. Do not add it to GitHub Pages runtime config or browser storage.

## Known Production Gaps
- Static GitHub Pages cannot execute voice playback; it requires the hosted voice backend.
- Static GitHub Pages cannot persist trace chains or approval queues beyond browser/local artifacts.
- Trace review and approval resume require hosted backend proxy endpoints and Postgres persistence.
- Azure AI Search vector refresh is prepared as a boundary but not yet connected to production indexing.
