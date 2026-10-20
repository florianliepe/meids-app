# Codebase Review And Refactoring Zielmodus

## Objective

Make the Me.IDs app easier to deploy to another system, safer to operate in
Azure, and faster in frontend and agent-runtime paths without changing the lean
Actor Twin interaction model.

## Review Approach

1. Map runtime boundaries:
   - `frontend/`: static UI and browser-local UAT fallback.
   - `backend/`: production proxy, trace persistence, voice transcription,
     vector adapter, n8n admin boundary.
   - `prompts/`: source-controlled agent system instructions.
   - `workflows/n8n/`: importable and live-aligned workflow JSON.
   - `scripts/`: build, validation, n8n import/update, UAT, and readiness tools.
2. Classify code by deployability:
   - production runtime;
   - static staging runtime;
   - generated evidence/artifacts;
   - operator scripts;
   - historical backups.
3. Review clean-code risks:
   - module size;
   - mixed concerns;
   - duplicated runtime configuration;
   - hidden side effects;
   - insecure browser exposure of backend secrets;
   - weak validation gates.
4. Apply only low-risk changes first:
   - documentation and playbooks;
   - validation/audit scripts;
   - prompt runtime budgets;
   - idempotent n8n integration scripts.
5. Defer high-blast-radius refactors until covered by UI smoke tests and route
   fixtures.

## Findings

| Area | Finding | Risk | Recommended action |
|---|---|---:|---|
| Frontend | `frontend/app.js` is about 34k lines. | High maintainability risk | Split by cockpit/module after freezing UAT behavior. |
| Frontend CSS | `frontend/styles.css` is about 29k lines. | Medium maintainability risk | Split into base, layout, components, views, and n8n-chat integration. |
| Runtime config | Static Pages and backend proxy modes coexist. | Medium deployment confusion | Keep explicit install playbook and generated runtime config checks. |
| Generated artifacts | Many `dist-pages-*` and visual QA folders exist. | Medium repo transfer noise | Treat as evidence artifacts; do not deploy or edit directly. |
| Backend | `backend/server.js` is about 1.1k lines. | Medium maintainability risk | Split routes, storage, n8n proxy, voice, vector, and health modules. |
| Agents | Nested n8n workflow tools increase latency. | Medium UX risk | Keep default subagent budget low and audit execution durations. |
| Secrets | Runtime correctly warns against exposing n8n API keys in frontend. | High if violated | Use App Service settings or Key Vault references only. |

## Target Refactoring Packages

### Package 1: Deployability Freeze

- Keep `frontend/`, `backend/`, `prompts/`, `workflows/`, `scripts/`,
  `contracts/`, and `docs/`.
- Exclude generated `dist-pages-*`, screenshots, and live backups from deployment
  packages unless evidence is explicitly requested.
- Add one operator playbook for Azure install.
- Add one runtime audit for prompt size and n8n execution duration.

### Package 2: Backend Modularization

Split `backend/server.js` into:

- `backend/http.js`: HTTP server, CORS, routing shell.
- `backend/routes/agents.js`: Actor Twin, Knowledge Fabric, Butler proxy.
- `backend/routes/traces.js`: trace and approval endpoints.
- `backend/routes/voice.js`: transcription endpoint.
- `backend/routes/vector.js`: vector index endpoints.
- `backend/storage/fileStore.js` and `backend/storage/postgresStore.js`.
- `backend/n8nClient.js`: n8n webhook/admin calls.

Acceptance: `npm run check:backend` passes and endpoint contracts remain stable.

### Package 3: Frontend Modularization

Split `frontend/app.js` into:

- `frontend/src/state.js`
- `frontend/src/api-client.js`
- `frontend/src/router.js`
- `frontend/src/views/actor-twin.js`
- `frontend/src/views/voice-capture.js`
- `frontend/src/views/source-upload.js`
- `frontend/src/views/twins.js`
- `frontend/src/views/knowledge.js`
- `frontend/src/views/graph.js`
- `frontend/src/views/traces.js`
- `frontend/src/views/production.js`
- `frontend/src/n8n-chat.js`

Acceptance: built static artifact remains functionally equivalent and
`pages-smoke-check` passes.

### Package 4: CSS Modularization

Split `frontend/styles.css` into:

- `base.css`
- `layout.css`
- `components.css`
- `forms.css`
- `cockpits.css`
- `n8n-chat.css`
- `responsive.css`

Acceptance: visual QA screenshots show no text overlap regressions.

### Package 5: Agent Runtime Optimization

- Keep Actor Twin direct for low-risk answers.
- Avoid Critical Faculty and Learning Agent on routine turns.
- Default Skill Orchestrator to one Task Agent call.
- Cap default outputs in prompts.
- Run `node scripts/audit-agent-runtime-performance.cjs` after live n8n UAT.

## Current Applied Low-Risk Changes

- Added prompt runtime budgets to Actor Twin, Agentic Butler, Skill Orchestrator,
  Task Agent, Critical Faculty, and Learning Agent.
- Added `scripts/audit-agent-runtime-performance.cjs`.
- Added Azure install playbook.
- Preserved frontend lean mode: Actor Twin remains the only user-facing chat.

## Research Basis

- Azure App Service should store runtime secrets as application settings or Key
  Vault references.
- Azure Static Web Apps/GitHub Pages-style static hosting is appropriate for
  public static frontend assets, but not for secret-bearing runtime calls.
- n8n API keys and private webhook tokens belong in backend or n8n runtime
  settings, not browser assets.
- After-action review, premortem, and double-loop learning patterns are useful
  for agent-runtime improvement loops.
