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

The preferred production path is to let the Pages workflow generate the public runtime assets during deployment from repository secrets:

- `runtime-config.js`
- `assets/agent-runtime-config.json`
- `assets/n8n-runtime-readiness-status.json`

This keeps Chat mode routing, cockpit status badges, and the public readiness summary aligned after repository secrets change.

| Secret | Purpose |
|---|---|
| `GH_PAGES_N8N_CHAT_WEBHOOK_URL` | Embedded n8n chat / Actor Twin chat widget URL |
| `GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL` | Optional explicit Actor Twin contract webhook; falls back to chat webhook |
| `GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL` | Knowledge Fabric Agent ingest / graph / vector handoff webhook |
| `GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL` | Agentic Butler approved skill activation webhook |

If a secret is empty, the generated runtime config should keep that agent in `awaiting_url` state. The Actor Twin URL should fall back to `GH_PAGES_N8N_CHAT_WEBHOOK_URL` when the explicit Actor Twin secret is empty.

Secrets must be configured in GitHub at:

`Settings -> Secrets and variables -> Actions -> Repository secrets`

Current credential boundary: the public app can already use `frontend/assets/agent-runtime-config.json` for intentionally public UAT URLs. Workflow-secret injection is applied in `.github/workflows/intellectual-twin-pages.yml`. The missing live work remains to provide values for Knowledge Fabric Agent and Agentic Butler when those n8n workflows are ready.

Runtime URL readiness is also exported to `frontend/assets/n8n-runtime-readiness-status.json`. This generated artifact is public-safe and validates:

- each top-level agent URL slot,
- expected HTTPS `/webhook/` URL shape,
- probe-slot metadata,
- absence of obvious secret-like values.

Regenerate it after editing `frontend/assets/agent-runtime-config.json`:

```powershell
node scripts\write-n8n-runtime-readiness-status.cjs
```

Check without rewriting:

```powershell
node scripts\write-n8n-runtime-readiness-status.cjs --check
```

Current workflow: [`.github/workflows/intellectual-twin-pages.yml`](../.github/workflows/intellectual-twin-pages.yml).

Workflow patch record: [`docs/production/github-pages-agent-runtime-workflow-patch.md`](production/github-pages-agent-runtime-workflow-patch.md).

After changing a secret later, trigger the Pages workflow again through a push to `main` or `Actions -> Deploy MeIDs frontend to GitHub Pages -> Run workflow`.

## Current Public Staging Asset Path

GitHub Pages also loads `frontend/assets/agent-runtime-config.json` in static mode for local/static fallback testing. During hosted Pages deployment, the workflow replaces this asset in `dist-pages/assets/agent-runtime-config.json` with the secret-derived public runtime values and regenerates `dist-pages/assets/n8n-runtime-readiness-status.json` from the same config.

Use this only for intentionally public UAT endpoints:

| Asset key | Purpose |
|---|---|
| `n8nAgentWebhooks.actor_twin` | Actor Twin chat / intent contract endpoint |
| `n8nAgentWebhooks.knowledge_fabric_agent` | Knowledge Fabric ingest / curation endpoint |
| `n8nAgentWebhooks.agentic_butler` | Agentic Butler skill activation endpoint |
| `n8nAgentProbeSlots.actor_twin` | Public metadata for cockpit probe state and next action |
| `n8nAgentProbeSlots.knowledge_fabric_agent` | Public metadata for the Knowledge Fabric Agent live URL handoff |
| `n8nAgentProbeSlots.agentic_butler` | Public metadata for the Agentic Butler live URL handoff |

| Generated artifact | Purpose |
|---|---|
| `frontend/assets/n8n-runtime-readiness-status.json` | Cockpit-visible validation summary of configured versus awaiting live agent URLs. |

Do not put private credentials, API keys, bearer tokens, or internal-only URLs in this file. Private production URLs should move to the hosted backend or workflow-generated runtime config.

## Probe Slot Semantics

`frontend/assets/agent-runtime-config.json` carries two kinds of data:

1. `n8nAgentWebhooks`: the actual public UAT webhook URLs.
2. `n8nAgentProbeSlots`: public, non-secret metadata explaining whether a live URL is configured, what the probe boundary is, and what the next setup action should be.

The cockpit uses this distinction to avoid treating planned, fixture-only agents as broken. Current status language:

