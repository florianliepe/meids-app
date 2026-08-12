# Agent Live Probe Evidence - 2026-08-11

## Scope

No-write live probes were sent to the public n8n webhooks for:

- Actor Twin
- Knowledge Fabric Agent
- Agentic Butler

## Result

| Agent | Live webhook reached | AI Agent node executed | Contract status | Remaining gap |
|---|---:|---:|---|---|
| Actor Twin | yes | yes | `completed` | resolved: live response now exposes explicit `output.route_decision`. |
| Knowledge Fabric Agent | yes | yes | `completed` | resolved: live response now exposes `output.contract_stage`. |
| Agentic Butler | yes | yes | `approval_required` | resolved: live response now exposes top-level `approval`. |

## Evidence IDs

- Pre-import Actor Twin trace: `n8n_exec_16318`
- Pre-import Knowledge Fabric trace: `n8n_exec_16319`
- Pre-import Agentic Butler trace: `n8n_exec_16317`
- Post-import Actor Twin trace: `n8n_exec_16322`
- Post-import Knowledge Fabric trace: `n8n_exec_16323`
- Post-import Agentic Butler trace: `n8n_exec_16324`

## Browser/API Apply Attempt

The signed-in n8n browser session was visible and the API settings page loaded. After workflow/API permissions were granted, a short-lived API key was created in n8n and held in memory only for the apply run. The live workflow update was performed through the n8n public API. Existing live webhook IDs and OpenAI credential references were preserved.

Local live backups and merged update payloads were written under:

- `exports/n8n-live-backups/20260812-api-apply/actor-twin.live-before.json`
- `exports/n8n-live-backups/20260812-api-apply/knowledge-fabric-agent.live-before.json`
- `exports/n8n-live-backups/20260812-api-apply/agentic-butler.live-before.json`

## Interpretation

The n8n workflows are reachable and no longer pure static stubs. They contain AI Agent execution on the active path, and their response normalizers now emit the production contract shape expected by the frontend and backend proxy.

Validated live response requirements:

- Actor Twin: explicit `output.route_decision`.
- Knowledge Fabric Agent: `output.contract_stage`.
- Agentic Butler: top-level `approval`.

Machine-readable post-import evidence:

- `docs/production/agent-live-probe-evidence-20260812.json`
