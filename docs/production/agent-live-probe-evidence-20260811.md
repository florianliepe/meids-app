# Agent Live Probe Evidence - 2026-08-11

## Scope

No-write live probes were sent to the public n8n webhooks for:

- Knowledge Fabric Agent
- Agentic Butler

## Result

| Agent | Live webhook reached | AI Agent node executed | Contract status | Remaining gap |
|---|---:|---:|---|---|
| Knowledge Fabric Agent | yes | yes | `completed` | Live response still uses older trace shape; import patched `Contract response normalizer` for enriched trace fields. |
| Agentic Butler | yes | yes | `approval_required` | Live response lacks top-level `approval` object and resume-aware adapter; import patched `Contract response normalizer`. |

## Evidence IDs

- Knowledge Fabric trace: `n8n_exec_16311`
- Agentic Butler trace: `n8n_exec_16312`

## Interpretation

The n8n workflows are reachable and no longer pure static stubs. They contain AI Agent execution on the active path. The remaining enablement work is to apply the updated workflow JSON from `workflows/n8n/*.workflow.json` to the live n8n workflows so their response normalizers emit the production contract shape expected by the frontend and backend proxy.
