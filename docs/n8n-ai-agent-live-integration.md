# MeIDs n8n AI Agent Live Integration

Status: staging live probe passed

## Integrated Workflows

| Agent | Workflow | Public webhook | Latest AI probe |
|---|---|---|---|
| Actor Twin | `MeIDs Actor Twin - staging` | `/webhook/meids/actor-twin/chat` | `n8n_exec_16247` |
| Knowledge Fabric Agent | `MeIDs Knowledge Fabric Agent - staging` | `/webhook/meids/knowledge-fabric/ingest` | `n8n_exec_16248` |
| Agentic Butler | `MeIDs Agentic Butler - staging` | `/webhook/meids/agentic-butler/run` | `n8n_exec_16249` |

## Current Runtime Shape

Each workflow now uses:

1. `Receive request` webhook node.
2. Dedicated AI Agent node.
3. `Eraneos LLM Gateway` chat model node wired into the AI Agent.
4. `Staging contract response` code node as response normalizer and safety boundary.
5. `Return JSON` webhook response node.

The AI Agent performs staging reasoning. The contract response node still enforces the public response envelope, trace ID, and status boundary.

## Safety Boundaries

- Actor Twin returns `completed` for answer-only staging requests.
- Knowledge Fabric Agent returns `completed`, but concepts remain `pending-review`.
- Agentic Butler returns `approval_required` before skill execution or external actions.
- Live probes use `execute: false`.
- No private knowledge, credentials, or secret values are stored in public artifacts.

## Repo Artifacts

- `workflows/n8n/implementations/actor-twin.ai-agent.workflow.json`
- `workflows/n8n/implementations/knowledge-fabric-agent.ai-agent.workflow.json`
- `workflows/n8n/implementations/agentic-butler.ai-agent.workflow.json`
- `frontend/assets/n8n-live-probe-evidence.json`

## Next Integration Step

Replace the staging contract shell outputs with production adapters incrementally:

1. Add response schema validation after each AI Agent.
2. Add explicit error fallback branches.
3. Connect Knowledge Fabric output to OKF draft creation.
4. Connect Agentic Butler output to approved skill run records and approval queue.
5. Connect Actor Twin routing to choose answer-only, knowledge ingest, or skill activation.
