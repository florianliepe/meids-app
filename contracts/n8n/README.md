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

No secrets, private knowledge, webhook URLs, or credentials belong in these fixtures.
