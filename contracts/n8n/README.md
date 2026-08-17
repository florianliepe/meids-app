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
- `live_probe`: no-write readiness probe used after a public UAT or hosted webhook URL exists.

Standalone no-write live probe payloads are also available for direct n8n replay or manual webhook testing:

```text
contracts/n8n/live-probes/actor-twin.json
contracts/n8n/live-probes/knowledge-fabric-agent.json
contracts/n8n/live-probes/agentic-butler.json
```

They are derived from the embedded `live_probe` blocks in the fixtures. Actor Twin, Knowledge Fabric Agent, and normal Agentic Butler work-artifact probes expect `completed`. Agentic Butler returns `approval_required` only for generated skill or agent activation proposals, or future irreversible external write actions once those tools exist.

Run the local structural check:

```powershell
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\validate-n8n-fixtures.cjs
```

Replay all fixture cases and refresh the public cockpit status artifact:

```powershell
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\replay-n8n-fixtures.cjs --write
```

Validate that standalone live-probe payloads still match their source fixtures:

```powershell
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\validate-n8n-live-probes.cjs
```

The replay artifact is written to `frontend/assets/n8n-contract-replay-status.json` and is safe for GitHub Pages because it contains only readiness metadata, case counts, and public fixture references. Current coverage is 15 replay cases across the three top-level agents.

The public-safe agent-config handoff manifest is:

```text
contracts/n8n/agent-config-public-export.json
```

It maps the three public fixtures to the future private `meids-agent-configs` repository structure. It also references public-safe workflow blueprints:

```text
workflows/n8n/actor-twin.workflow.json
workflows/n8n/knowledge-fabric-agent.workflow.json
workflows/n8n/agentic-butler.workflow.json
```

These are not live n8n exports. They define the expected trigger, minimum nodes, approval boundary, trace fields, and live-probe return shape for each top-level agent so n8n implementation can proceed without exposing credentials or private knowledge.

Validate the manifest and the workflow blueprints with:

```powershell
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\validate-agent-config-export.cjs
```

No secrets, private knowledge, webhook URLs, or credentials belong in these fixtures.

## Live Runtime Handoff

The fixtures prove the contract shape only. The live GitHub Pages runtime now uses the embedded n8n Actor Twin chat as the single user-facing interaction surface. Knowledge Fabric Agent and Agentic Butler are expected to run behind the Actor Twin as n8n workflow tools or sub-workflows, not as separate buttons in the frontend.

Live n8n rollout is handled through the runtime config boundary documented in:

```text
docs/n8n-live-url-configuration.md
frontend/assets/agent-runtime-config.json
```

Current public status:

- Actor Twin: embedded public n8n chat URL configured.
- Knowledge Fabric Agent: fixture and probe slot ready; normally called internally by Actor Twin in n8n.
- Agentic Butler: fixture and probe slot ready; normally called internally by Actor Twin in n8n.

Direct public worker URLs for Knowledge Fabric Agent or Agentic Butler are optional diagnostics/probes only. They are no longer required for the GitHub Pages Actor Twin UAT because the Actor Twin chat workflow is the orchestration boundary.

When a live workflow is exposed directly, add only an intentionally public UAT URL to `frontend/assets/agent-runtime-config.json`. Keep private production URLs behind the hosted backend, n8n environment variables, workflow credentials, or workflow-generated `runtime-config.js`.
