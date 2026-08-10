# GitHub Pages Agent Runtime Workflow Patch

Date: 2026-08-10
Status: prepared, not applied
Owner: MeIDs production setup

## Purpose

This document defines the exact GitHub Pages workflow update required to inject all three MeIDs top-level n8n agent URLs into `runtime-config.js` during deployment.

It is intentionally stored as documentation only. The current available GitHub credential can push code and documentation, but GitHub rejects edits to `.github/workflows/intellectual-twin-pages.yml` unless the credential has `workflow` scope.

## Current Safe Path

Until workflow-scope access is available, configure intentionally public UAT webhook URLs through:

```text
frontend/assets/agent-runtime-config.json
```

That asset is copied unchanged into the GitHub Pages build and is already used by the Production/Review Cockpit to distinguish:

- `configured`
- `awaiting_url`
- `missing URL`
- `n8n connected`

Do not place secrets, bearer tokens, private n8n URLs, Azure keys, or internal endpoints in this public asset.

## Preconditions

Before applying the workflow patch:

1. Use a GitHub credential with `workflow` scope, or a GitHub App installation with workflow write permission.
2. Confirm all webhook URLs are safe to expose to GitHub Pages users, or proxy private endpoints through a hosted backend.
3. Configure the required secrets in `Settings -> Secrets and variables -> Actions -> Repository secrets`.
4. Keep `frontend/assets/agent-runtime-config.json` as fallback for public UAT setup and local static testing.

## Required Secrets

| Secret | Purpose | Required |
|---|---|---|
| `GH_PAGES_API_BASE_URL` | Hosted backend URL when Pages should call a backend API instead of static fixture mode. | Optional |
| `GH_PAGES_N8N_CHAT_WEBHOOK_URL` | Existing chat / Actor Twin fallback webhook. | Optional but recommended |
| `GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL` | Explicit Actor Twin contract webhook. Falls back to chat webhook when empty. | Optional |
| `GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL` | Knowledge Fabric Agent ingest / graph / vector handoff webhook. | Required for Knowledge Fabric live UAT |
| `GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL` | Agentic Butler approved skill activation webhook. | Required for Agentic Butler live UAT |

## Intended Workflow Patch

Apply this patch only after workflow-scope access is available.

```diff
diff --git a/.github/workflows/intellectual-twin-pages.yml b/.github/workflows/intellectual-twin-pages.yml
--- a/.github/workflows/intellectual-twin-pages.yml
+++ b/.github/workflows/intellectual-twin-pages.yml
@@
       - name: Prepare static artifact
         env:
           GH_PAGES_API_BASE_URL: ${{ secrets.GH_PAGES_API_BASE_URL }}
           GH_PAGES_N8N_CHAT_WEBHOOK_URL: ${{ secrets.GH_PAGES_N8N_CHAT_WEBHOOK_URL }}
+          GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL: ${{ secrets.GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL }}
+          GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL: ${{ secrets.GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL }}
+          GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL: ${{ secrets.GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL }}
         run: |
           rm -rf dist-pages
           mkdir -p dist-pages
           cp -R frontend/. dist-pages/
+          ACTOR_TWIN_WEBHOOK_URL="${GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL:-$GH_PAGES_N8N_CHAT_WEBHOOK_URL}"
+          actor_status="awaiting_url"
+          knowledge_status="awaiting_url"
+          butler_status="awaiting_url"
+          if [ -n "$ACTOR_TWIN_WEBHOOK_URL" ]; then actor_status="configured"; fi
+          if [ -n "$GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL" ]; then knowledge_status="configured"; fi
+          if [ -n "$GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL" ]; then butler_status="configured"; fi
           cat > dist-pages/runtime-config.js <<EOF
           window.INTELLECTUAL_TWIN_CONFIG = {
             apiBaseUrl: "$GH_PAGES_API_BASE_URL",
             assetBaseUrl: "",
             n8nChatWebhookUrl: "$GH_PAGES_N8N_CHAT_WEBHOOK_URL",
-            n8nChatEnabled: "$GH_PAGES_N8N_CHAT_WEBHOOK_URL" !== "",
+            n8nActorTwinWebhookUrl: "$ACTOR_TWIN_WEBHOOK_URL",
+            n8nKnowledgeFabricWebhookUrl: "$GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL",
+            n8nAgenticButlerWebhookUrl: "$GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL",
+            n8nAgentWebhooks: {
+              actor_twin: "$ACTOR_TWIN_WEBHOOK_URL",
+              knowledge_fabric_agent: "$GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL",
+              agentic_butler: "$GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL",
+            },
+            n8nAgentProbeSlots: {
+              actor_twin: {
+                status: "$actor_status",
+                probe_boundary: "GitHub Pages runtime config generated from repository secrets.",
+                next_action: "Run Actor Twin UAT and capture n8n trace evidence.",
+              },
+              knowledge_fabric_agent: {
+                status: "$knowledge_status",
+                probe_boundary: "GitHub Pages runtime config generated from repository secrets.",
+                next_action: "Run Knowledge Fabric Agent UAT with upload/transcript fixture.",
+              },
+              agentic_butler: {
+                status: "$butler_status",
+                probe_boundary: "GitHub Pages runtime config generated from repository secrets.",
+                next_action: "Run Agentic Butler UAT with approval-gated skill activation fixture.",
+              },
+            },
+            n8nChatEnabled: "$GH_PAGES_N8N_CHAT_WEBHOOK_URL" !== "" || "$ACTOR_TWIN_WEBHOOK_URL" !== "",
             staticPagesMode: "$GH_PAGES_API_BASE_URL" === ""
           };
           EOF
```

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

## Validation After Applying

Run locally before pushing:

```powershell
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --check frontend/app.js
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/validate-n8n-fixtures.cjs
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/pages-smoke-check.cjs frontend
```

After deployment:

1. Open the GitHub Pages URL.
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