| Probe status | Meaning | Cockpit interpretation |
|---|---|---|
| `configured` | A public UAT webhook URL exists or is expected through the runtime config. | Contract is ready for UAT/probe evidence. |
| `awaiting_url` | Fixture and contract exist, but no live workflow URL has been provided. | Setup slot is ready; workflow URL is the next blocker. |
| `missing URL` | No URL and no explicit probe-slot status. | Configuration is incomplete or stale. |
| `n8n connected` | A probe or live interaction reached the workflow and produced trace evidence. | Candidate for production readiness, still subject to approval gates. |

## Current Missing Live Endpoints

The Actor Twin is configured for public staging. The following live endpoints are still missing and remain fixture-only until real n8n webhook URLs are available:

| Agent | Required public UAT key | UI setup action |
|---|---|---|
| Knowledge Fabric Agent | `GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL` or fallback `n8nAgentWebhooks.knowledge_fabric_agent` | Review Cockpit -> Knowledge-to-Graph Handoff -> Copy setup packet |
| Agentic Butler | `GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL` or fallback `n8nAgentWebhooks.agentic_butler` | Review Cockpit -> Knowledge-to-Graph Handoff -> Copy setup packet |

The Production/Review Cockpit also shows a **Missing live URL setup** panel when either URL is absent. Use it as the operational handoff:

1. Copy the setup packet for the missing agent.
2. Create or publish the matching n8n workflow as a public UAT webhook, or expose it through the hosted backend.
3. Add the URL to the matching GitHub Pages secret or to `frontend/assets/agent-runtime-config.json` for public UAT.
4. Rerun the Pages workflow or regenerate `frontend/assets/n8n-runtime-readiness-status.json`.
5. Run the cockpit live probe and retain the n8n execution trace before production approval.

Minimal public staging JSON shape:

```json
{
  "n8nAgentWebhooks": {
    "knowledge_fabric_agent": "PASTE_PUBLIC_UAT_WEBHOOK_URL_HERE",
    "agentic_butler": "PASTE_PUBLIC_UAT_WEBHOOK_URL_HERE"
  },
  "n8nAgentProbeSlots": {
    "knowledge_fabric_agent": {
      "status": "configured",
      "probe_boundary": "Public UAT webhook configured; run Knowledge Fabric ingest probe and capture n8n execution trace.",
      "next_action": "Run Knowledge Fabric Agent UAT with upload/transcript fixture."
    },
    "agentic_butler": {
      "status": "configured",
      "probe_boundary": "Public UAT webhook configured; run approval-gated skill activation probe and capture n8n execution trace.",
      "next_action": "Run Agentic Butler UAT with approved skill activation fixture."
    }
  },
  "n8nKnowledgeFabricWebhookUrl": "PASTE_PUBLIC_UAT_WEBHOOK_URL_HERE",
  "n8nAgenticButlerWebhookUrl": "PASTE_PUBLIC_UAT_WEBHOOK_URL_HERE"
}
```

After adding a URL, the cockpit status should move from `missing URL` to `configured`. It only becomes `n8n connected` after the live probe reaches the workflow and records a trace.

## Chat-Level Contract Actions

The Chat interaction setup now exposes the active agent contract directly beside the mode selector:

- `Show answer payload` for Actor Twin.
- `Show ingest payload` for Knowledge Fabric Agent.
- `Show skill payload` for Agentic Butler.
- `Probe live` for the selected mode.
- `Copy key` / `Copy JSON` when the selected mode is missing a live URL.

This keeps the primary workspace aligned with the Production/Review Cockpit: users can see whether the selected interaction is using a live n8n URL, a fixture fallback, or a missing URL slot before submitting work.

## Current Static Fallback

When a URL is missing, the frontend must stay usable:

- Chat uses fixture fallback for agent contract responses.
- Production/Review Cockpit shows `awaiting URL` when a probe slot exists and `missing URL` only when the configuration shape is incomplete.
- Production/Review Cockpit shows runtime setup actions with the exact missing
  config keys and a copyable public UAT config snippet.
- The copied public UAT JSON includes both `n8nAgentWebhooks` and
  `n8nAgentProbeSlots`, so the cockpit can distinguish "URL configured" from
  "live probe reached the workflow".
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
