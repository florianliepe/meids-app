# n8n Live URL Configuration

Date: 2026-08-09

## Purpose

MeIDs can run in GitHub Pages fixture mode without live n8n workflows. For production-style UAT, each top-level agent needs a live n8n webhook URL in `frontend/runtime-config.js` or the hosted runtime config equivalent.

## Required Agent URLs

| Agent | Runtime key | Current status |
|---|---|---|
| Actor Twin | `n8nActorTwinWebhookUrl` / `n8nAgentWebhooks.actor_twin` | configured for public staging |
| Knowledge Fabric Agent | `n8nKnowledgeFabricWebhookUrl` / `n8nAgentWebhooks.knowledge_fabric_agent` | missing URL |
| Agentic Butler | `n8nAgenticButlerWebhookUrl` / `n8nAgentWebhooks.agentic_butler` | missing URL |

## GitHub Pages Secrets

The Pages workflow generates `runtime-config.js` during deployment. The current pushed workflow injects the chat webhook. The three top-level agent secrets below are the target production keys for the next workflow-scope update:

| Secret | Purpose |
|---|---|
| `GH_PAGES_N8N_CHAT_WEBHOOK_URL` | Embedded n8n chat / Actor Twin chat widget URL |
| `GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL` | Optional explicit Actor Twin contract webhook; falls back to chat webhook |
| `GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL` | Knowledge Fabric Agent ingest / graph / vector handoff webhook |
| `GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL` | Agentic Butler approved skill activation webhook |

Current access note: GitHub rejected workflow edits from the available OAuth credential because it lacks `workflow` scope. Until a workflow-scope credential is available, use the public staging asset below for intentionally public UAT webhook URLs.

## Public Staging Asset

GitHub Pages also loads `frontend/assets/agent-runtime-config.json` in static mode. The workflow copies this asset unchanged, so it can expose non-secret staging webhook URLs without editing `.github/workflows/intellectual-twin-pages.yml`.

Use this only for intentionally public UAT endpoints:

| Asset key | Purpose |
|---|---|
| `n8nAgentWebhooks.actor_twin` | Actor Twin chat / intent contract endpoint |
| `n8nAgentWebhooks.knowledge_fabric_agent` | Knowledge Fabric ingest / curation endpoint |
| `n8nAgentWebhooks.agentic_butler` | Agentic Butler skill activation endpoint |

Do not put private credentials, API keys, bearer tokens, or internal-only URLs in this file. Private production URLs should move to the hosted backend or workflow-generated runtime config.

## Current Missing Live Endpoints

The Actor Twin is configured for public staging. The following live endpoints are still missing and remain fixture-only until real n8n webhook URLs are available:

| Agent | Required public UAT key | UI setup action |
|---|---|---|
| Knowledge Fabric Agent | `GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL` or `n8nAgentWebhooks.knowledge_fabric_agent` | Production/Review Cockpit -> Runtime setup actions -> Copy JSON |
| Agentic Butler | `GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL` or `n8nAgentWebhooks.agentic_butler` | Production/Review Cockpit -> Runtime setup actions -> Copy JSON |

Minimal public staging JSON shape:

```json
{
  "n8nAgentWebhooks": {
    "knowledge_fabric_agent": "PASTE_PUBLIC_UAT_WEBHOOK_URL_HERE",
    "agentic_butler": "PASTE_PUBLIC_UAT_WEBHOOK_URL_HERE"
  },
  "n8nKnowledgeFabricWebhookUrl": "PASTE_PUBLIC_UAT_WEBHOOK_URL_HERE",
  "n8nAgenticButlerWebhookUrl": "PASTE_PUBLIC_UAT_WEBHOOK_URL_HERE"
}
```

After adding a URL, the cockpit status should move from `missing URL` to `configured`. It only becomes `n8n connected` after the live probe reaches the workflow and records a trace.

## Current Static Fallback

When a URL is missing, the frontend must stay usable:

- Chat uses fixture fallback for agent contract responses.
- Production/Review Cockpit shows `missing URL`.
- Production/Review Cockpit shows runtime setup actions with the exact missing
  config keys and a copyable public UAT config snippet.
- Production/Review Cockpit shows a fixture-to-live comparison matrix so UAT can
  distinguish contract fixture coverage from live webhook connectivity.
- Contract fixtures remain available and testable.
- No secrets are required for GitHub Pages.

## Production Rule

Do not mark an agent as production-ready only because its contract fixture passes. Production readiness requires:

1. Contract fixture validation.
2. Live n8n workflow URL configured.
3. UAT probe against the live workflow.
4. Human approval for any workflow that can trigger external action.
