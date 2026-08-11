# MeIDs n8n AI Agent Live Integration

Status: repo AI-agent import package ready; live n8n canvas verification required

## Target Workflows

| Agent | Workflow | Public webhook | Latest AI probe |
|---|---|---|---|
| Actor Twin | `MeIDs Actor Twin - staging` | `/webhook/meids/actor-twin/chat` | `n8n_exec_16247` |
| Knowledge Fabric Agent | `MeIDs Knowledge Fabric Agent - staging` | `/webhook/meids/knowledge-fabric/ingest` | `n8n_exec_16248` |
| Agentic Butler | `MeIDs Agentic Butler - staging` | `/webhook/meids/agentic-butler/run` | `n8n_exec_16249` |

## Current Repo Runtime Shape

The repository now provides importable AI-agent workflow exports with:

1. `Receive request` webhook node.
2. Dedicated AI Agent node.
3. `Eraneos LLM Gateway` chat model node wired into the AI Agent.
4. `Staging contract response` code node as response normalizer and safety boundary.
5. `Return JSON` webhook response node.

The main import targets are:

- `workflows/n8n/actor-twin.workflow.json`
- `workflows/n8n/knowledge-fabric-agent.workflow.json`
- `workflows/n8n/agentic-butler.workflow.json`

The AI Agent performs staging reasoning. The contract response node still enforces the public response envelope, trace ID, and status boundary.

Live n8n production trust is not inferred from URL reachability. It requires browser/API verification that the imported workflow canvas contains the AI Agent on the active path.

## Safety Boundaries

- Actor Twin returns `completed` for answer-only staging requests.
- Knowledge Fabric Agent returns `completed`, but concepts remain `pending-review`.
- Agentic Butler returns `approval_required` before skill execution or external actions.
- Live probes use `execute: false`.
- No private knowledge, credentials, or secret values are stored in public artifacts.

## Repo Artifacts

- `workflows/n8n/actor-twin.workflow.json`
- `workflows/n8n/knowledge-fabric-agent.workflow.json`
- `workflows/n8n/agentic-butler.workflow.json`
- `workflows/n8n/implementations/actor-twin.ai-agent.workflow.json`
- `workflows/n8n/implementations/knowledge-fabric-agent.ai-agent.workflow.json`
- `workflows/n8n/implementations/agentic-butler.ai-agent.workflow.json`
- `prompts/actor-twin/system.md`
- `prompts/knowledge-fabric-agent/system.md`
- `prompts/agentic-butler/system.md`
- `frontend/assets/n8n-live-probe-evidence.json`
- `contracts/n8n/schemas/agent-response.schema.json`
- `contracts/n8n/adapter-examples/*.json`
- `frontend/assets/n8n-production-adapter-status.json`
- `docs/production/n8n-ai-agent-live-import-checklist.md`

## Production Adapter Contract

The next live n8n patch should replace the staging response normalizer with a production adapter layer that validates raw AI Agent output against the shared response contract.

The adapter must return exactly one stable status:

- `completed`: safe answer or safe draft output with trace evidence.
- `approval_required`: risky action is proposed and must pause for human approval.
- `failed`: contract normalization failed or required input is missing.

Validate adapter examples with:

```powershell
node scripts\validate-n8n-response-adapters.cjs
node scripts\write-n8n-production-adapter-status.cjs --check
```

## Next Integration Step

Import or update the three main workflow exports in n8n, then replace staging response normalizers with production adapters incrementally:

1. Import or patch `workflows/n8n/*.workflow.json` into the live n8n workflows.
2. Confirm each AI Agent node is on the active path between webhook and response adapter.
3. Patch each live n8n workflow so raw AI output is normalized through the production adapter response schema.
4. Add explicit error fallback branches returning `failed` with `INVALID_CONTRACT_PAYLOAD`.
5. Re-run live probes and record new trace IDs after adapter patching.
6. Connect Knowledge Fabric output to OKF draft creation.
7. Connect Agentic Butler output to approved skill run records and approval queue.
8. Connect Actor Twin routing to choose answer-only, knowledge ingest, skill activation, or skill creation.
