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

The Pages workflow generates `runtime-config.js` during deployment. Configure these repository secrets when live workflow URLs are available:

| Secret | Purpose |
|---|---|
| `GH_PAGES_N8N_CHAT_WEBHOOK_URL` | Embedded n8n chat / Actor Twin chat widget URL |
| `GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL` | Optional explicit Actor Twin contract webhook; falls back to chat webhook |
| `GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL` | Knowledge Fabric Agent ingest / graph / vector handoff webhook |
| `GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL` | Agentic Butler approved skill activation webhook |

## Current Static Fallback

When a URL is missing, the frontend must stay usable:

- Chat uses fixture fallback for agent contract responses.
- Production/Review Cockpit shows `missing URL`.
- Contract fixtures remain available and testable.
- No secrets are required for GitHub Pages.

## Production Rule

Do not mark an agent as production-ready only because its contract fixture passes. Production readiness requires:

1. Contract fixture validation.
2. Live n8n workflow URL configured.
3. UAT probe against the live workflow.
4. Human approval for any workflow that can trigger external action.
