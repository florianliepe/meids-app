# Target Mode: Actor Direct Agent Tooling

## Zielmodus instruction

Goal: harden MeIDs agent interaction so Actor Twin is the single UI-facing orchestrator, while Knowledge Fabric Agent and Agentic Butler run as autonomous callable workers behind it.

Scope:
- Actor Twin owns route decisions and calls target workflows directly in n8n for UAT.
- Knowledge Fabric Agent is called for retrieval, source staging, OKF handoff, graph candidate creation, and later vector refresh boundaries.
- Agentic Butler is called for normal work artifacts and approved-skill execution. The internal Skill Orchestrator remains a Butler component.
- Human approval is required only before a generated skill, generated agent/subagent/task-agent, or generated capability becomes active, and later before real external irreversible writes.
- Normal drafting, planning, meeting preparation, summaries, backlog updates, and internal orchestration are autonomous under Actor Twin steering.

## n8n architecture

Current UAT pattern:
- Actor Twin workflow receives the public chat request.
- Actor Twin AI Agent decides `route_decision`.
- Normalize route node overrides model mistakes from the original user query.
- Switch node calls:
  - Knowledge Fabric Agent webhook for `retrieve_knowledge` and `ingest_or_stage_knowledge`.
  - Agentic Butler webhook for `activate_skill` and `create_skill`.
- Finalize node unwraps delegated JSON and returns one clean Actor Twin response.

Recommended production pattern:
- Replace public inter-agent webhook calls with n8n `Execute Workflow` nodes when all workflows live in the same n8n instance.
- Keep public webhooks only for UI/backend entrypoints.
- Move runtime secrets and webhook URLs into the hosted backend or n8n environment variables.
- Persist traces, approvals, and route decisions in Postgres.

## Import-ready files

Import these files into n8n, not the wrapped implementation files:

- `workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json`
- `workflows/n8n/import-ready/knowledge-fabric-agent.ai-agent.import.json`
- `workflows/n8n/import-ready/agentic-butler.ai-agent.import.json`

The wrapped files under `workflows/n8n/implementations/` are documentation/source artifacts and may contain metadata outside n8n's required `nodes` and `connections` shape.

## UAT checks

1. `who are you`
   - Expected: direct Actor Twin answer.
   - No Butler call.
   - No approval card.

2. `write an email for the dev team to define the next MeIDs features`
   - Expected: Actor Twin delegates to Agentic Butler.
   - Butler returns `completed`.
   - UI renders an email draft artifact, not raw JSON.
   - No approval card.

3. `create a new skill for preparing supplier negotiation briefs`
   - Expected: Actor Twin delegates to Agentic Butler.
   - Butler returns `approval_required`.
   - Output contains a concept proposal: mode of action, value proposition, USP/differentiation, decomposition outline.
   - Approval gates activation/decomposition, not the proposal itself.

4. `remember this transcript as a pending concept`
   - Expected: Actor Twin delegates to Knowledge Fabric Agent.
   - Knowledge Fabric returns pending OKF/evidence handoff.
   - No approval card; human review happens in Review Cockpit.

## Known boundaries

- Voice playback on GitHub Pages requires a hosted voice backend or n8n voice webhook. Static Pages must not call `/api/voice/speak`.
- Azure AI Search/vector refresh remains a backend/Knowledge Fabric integration step; current UI must treat vector context as optional.
