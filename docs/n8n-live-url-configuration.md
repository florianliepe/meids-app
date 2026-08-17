# n8n Live URL Configuration

Date: 2026-08-09

## Purpose

MeIDs can run in GitHub Pages fixture mode without live n8n workflows. The current public frontend model uses the embedded n8n Actor Twin chat as the only required user-facing runtime path. Knowledge Fabric Agent and Agentic Butler are expected to run behind the Actor Twin as n8n workflow tools unless they are intentionally exposed for direct UAT.

## Required Runtime Paths

| Agent | Runtime key | Current status |
|---|---|---|
| Actor Twin | `n8nChatWebhookUrl` / `n8nActorTwinWebhookUrl` / `n8nAgentWebhooks.actor_twin` | required frontend entrypoint |
| Knowledge Fabric Agent | internal Actor Twin n8n workflow tool; optional `n8nAgentWebhooks.knowledge_fabric_agent` for direct UAT | runtime-ready when Actor Twin tool call is configured |
| Agentic Butler | internal Actor Twin n8n workflow tool; optional `n8nAgentWebhooks.agentic_butler` for direct UAT | runtime-ready when Actor Twin tool call is configured |

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
| `GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL` | Optional direct-UAT Knowledge Fabric Agent ingest / graph / vector handoff webhook |
| `GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL` | Optional direct-UAT Agentic Butler autonomous work-artifact and skill proposal webhook |

If the optional worker-agent secrets are empty, the generated runtime config should mark those agents as `internal_tool_via_actor_twin`, not as frontend blockers. The Actor Twin URL should fall back to `GH_PAGES_N8N_CHAT_WEBHOOK_URL` when the explicit Actor Twin secret is empty.

Secrets must be configured in GitHub at:

`Settings -> Secrets and variables -> Actions -> Repository secrets`

Current credential boundary: the public app can already use `frontend/assets/agent-runtime-config.json` for intentionally public UAT URLs. Workflow-secret injection is applied in `.github/workflows/intellectual-twin-pages.yml`. The primary missing live proof is now Actor Twin UAT that demonstrates internal calls to Knowledge Fabric Agent and Agentic Butler through n8n workflow tools.

Runtime URL readiness is also exported to `frontend/assets/n8n-runtime-readiness-status.json`. This generated artifact is public-safe and validates:

- the Actor Twin embedded chat URL slot,
- optional direct worker-agent URL slots,
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
| `n8nAgentWebhooks.knowledge_fabric_agent` | Optional direct-UAT Knowledge Fabric ingest / curation endpoint |
| `n8nAgentWebhooks.agentic_butler` | Optional direct-UAT Agentic Butler skill activation endpoint |
| `n8nAgentProbeSlots.actor_twin` | Public metadata for cockpit probe state and next action |
| `n8nAgentProbeSlots.knowledge_fabric_agent` | Public metadata for the Knowledge Fabric Agent live URL handoff |
| `n8nAgentProbeSlots.agentic_butler` | Public metadata for the Agentic Butler live URL handoff |

| Generated artifact | Purpose |
|---|---|
| `frontend/assets/n8n-runtime-readiness-status.json` | Cockpit-visible validation summary of the embedded Actor Twin path plus optional direct worker URLs. |
| `frontend/assets/n8n-live-handoff-commands.json` | Public-safe operator command bundle for configuring URL slots, recording probe evidence, and running strict readiness gates. |

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

## Internal Worker Agent Runtime

The Actor Twin is configured as the public staging entrypoint. Knowledge Fabric Agent and Agentic Butler should normally be called by the Actor Twin inside n8n through workflow tools. They do not need to be shown as missing frontend URLs when direct public UAT endpoints are not configured.

| Agent | Primary runtime path | Optional direct-UAT key |
|---|---|---|
| Knowledge Fabric Agent | Actor Twin `Call n8n Workflow Tool` / sub-workflow | `GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL` or fallback `n8nAgentWebhooks.knowledge_fabric_agent` |
| Agentic Butler | Actor Twin `Call n8n Workflow Tool` / sub-workflow | `GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL` or fallback `n8nAgentWebhooks.agentic_butler` |

Public-safe workflow blueprints for these worker workflows are prepared:

| Agent | Blueprint | Validator |
|---|---|---|
| Knowledge Fabric Agent | `workflows/n8n/knowledge-fabric-agent.workflow.json` | `node scripts/validate-agent-config-export.cjs` |
| Agentic Butler | `workflows/n8n/agentic-butler.workflow.json` | `node scripts/validate-agent-config-export.cjs` |

These files are implementation blueprints, not live n8n exports. They define the workflow trigger, minimum node responsibilities, approval boundary, trace fields, and direct-UAT return shape. When building the actual n8n workflows, use the blueprint plus the matching fixture in `contracts/n8n/fixtures/`.

The Production/Review Cockpit should only show a direct worker URL setup panel when direct-UAT mode is required. For the embedded Actor Twin path, use this operational handoff:

