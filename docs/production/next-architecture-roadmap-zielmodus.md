# MeIDs Next Architecture Roadmap and Zielmodus

## Target Architecture

The next implementation direction keeps three top-level agents:

1. **Actor Twin**
   - UI-facing decision and answer authority.
   - Owns intent routing and final response synthesis.
   - Calls Knowledge Fabric Agent or Agentic Butler only when the request needs background capability.

2. **Knowledge Fabric Agent**
   - Owns OKF Markdown/YAML staging, evidence records, CRUD/audit, graph curation, and vector refresh requests.
   - Runs autonomously when called by Actor Twin.
   - Does not ask the user for approval during normal ingest/retrieval; review happens in Knowledge/Review cockpit.

3. **Agentic Butler**
   - Owns work execution, approved skill activation, and new skill/agent proposal generation.
   - Runs autonomously for no-write work artifacts such as drafts, plans, briefs, summaries, and internal skill runs.
   - Requires human approval only before activating a generated skill, generated agent, generated task-agent, generated subagent, or executing a future external side-effect action.

Internal components:

- **Graph Curator** is a Knowledge Fabric subcomponent.
- **Vector Refresh Worker** is a Knowledge Fabric subcomponent that calls backend proxy endpoints, not Azure directly.
- **Skill Orchestrator** is an Agentic Butler subcomponent.
- **Task Agents** are internal Butler workers generated from approved skill specs.

## Build Order

### Phase 1: Stabilize live n8n agent runtime

Outcome: Actor Twin reliably routes to the right target and no longer shows approval loops for ordinary Butler work.

Steps:

1. Re-apply and publish the verified Actor Twin direct-orchestrator workflow.
2. Re-apply and publish Knowledge Fabric Agent and Agentic Butler AI-agent workflows.
3. Confirm all three chat model nodes use the Eraneos LLM Gateway credential.
4. Run live UAT for:
   - direct answer
   - Knowledge Fabric ingest/stage
   - Agentic Butler work artifact
   - Agentic Butler skill/agent proposal
5. Store UAT evidence in `docs/uat/agent-interaction-uat-results.json`.

Acceptance:

- `npm run check:agents` passes.
- `npm run uat:agents:live` passes or documents only external workflow/credential blockers.
- Chat renders user-facing artifacts, not raw JSON envelopes.

### Phase 2: Harden approval semantics

Outcome: approval is specific and resumable, not a generic blocker.

Approval rules:

- No approval for Actor Twin calling Knowledge Fabric Agent.
- No approval for Actor Twin calling Agentic Butler for no-write artifacts.
- Approval required for:
  - generated skill activation
  - generated agent/task-agent/subagent activation
  - external send/schedule/publish/delete/commit actions

Steps:

1. Encode these rules in Actor Twin and Agentic Butler system prompts.
2. Normalize `approval_required` only after Butler returns a generated capability proposal.
3. Persist approval objects with `approval_type`, `proposed_action`, `resume_payload`, and `activation_target`.
4. Keep approval details out of the lean Actor Twin page; expose them in Review/Traces cockpit.

Acceptance:

- Email draft requests complete without approval.
- Skill creation returns a proposal and an approval card.
- Approving a skill proposal creates or stages activation artifacts instead of repeating the same approval response.

### Phase 3: Production backend proxy and persistence

Outcome: GitHub Pages becomes a static frontend; backend handles secrets, traces, approvals, n8n admin actions, and Azure vector access.

Steps:

1. Host `backend/server.js` as the MeIDs backend service.
2. Add backend-only secrets for n8n, Azure AI Search, Azure OpenAI embeddings, and database.
3. Route frontend production calls through backend endpoints:
   - `/api/agents/actor-twin/chat`
   - `/api/agents/knowledge-fabric/ingest`
   - `/api/agents/agentic-butler/run`
   - `/api/approvals`
   - `/api/approvals/:id/resume`
   - `/api/traces`
4. Move traces and approvals from local/static artifacts to Postgres.
5. Keep n8n API-key backed admin endpoints disabled until hosted secret storage is active.

