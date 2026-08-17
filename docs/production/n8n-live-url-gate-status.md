# n8n Live URL Gate Status

Last verified: 2026-08-11

## Current Status

The public GitHub Pages runtime uses the embedded n8n Actor Twin chat as the user-facing entrypoint. Knowledge Fabric Agent and Agentic Butler are expected to be called inside the Actor Twin workflow as n8n workflow tools or sub-workflows.

| Agent | Runtime key | Status | Next action |
| --- | --- | --- | --- |
| Actor Twin | `n8nChatWebhookUrl` / `n8nAgentWebhooks.actor_twin` | Embedded chat configured | Run live embedded-chat UAT and capture execution trace evidence. |
| Knowledge Fabric Agent | Internal Actor Twin workflow tool | Internal-tool route expected | Capture Actor Twin execution evidence showing a Knowledge Fabric tool call. |
| Agentic Butler | Internal Actor Twin workflow tool | Internal-tool route expected | Capture Actor Twin execution evidence showing a Butler tool call. |

Current strict gate state:

| Gate | Status | Evidence |
| --- | --- | --- |
| Public-safe Zielmodus 4 readiness | Passing | `node scripts\check-zielmodus-4-public-safe.cjs` |
| GitHub Pages deploy | Passing | Workflow `31447260313` |
| Deployed smoke check | Passing | `node scripts\pages-smoke-check.cjs https://florianliepe.github.io/meids-app/` |
| Live URL gate | Not blocking Pages UAT | Embedded Actor Twin chat URL is the required public entrypoint; worker direct URLs are optional diagnostics |
| Live probe gate | Blocked | Actor Twin direct answer, Knowledge Fabric route, Butler work-artifact route, and skill/agent proposal trace evidence are absent |

Estimated remaining integration time after the Actor Twin workflow tools are published: **45-90 minutes**.

## Boundary

- GitHub Pages should call only the embedded public Actor Twin chat safely.
- Private production n8n endpoints should be called through a hosted backend proxy, not embedded directly in public frontend assets.
- No secrets belong in `frontend/assets/agent-runtime-config.json`.
- Fixture replay and contract validation prove contract readiness only; they do not prove live n8n connectivity.
- The Production Cockpit also supports browser-local public UAT URL overrides. These are stored in local browser storage only and do not change the committed runtime asset.
- Chat contract badges, Production URL cards, and exported probe evidence now label URL source explicitly as `runtime asset`, `browser-local UAT override`, or `missing URL`.
- The Production Cockpit shows a side-by-side URL source comparison so operators can distinguish committed runtime readiness from temporary browser-local UAT readiness.

## Validation Commands

Run from the app repo root:

```powershell
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\write-n8n-runtime-readiness-status.cjs --write
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\validate-n8n-fixtures.cjs
```

Expected current runtime readiness for the embedded-chat architecture:

```text
n8n runtime readiness: Actor Twin embedded chat configured; worker agents internal-tool ready or diagnostic URLs optional
```

Strict final gate after all URLs and live probe traces exist:

```powershell
node scripts\validate-zielmodus-4-readiness.cjs --require-live-probes
```

## Browser-Local UAT Override

Use the `Browser-local UAT URL` field in the Production Cockpit only when a temporary direct diagnostic webhook exists and should not be committed to the public runtime asset.

Rules:

- Use only public UAT webhook URLs.
- Do not paste private production endpoints or credentials.
- The override affects only the current browser session/profile.
- Clear the override to fall back to `frontend/assets/agent-runtime-config.json`.
- Live production approval still requires a non-demo n8n trace and human review.
- Use the `URL source` field in the Production Cockpit to confirm whether a configured agent URL came from the committed runtime asset or from the current browser's local UAT override.
- Use the `Agent URL readiness` source comparison to separate deploy-wide committed URL slots from local test-only URL overrides during UAT.

## Files

- Runtime config: `frontend/assets/agent-runtime-config.json`
- Generated readiness artifact: `frontend/assets/n8n-runtime-readiness-status.json`
- Live URL setup guide: `docs/n8n-live-url-configuration.md`
- Live readiness operator checklist: `docs/production/n8n-live-readiness-operator-checklist.md`
- Live probe runbook: `docs/production/n8n-live-probe-runbook.md`
- Agent architecture and contract overview: `docs/agent-architecture-and-n8n-contracts.md`