1. Confirm the embedded Actor Twin chat URL is published and reachable.
2. Confirm Actor Twin has workflow tools for Knowledge Fabric Agent and Agentic Butler.
3. Run Actor Twin UAT prompts that require knowledge lookup and skill execution.
4. Capture n8n execution traces showing the internal tool calls.
5. Only add direct worker URLs when a separate direct-UAT probe is needed.

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
      "probe_boundary": "Public UAT webhook configured; run autonomous no-write work-artifact probe and capture n8n execution trace.",
      "next_action": "Run Agentic Butler UAT with autonomous no-write work-artifact fixture."
    }
  },
  "n8nKnowledgeFabricWebhookUrl": "PASTE_PUBLIC_UAT_WEBHOOK_URL_HERE",
  "n8nAgenticButlerWebhookUrl": "PASTE_PUBLIC_UAT_WEBHOOK_URL_HERE"
}
```

After adding a URL, the cockpit status should move from `missing URL` to `configured`. It only becomes `n8n connected` after the live probe reaches the workflow and records a trace.

## Live Probe Evidence Artifact

Final readiness requires proof that the workflows were reached, not only that URLs were pasted. The public-safe evidence location is:

`frontend/assets/n8n-live-probe-evidence.json`

Expected agent entry after a successful UAT probe:

```json
{
  "agent_id": "knowledge_fabric_agent",
  "agent_name": "Knowledge Fabric Agent",
  "status": "connected",
  "checked_at": "2026-08-10T20:00:00.000Z",
  "trace_id": "trace_from_n8n_execution",
  "demo": false,
  "url_source": "runtime-asset or browser-local",
  "evidence": {
    "n8n_execution_url": "https://YOUR-N8N-HOST/workflow/.../executions/...",
    "response_status": "completed"
  }
}
```

Strict gates:

```powershell
node scripts\write-n8n-live-readiness-preflight.cjs --write
node scripts\write-n8n-live-handoff-commands.cjs --write
node scripts\write-n8n-live-readiness-preflight.cjs --check
node scripts\write-n8n-live-handoff-commands.cjs --check
node scripts\validate-zielmodus-4-readiness.cjs --require-live
node scripts\validate-zielmodus-4-readiness.cjs --require-live-probes
```

- `write-n8n-live-readiness-preflight.cjs --write` writes `frontend/assets/n8n-live-readiness-preflight.json` with fixture, URL, probe, blocker, and copyable command status per top-level agent.
- `write-n8n-live-readiness-preflight.cjs --check` fails when the checked-in preflight artifact is stale.
- `write-n8n-live-handoff-commands.cjs --write` writes `frontend/assets/n8n-live-handoff-commands.json`, the public-safe operator handoff for live URL and trace evidence completion.
- `--require-live` fails until all top-level agent URL slots are configured.
- `--require-live-probes` fails until all URLs are configured and `frontend/assets/n8n-live-probe-evidence.json` contains connected, non-demo trace evidence for Actor Twin, Knowledge Fabric Agent, and Agentic Butler.

Record live probe evidence after a real n8n UAT execution:

```powershell
node scripts\record-n8n-live-probe-evidence.cjs `
  --agent knowledge_fabric_agent `
  --trace-id "TRACE_ID_FROM_N8N" `
  --execution-url "https://YOUR-N8N-HOST/workflow/.../executions/..." `
  --response-status completed `
  --url-source github-pages-secret
```

For Agentic Butler approval-gate UAT, use:

```powershell
node scripts\record-n8n-live-probe-evidence.cjs `
  --agent agentic_butler `
  --trace-id "TRACE_ID_FROM_N8N" `
  --execution-url "https://YOUR-N8N-HOST/workflow/.../executions/..." `
  --response-status completed `
  --url-source github-pages-secret
```

The recorder rejects empty trace ids, obvious demo/fixture placeholders, non-HTTPS execution URLs, and URL strings that look like they contain secrets. It only stores public-safe proof that a workflow was reached.

## Local Public UAT URL Helper

For local UAT, use the checked-in helper to update the public staging runtime config and regenerate readiness artifacts in one step:

```powershell
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\set-n8n-agent-url.cjs `
  --agent knowledge_fabric_agent `
  --url "https://YOUR-N8N-HOST/webhook/YOUR-KNOWLEDGE-FABRIC-UAT-PATH"

& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\set-n8n-agent-url.cjs `
  --agent agentic_butler `
  --url "https://YOUR-N8N-HOST/webhook/YOUR-AGENTIC-BUTLER-UAT-PATH"
```

The helper:

- accepts only `actor_twin`, `knowledge_fabric_agent`, or `agentic_butler`;
- rejects non-HTTPS URLs and URLs without `/webhook/`;
- rejects obvious token/API-key patterns;
- writes `frontend/assets/agent-runtime-config.json`;
- regenerates `frontend/assets/n8n-runtime-readiness-status.json`;
- regenerates `frontend/assets/zielmodus-4-readiness-status.json`.

Use this helper only for intentionally public UAT endpoints. For production, prefer GitHub Pages repository secrets or hosted backend secret injection.

## Browser-Local Chat UAT Override

The Chat workspace also exposes a browser-local setup path for the two missing live agents:

1. Open Chat.
2. In the **Live URL setup needed** card, paste the public UAT URL for:
   - Knowledge Fabric Agent
   - Agentic Butler
3. Select **Use locally**.
4. Run **Probe live** from the selected Chat mode or from the Production/Review Cockpit.

This writes only to browser `localStorage` under `intellectualTwin.agentWebhookOverrides`. It does not modify repository files, GitHub Pages secrets, or public runtime assets.

Validation rules:

- the URL must use `https`;
- the path must include `/webhook/`;
- invalid values are rejected before they can be used for a live probe.

Use this path for quick UAT when a workflow URL should be tested before committing it or adding it as a GitHub Pages secret. After UAT approval, promote the URL through one of the durable paths:

- GitHub Pages repository secret; or
- `scripts/set-n8n-agent-url.cjs` for intentionally public staging assets; or
- hosted backend secret injection for private production endpoints.

Repeatable QA:

```powershell
$env:NODE_PATH="C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\browser-chat-local-url-setup-qa.cjs frontend docs\visual-qa\chat-local-url-setup
```

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
