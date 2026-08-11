# n8n Contract Shell Rollout

Date: 2026-08-11

Purpose: provide a controlled bridge from staging-only n8n workflows to contract-compliant workflows that MeIDs can probe and validate.

## Artifacts

Importable contract shells:

- `workflows/n8n/implementations/actor-twin.contract-shell.workflow.json`
- `workflows/n8n/implementations/knowledge-fabric-agent.contract-shell.workflow.json`
- `workflows/n8n/implementations/agentic-butler.contract-shell.workflow.json`

These shells are public-safe. They contain no credentials, no private knowledge, and no production secrets.

## Important Boundary

The shells make the endpoint contract-ready. They do not replace the real AI-agent implementation.

Use them in two stages:

1. **Contract stabilization:** import or copy the Code node logic into staging workflows so live probes can return the expected status and trace shape.
2. **Agent intelligence:** insert AI Agent / LLM / subworkflow nodes before the contract response node and map their output into the same contract shape.

## Rollout Steps

### 1. Backup Current n8n Workflows

In n8n:

1. Open each workflow.
2. Use the workflow menu.
3. Export/download the current workflow JSON.
4. Store backup outside the public repo if it contains private workflow details.

### 2. Apply Knowledge Fabric Contract Shell

Target workflow:

- `MeIDs Knowledge Fabric Agent - staging`
- Current production webhook path: `/webhook/meids/knowledge-fabric/ingest`

Minimum changes:

1. Keep the existing Webhook node and path.
2. Replace the current `Staging contract response` Code node logic with the Code node logic from `knowledge-fabric-agent.contract-shell.workflow.json`.
3. Keep `Respond to Webhook` returning the full JSON object.
4. Execute the no-write live probe.

Expected response:

- `status: completed`
- `agent_id: knowledge_fabric_agent`
- `output.readiness: connected`
- `output.side_effects: none`
- `trace.stored: true`
- `trace.trace_id` present and non-placeholder

AI insertion point:

- Add an AI Agent or LLM node between `Receive request` and `Contract response shell`.
- AI task: draft pending OKF concept markdown/YAML and candidate graph relations.
- Contract response node must continue to enforce `review_state: pending_review` and vector refresh deferral until review approval exists.

### 3. Apply Agentic Butler Contract Shell

Target workflow:

- `MeIDs Agentic Butler - staging`
- Current production webhook path: `/webhook/meids/agentic-butler/run`

Minimum changes:

1. Keep the existing Webhook node and path.
2. Replace the current `Staging contract response` Code node logic with the Code node logic from `agentic-butler.contract-shell.workflow.json`.
3. Keep `Respond to Webhook` returning the full JSON object.
4. Execute the approval-gated live probe.

Expected response:

- `status: approval_required`
- `agent_id: agentic_butler`
- `approval.required: true`
- `approval.gate: requires_human_action`
- `output.side_effects: none`
- `trace.stored: true`
- `trace.trace_id` present and non-placeholder

AI insertion point:

- Add approved-skill lookup before task execution.
- Add Skill Orchestrator as an internal subworkflow or AI Agent node.
- Add Actor Twin checkpoint before prioritization and before any risky action.
- Keep human approval gates in the contract response layer even if upstream AI output is incomplete.

### 4. Apply Actor Twin Contract Shell

Target workflow:

- Current Actor Twin external chat workflow, currently returning HTTP 500 for the probe.

Minimum changes:

1. Add or update a webhook/chat trigger that accepts the MeIDs Actor Twin envelope.
2. Add the `Contract response shell` Code node logic from `actor-twin.contract-shell.workflow.json`.
3. Return full JSON via `Respond to Webhook`.
4. Execute the answer-only live probe.

Expected response:

- `status: completed`
- `agent_id: actor_twin`
- `output.mode: answer_only`
- `trace.stored: true`
- `trace.trace_id` present and non-placeholder

AI insertion point:

- Add retrieval and persona steering before final response.
- Use approved OKF context first.
- Route execution intents to Agentic Butler instead of executing directly.

## Record Evidence After Rollout

Once each live probe returns the expected status and trace id:

```powershell
node scripts\record-n8n-live-probe-evidence.cjs `
  --agent actor_twin `
  --trace-id "n8n_exec_<id>" `
  --execution-url "https://eraneos-agentic-platform.azurewebsites.net/workflow/<workflow-id>/executions/<execution-id>" `
  --response-status completed `
  --url-source github-pages-secret

node scripts\record-n8n-live-probe-evidence.cjs `
  --agent knowledge_fabric_agent `
  --trace-id "n8n_exec_<id>" `
  --execution-url "https://eraneos-agentic-platform.azurewebsites.net/workflow/<workflow-id>/executions/<execution-id>" `
  --response-status completed `
  --url-source github-pages-secret

node scripts\record-n8n-live-probe-evidence.cjs `
  --agent agentic_butler `
  --trace-id "n8n_exec_<id>" `
  --execution-url "https://eraneos-agentic-platform.azurewebsites.net/workflow/<workflow-id>/executions/<execution-id>" `
  --response-status approval_required `
  --url-source github-pages-secret
```

Then run:

```powershell
node scripts\validate-zielmodus-4-readiness.cjs --require-live-probes
node scripts\check-zielmodus-4-public-safe.cjs
```

## Production Upgrade After Shell Passes

After contract shells pass:

1. Replace deterministic draft logic with real AI Agent nodes.
2. Keep the same response envelopes.
3. Add trace writer and execution id mapping.
4. Add error mapping for invalid payloads, missing skill approval, and model/tool failures.
5. Re-run the same live probes after every workflow change.
