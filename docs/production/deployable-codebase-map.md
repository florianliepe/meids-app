# Deployable Codebase Map

## Deployable Runtime Files

These files are part of the application runtime or deployment control plane:

```text
backend/
frontend/
contracts/
prompts/
workflows/n8n/
scripts/
package.json
package-lock.json
README.md
docs/production/
docs/uat/
```

## Runtime Boundaries

| Boundary | Files | Deploy target | Notes |
|---|---|---|---|
| Static frontend | `frontend/` | GitHub Pages, Azure Static Web Apps, CDN, static web host | Public assets only. No secrets. |
| Backend proxy | `backend/` | Azure App Service Node.js | Owns private runtime calls, traces, approvals, voice, vector, Postgres. |
| Agent configuration | `prompts/` | n8n workflow system messages via scripts | Source of truth for live agent instruction sync. |
| n8n workflows | `workflows/n8n/` | n8n import/update | Workflow JSON and generated local copies. |
| Contracts | `contracts/` | CI and runtime validation | Schemas, fixtures, replay cases, live probe payloads. |
| Operator automation | `scripts/` | Local operator or CI runner | Build, validate, audit, n8n API update. |
| Production docs | `docs/production/` | Operator docs | Architecture, playbooks, Zielmodus instructions. |

## Non-Deployable Or Evidence Files

These files should not be copied into a clean production deployment package unless
explicitly needed for evidence review:

```text
dist-pages*/
docs/visual-qa/
exports/n8n-live-backups/
exports/n8n-workflow-backups/
qa-*.png
.data/
.env
```

## Clean Deployment Package Rule

A clean deployment package should be reproducible from source:

1. Install dependencies with `npm ci`.
2. Run backend and agent checks.
3. Build static frontend with `node scripts/build-pages-static.cjs`.
4. Deploy `backend/` as Node.js App Service.
5. Deploy generated `dist-pages/` to static hosting.
6. Apply n8n workflow/prompt sync from `scripts/`.

Do not deploy historical `dist-pages-check-*` folders as production source.

## Clean Architecture Refactor Target

The current app is deployable but not yet cleanly modular. The target split is:

- UI state and view rendering separated from runtime integration.
- Backend routing separated from storage, n8n, vector, and voice adapters.
- Agent prompts kept as source-controlled runtime configuration.
- n8n workflow updates idempotent and script-driven.
- Generated evidence excluded from runtime bundles.

## Operator Commands

```powershell
npm ci
npm run check:backend
npm run check:agents
npm run audit:agents
node scripts/build-pages-static.cjs --output dist-pages
```
