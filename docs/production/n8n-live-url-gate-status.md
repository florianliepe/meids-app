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
- The Production Cockpit also supports browser-local public UAT URL overrides. These are stored in local browser storage only and do not change the committed runtime asset.
- Chat contract badges, Production URL cards, and exported probe evidence now label URL source explicitly as `runtime asset`, `browser-local UAT override`, or `missing URL`.

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

## Browser-Local UAT Override

Use the `Browser-local UAT URL` field in the Production Cockpit missing URL cards when a temporary public n8n webhook exists but should not be committed to the public runtime asset yet.

Rules:

- Use only public UAT webhook URLs.
- Do not paste private production endpoints or credentials.
- The override affects only the current browser session/profile.
- Clear the override to fall back to `frontend/assets/agent-runtime-config.json`.
- Live production approval still requires a non-demo n8n trace and human review.
- Use the `URL source` field in the Production Cockpit to confirm whether a configured agent URL came from the committed runtime asset or from the current browser's local UAT override.

## Files

- Runtime config: `frontend/assets/agent-runtime-config.json`
- Generated readiness artifact: `frontend/assets/n8n-runtime-readiness-status.json`
- Live URL setup guide: `docs/n8n-live-url-configuration.md`
- Agent architecture and contract overview: `docs/agent-architecture-and-n8n-contracts.md`
