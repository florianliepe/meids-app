# n8n Contract Fixtures

These public-safe fixtures define the initial runtime boundary for the three top-level MeIDs agents:

- `Actor Twin`: user-facing decision and answer agent.
- `Knowledge Fabric Agent`: OKF markdown/YAML, graph candidate, and retrieval refresh boundary.
- `Agentic Butler`: work execution agent; the skill orchestrator is an internal component.

Each fixture includes:

- `request`: normal inbound request envelope.
- `response`: successful output envelope.
- `approval_required`: human-gated action envelope.
- `failure`: recoverable failure envelope.

Run the local structural check:

```powershell
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\validate-n8n-fixtures.cjs
```

Replay all fixture cases and refresh the public cockpit status artifact:

```powershell
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\replay-n8n-fixtures.cjs --write
```

The replay artifact is written to `frontend/assets/n8n-contract-replay-status.json` and is safe for GitHub Pages because it contains only readiness metadata, case counts, and public fixture references.

The public-safe agent-config handoff manifest is:

```text
contracts/n8n/agent-config-public-export.json
```

It maps the three public fixtures to the future private `meids-agent-configs` repository structure. Validate it with:

```powershell
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\validate-agent-config-export.cjs
```

No secrets, private knowledge, webhook URLs, or credentials belong in these fixtures.

## Live URL Handoff

The fixtures prove the contract shape only. Live n8n rollout is handled through the runtime config boundary documented in:

```text
docs/n8n-live-url-configuration.md
frontend/assets/agent-runtime-config.json
```

Current public status:

- Actor Twin: public UAT URL configured.
- Knowledge Fabric Agent: fixture and probe slot ready; live URL missing.
- Agentic Butler: fixture and probe slot ready; live URL missing.

When a live workflow is exposed, add only the intentionally public UAT webhook URL to `frontend/assets/agent-runtime-config.json`. Keep private production URLs behind the hosted backend or workflow-generated `runtime-config.js`.
