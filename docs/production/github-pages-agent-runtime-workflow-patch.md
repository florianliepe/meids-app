# GitHub Pages Agent Runtime Workflow Patch

Date: 2026-08-10
Status: partially applied. The workflow injects runtime agent URLs and regenerates runtime readiness, but the follow-up patch that regenerates live preflight and Zielmodus live completion checklist from the built `dist-pages/assets` is pending a GitHub token with `workflow` scope or a manual workflow edit.
Owner: MeIDs production setup

## Purpose

This document records the GitHub Pages workflow update needed to inject all three MeIDs top-level n8n agent URLs into the public runtime assets during deployment:

- `runtime-config.js`
- `assets/agent-runtime-config.json`
- `assets/n8n-runtime-readiness-status.json`
- `assets/n8n-live-readiness-preflight.json`
- `assets/zielmodus-4-live-completion-checklist.json`

## Current Supported Paths

Preferred production path: keep the workflow patch active, configure GitHub repository secrets, and rerun the Pages workflow.

Fallback path for local/static public UAT testing: configure intentionally public webhook URLs through:

```text
frontend/assets/agent-runtime-config.json
```

That asset is used unchanged for local/static fallback testing. In the hosted GitHub Pages build, the workflow regenerates `dist-pages/assets/agent-runtime-config.json` from repository secrets and then regenerates `dist-pages/assets/n8n-runtime-readiness-status.json` from that same file. The Production/Review Cockpit uses these assets to distinguish:

- `configured`
- `awaiting_url`
- `missing URL`
- `n8n connected`

Do not place secrets, bearer tokens, private n8n URLs, Azure keys, or internal endpoints in this public asset.

## Preconditions

Before using live n8n URLs through workflow-generated config:

1. Confirm all webhook URLs are safe to expose to GitHub Pages users, or proxy private endpoints through a hosted backend.
2. Configure the required secrets in `Settings -> Secrets and variables -> Actions -> Repository secrets`.
3. Rerun the Pages workflow after secret updates.
4. Keep `frontend/assets/agent-runtime-config.json` as fallback for public UAT setup and local static testing.

## Required Secrets

| Secret | Purpose | Required |
|---|---|---|
| `GH_PAGES_API_BASE_URL` | Hosted backend URL when Pages should call a backend API instead of static fixture mode. | Optional |
| `GH_PAGES_N8N_CHAT_WEBHOOK_URL` | Existing chat / Actor Twin fallback webhook. | Optional but recommended |
| `GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL` | Explicit Actor Twin contract webhook. Falls back to chat webhook when empty. | Optional |
| `GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL` | Knowledge Fabric Agent ingest / graph / vector handoff webhook. | Required for Knowledge Fabric live UAT |
| `GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL` | Agentic Butler approved skill activation webhook. | Required for Agentic Butler live UAT |

## Preferred Workflow Shape

The simplest target workflow shape is to call the versioned static build script instead of keeping the artifact build logic inline.

```diff
diff --git a/.github/workflows/intellectual-twin-pages.yml b/.github/workflows/intellectual-twin-pages.yml
--- a/.github/workflows/intellectual-twin-pages.yml
+++ b/.github/workflows/intellectual-twin-pages.yml
@@
       - name: Prepare static artifact
         env:
           GH_PAGES_API_BASE_URL: ${{ secrets.GH_PAGES_API_BASE_URL }}
           GH_PAGES_N8N_CHAT_WEBHOOK_URL: ${{ secrets.GH_PAGES_N8N_CHAT_WEBHOOK_URL }}
           GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL: ${{ secrets.GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL }}
           GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL: ${{ secrets.GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL }}
           GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL: ${{ secrets.GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL }}
         run: node scripts/build-pages-static.cjs --output dist-pages
```

This command copies `frontend`, writes `runtime-config.js`, regenerates all public runtime/readiness assets against `dist-pages/assets`, and runs `scripts/pages-smoke-check.cjs dist-pages`.

## Runtime Config Shape After Patch

The generated `dist-pages/runtime-config.js` should expose this shape:

```js
window.INTELLECTUAL_TWIN_CONFIG = {
  apiBaseUrl: "",
  assetBaseUrl: "",
  n8nChatWebhookUrl: "PUBLIC_CHAT_OR_ACTOR_TWIN_URL",
  n8nActorTwinWebhookUrl: "PUBLIC_ACTOR_TWIN_URL",
  n8nKnowledgeFabricWebhookUrl: "PUBLIC_KNOWLEDGE_FABRIC_URL",
  n8nAgenticButlerWebhookUrl: "PUBLIC_AGENTIC_BUTLER_URL",
  n8nAgentWebhooks: {
    actor_twin: "PUBLIC_ACTOR_TWIN_URL",
    knowledge_fabric_agent: "PUBLIC_KNOWLEDGE_FABRIC_URL",
    agentic_butler: "PUBLIC_AGENTIC_BUTLER_URL"
  },
  n8nAgentProbeSlots: {
    actor_twin: { status: "configured" },
    knowledge_fabric_agent: { status: "configured" },
    agentic_butler: { status: "configured" }
  },
  n8nChatEnabled: true,
  staticPagesMode: true
};
```

The generated `dist-pages/assets/agent-runtime-config.json` mirrors the agent webhook and probe-slot values. The generated `dist-pages/assets/n8n-runtime-readiness-status.json` summarizes configured versus awaiting URL slots for cockpit badges and production readiness review.

## Validation After Secret Changes

Run locally before pushing:

```powershell
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --check frontend/app.js
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/validate-n8n-fixtures.cjs
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/build-pages-static.cjs --output dist-pages
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/pages-smoke-check.cjs frontend
```

After deployment:

1. Open the GitHub Pages URL with a cache-busting `?v=<commit>` query.
2. Open Production/Review Cockpit.
3. Verify the three agent statuses:
   - Actor Twin: `configured`
   - Knowledge Fabric Agent: `configured` after URL secret is set, otherwise `awaiting_url`
   - Agentic Butler: `configured` after URL secret is set, otherwise `awaiting_url`
4. Run each `Probe live` action and capture the n8n execution trace.
5. Promote to `n8n connected` only after trace evidence exists.

## Rollback

If the generated runtime config is wrong:

1. Revert the workflow commit.
2. Remove or clear the affected GitHub Actions secrets.
3. Keep `frontend/assets/agent-runtime-config.json` as the static fallback.
4. Re-run the Pages workflow.

## Security Boundary

GitHub Pages is public static hosting. Any value embedded into `runtime-config.js` or `frontend/assets/agent-runtime-config.json` is visible to users.

Use Pages only for public UAT URLs. For private production endpoints, move the integration behind a hosted backend that can keep:

- n8n private webhooks
- bearer tokens
- Azure vector DB keys
- Azure Postgres credentials
- internal-only MCP endpoints

The frontend should then call the backend API, not the private n8n URL directly.