Acceptance:

- GitHub Pages contains no secrets.
- Trace drawers load from backend JSON, not GitHub Pages HTML fallbacks.
- Approval resume works outside local mode.

### Phase 4: Azure AI Search vector integration

Outcome: Actor Twin can retrieve approved OKF knowledge through Azure AI Search, while drafts remain controlled.

Decision:

- Use one Azure AI Search service with shared indexes and metadata filters.
- Use two indexes:
  - `meids-okf-approved-v1`
  - `meids-okf-working-v1`
- Enforce tenant/twin/visibility/review-state filters in backend.

Steps:

1. Confirm Azure Search service `srch-intellectual-twin` is running.
2. Confirm or create Azure OpenAI embedding deployment.
3. Store Azure Search and Azure OpenAI keys only in backend settings or Key Vault.
4. Run index setup:
   - `npm run setup:azure-search -- --dry-run`
   - `npm run setup:azure-search`
5. Wire Knowledge Fabric Agent vector refresh to backend:
   - `/api/vector-index/rebuild`
6. Wire Actor Twin retrieval to backend:
   - `/api/vector-index/search`
7. Keep default retrieval policy `approved_only`.
8. Allow `selected_pending` retrieval only with visible attribution.

Acceptance:

- `npm run check:backend` passes with secrets configured in backend/operator shell.
- Approved OKF concept upsert succeeds.
- Actor Twin can cite vector-backed OKF evidence.

### Phase 5: Knowledge graph and compound retrieval

Outcome: Actor Twin uses OKF + vector + graph context as one governed context package.

Steps:

1. Promote accepted graph candidate edges from Review cockpit.
2. Store graph node/edge state in Postgres graph projection tables.
3. Link graph nodes to OKF concepts, evidence IDs, and vector document IDs.
4. Add backend context packaging:
   - vector hits
   - graph neighbors
   - OKF markdown summary
   - evidence provenance
5. Feed that context package into Actor Twin before final answer synthesis.

Acceptance:

- Knowledge Graph distinguishes approved, candidate, inferred, rejected, and needs-rework edges.
- Actor Twin answers cite OKF/evidence and can explain relevant graph relations.

### Phase 6: Skill and agent creation loop

Outcome: Agentic Butler can propose and, after approval, generate reusable skills and internal task agents.

Steps:

1. Butler creates a concept proposal:
   - skill/agent purpose
   - value and USP
   - trigger/non-trigger
   - expected outputs
   - capability boundaries
   - required task agents
2. Human approves the proposal.
3. Butler decomposes into:
   - `SKILL.md`
   - `skill.config.yaml`
   - prompts
   - schemas
   - eval fixtures
4. Generated artifact stays pending until repository writeback and review pass.
5. Approved skill becomes callable by Actor Twin through Agentic Butler.

Acceptance:

- Skill proposal approval does not loop.
- Generated skill artifacts are versioned.
- Actor Twin can activate approved skill without new approval unless an external side effect is requested.

## Zielmodus Package 1: Agent Runtime Closure

Goal: Close the live n8n interaction blockers so Actor Twin routes correctly and Butler/KFA return clean envelopes.

Execute:

1. Validate local artifacts:
   - `npm run check:agents`
   - `node scripts/validate-actor-twin-direct-orchestrator-import.cjs`
   - `node scripts/simulate-actor-twin-direct-orchestrator-import.cjs`
2. Rebuild import-ready workflows if needed.
3. Apply/publish in n8n:
   - `workflows/n8n/import-ready/knowledge-fabric-agent.ai-agent.import.json`
   - `workflows/n8n/import-ready/agentic-butler.ai-agent.import.json`
   - `workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json`
4. Run:
   - `npm run uat:agents:live`
5. Patch only defects proven by UAT.
6. Deploy GitHub Pages if frontend/static assets changed.

Definition of Done:

- Direct answer, knowledge handoff, Butler work artifact, and Butler create-skill proposal behave as specified.
- No raw JSON in Chat output.
- No approval loop for ordinary Butler work.

