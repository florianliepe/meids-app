# Agent Live Probe Evidence - 2026-08-11

## Scope

No-write live probes were sent to the public n8n webhooks for:

- Actor Twin
- Knowledge Fabric Agent
- Agentic Butler

## Result

| Agent | Live webhook reached | AI Agent node executed | Contract status | Remaining gap |
|---|---:|---:|---|---|
| Actor Twin | yes | yes | `completed` | Live response embeds route-decision JSON in `output.answer`; import patched `Contract response normalizer` so `output.route_decision` is explicit. |
| Knowledge Fabric Agent | yes | yes | `completed` | Live response still uses older trace shape; import patched `Contract response normalizer` for enriched trace and `contract_stage` fields. |
| Agentic Butler | yes | yes | `approval_required` | Live response lacks top-level `approval` object and resume-aware adapter; import patched `Contract response normalizer`. |

## Evidence IDs

- Actor Twin trace: `n8n_exec_16318`
- Knowledge Fabric trace: `n8n_exec_16319`
- Agentic Butler trace: `n8n_exec_16317`

## Browser/API Apply Attempt

The signed-in n8n browser session was visible and the API settings page loaded. Creating a new API key from the UI previously returned `Unauthorized`. After sign-in, browser automation could list the n8n tabs but timed out when claiming the n8n API/settings tabs for UI mutation. No workflow update was applied from automation.

## Interpretation

The n8n workflows are reachable and no longer pure static stubs. They contain AI Agent execution on the active path. The remaining enablement work is to apply the updated workflow JSON from `workflows/n8n/*.workflow.json` to the live n8n workflows so their response normalizers emit the production contract shape expected by the frontend and backend proxy.

Do not treat the workflows as production-contract-complete until the live responses include:

- Actor Twin: explicit `output.route_decision`.
- Knowledge Fabric Agent: enriched trace fields and `output.contract_stage`.
- Agentic Butler: top-level `approval` plus resume-aware response shape.
