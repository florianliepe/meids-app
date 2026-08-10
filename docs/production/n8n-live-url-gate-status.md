# n8n Live URL Gate Status

Last verified: 2026-08-10

## Current Status

The public GitHub Pages runtime has one of three top-level n8n agent URLs configured.

| Agent | Runtime key | Status | Next action |
| --- | --- | --- | --- |
| Actor Twin | `n8nAgentWebhooks.actor_twin` | Configured for public UAT | Run live UAT and capture execution trace evidence. |
| Knowledge Fabric Agent | `n8nAgentWebhooks.knowledge_fabric_agent` | Awaiting URL | Create/expose the Knowledge Fabric Agent webhook, then add the public UAT or hosted backend URL to `frontend/assets/agent-runtime-config.json`. |
| Agentic Butler | `n8nAgentWebhooks.agentic_butler` | Awaiting URL | Create/expose the Agentic Butler webhook with approval-gated skill activation, then add the public UAT or hosted backend URL to `frontend/assets/agent-runtime-config.json`. |

## Boundary

- GitHub Pages can only call public UAT webhooks safely.
- Private production n8n endpoints should be called through a hosted backend proxy, not embedded directly in public frontend assets.
- No secrets belong in `frontend/assets/agent-runtime-config.json`.
- Fixture replay and contract validation prove contract readiness only; they do not prove live n8n connectivity.

## Validation Commands

Run from the app repo root:

```powershell
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\write-n8n-runtime-readiness-status.cjs --write
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\validate-n8n-fixtures.cjs
```

Expected current runtime readiness until the two remaining URLs are configured:

```text
n8n runtime readiness: 1/3 URLs configured
```

## Files

- Runtime config: `frontend/assets/agent-runtime-config.json`
- Generated readiness artifact: `frontend/assets/n8n-runtime-readiness-status.json`
- Live URL setup guide: `docs/n8n-live-url-configuration.md`
- Agent architecture and contract overview: `docs/agent-architecture-and-n8n-contracts.md`