## Zielmodus Package 2: Backend Proxy and Persistence

Goal: Move runtime interaction from static GitHub Pages into a hosted backend with durable traces and approvals.

Execute:

1. Prepare hosted backend deployment settings from `deploy/backend-proxy.app-service.env.example`.
2. Configure backend-only secrets:
   - `N8N_API_BASE_URL`
   - `N8N_API_KEY`
   - agent webhook URLs
   - `DATABASE_URL`
3. Implement or verify endpoints:
   - `/api/agents/*`
   - `/api/traces`
   - `/api/approvals`
   - `/api/approvals/:id/resume`
4. Persist trace chains and approval queue in Postgres.
5. Switch GitHub Pages runtime config from direct n8n URLs to backend proxy URL when hosted.
6. Validate browser UAT against hosted backend.

Definition of Done:

- Chat works through backend proxy.
- Review/Trace cockpit loads trace JSON, not HTML fallback.
- Approval resume works without localStorage.

## Zielmodus Package 3: Azure Vector Activation

Goal: Connect approved OKF knowledge to Azure AI Search through backend-only secrets.

Execute:

1. Confirm Azure resources:
   - resource group `rg-ai-intellectual-twin`
   - search service `srch-intellectual-twin`
   - Azure OpenAI embedding deployment
2. Configure backend-only Azure settings.
3. Create/update indexes:
   - `meids-okf-approved-v1`
   - `meids-okf-working-v1`
4. Run first approved OKF upsert.
5. Add Knowledge Fabric vector refresh call to backend.
6. Add Actor Twin retrieval call to backend.
7. Validate approved-only retrieval.

Definition of Done:

- Approved OKF concepts are searchable.
- Draft/pending material is excluded unless explicitly selected.
- Actor Twin answers include OKF/evidence citations.

## Zielmodus Package 4: Compound Knowledge Fabric

Goal: Make OKF, graph, vector, and evidence work as one retrieval fabric.

Execute:

1. Persist graph projections in Postgres.
2. Add graph relation promotion workflow.
3. Link graph edges to OKF concept IDs and evidence IDs.
4. Add context-packaging endpoint for Actor Twin.
5. Add cockpit controls for approved/candidate/inferred graph layers.
6. Validate with source upload and transcript flows.

Definition of Done:

- Graph, vector, OKF, and evidence references are aligned.
- Actor Twin can explain why a source was used.

## Zielmodus Package 5: Skill and Agent Creation Runtime

Goal: Let Agentic Butler propose and generate reusable skills/agents after approval.

Execute:

1. Refine Butler prompt and response schema for proposals.
2. Add approval resume semantics for generated capability activation.
3. Generate skill artifacts after approval.
4. Add eval fixture generation.
5. Register approved skill for Actor Twin activation.
6. Store full trace and approval lineage.

Definition of Done:

- Skill proposal approval leads to artifact generation.
- Generated skill stays versioned and reviewable.
- Actor Twin can call approved skill through Butler.

## Current Execution Recommendation

Start with **Zielmodus Package 1**.

Reason:

- Azure vector integration depends on a stable Knowledge Fabric response contract.
- Backend persistence depends on stable trace/approval envelope semantics.
- Skill creation depends on fixing Butler approval/resume semantics.
- Frontend polish depends on stable output shape.

Do not mutate Azure Search indexes until backend secrets and embedding deployment are confirmed.

## Activation Baseline: 2026-08-13

Local gates executed:

- `npm run check:agents` passed.
- `npm run check:backend` passed.
- `node --check frontend/app.js` passed.

Current interpretation:

- Agent contracts, n8n import-ready workflow artifacts, Actor Twin routing simulation, backend proxy contract, and Azure Search index schema contracts are locally valid.
- Azure vector activation is **ready for secret activation**, but live indexing remains blocked until a hosted backend and embedding secrets are configured.
- Next practical execution step is live n8n UAT/import alignment for Package 1, followed by hosted backend setup for Package 2.
