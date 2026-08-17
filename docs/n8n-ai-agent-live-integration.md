# MeIDs n8n AI Agent Live Integration

Status: embedded Actor Twin chat is the live frontend entrypoint; live n8n worker canvases require alignment with the import-ready workflow JSONs before delegated routes can pass UAT.

## Target Workflows

| Agent | Workflow | Runtime entrypoint | Latest AI probe |
|---|---|---|---|
| Actor Twin | `MeIDs Actor Twin - staging` | Embedded n8n chat: `https://eraneos-agentic-platform.azurewebsites.net/webhook/b4afb251-2ad1-43da-9d7c-6f6473fbd3db/chat` | `n8n_exec_16247` |
| Knowledge Fabric Agent | `MeIDs Knowledge Fabric Agent - staging` | Internal Actor Twin workflow tool; direct probe URL: `/webhook/meids/knowledge-fabric/ingest` | `n8n_exec_16248` |
| Agentic Butler | `MeIDs Agentic Butler - staging` | Internal Actor Twin workflow tool; direct probe URL: `/webhook/meids/agentic-butler/run` | `n8n_exec_16249` |

## Current Runtime Shape

The live frontend uses the n8n embedded chat as the single Actor Twin interaction
surface. The Actor Twin workflow owns the user turn and calls worker workflows as
n8n workflow tools when execution is needed:

1. `When chat message received` chat trigger.
2. `Actor Twin AI Agent` with the Eraneos LLM Gateway chat model.
3. `Call MeIDs Knowledge Fabric Agent` workflow tool for retrieval, ingestion,
   OKF staging, graph hints, and vector-boundary work.
4. `Call MeIDs Agentic Butler` workflow tool for approved skill execution,
   internal work artifacts, and skill or agent proposals.

The repository also keeps public-safe importable AI-agent worker workflow exports
with dual entrypoints:

1. `Receive request` webhook node.
2. `Receive workflow call` Execute Workflow Trigger for Actor Twin workflow-tool calls.
3. Dedicated AI Agent node.
4. `Eraneos LLM Gateway` chat model node wired into the AI Agent.
5. `Staging contract response` code node as response normalizer and safety boundary.
6. `Return JSON` webhook response node for direct probes.

The current browser/API import targets are:

- `workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json`
- `workflows/n8n/import-ready/knowledge-fabric-agent.ai-agent.import.json`
- `workflows/n8n/import-ready/agentic-butler.ai-agent.import.json`

The implementation-source mirrors remain available for review and diffing:

- `workflows/n8n/implementations/actor-twin-direct-orchestrator.uat-live-urls.workflow.json`
- `workflows/n8n/implementations/knowledge-fabric-agent.ai-agent.workflow.json`
- `workflows/n8n/implementations/agentic-butler.ai-agent.workflow.json`

The legacy top-level workflow files remain compatibility references, but should
not be used as the current live import source unless explicitly refreshed.

The AI Agent performs staging reasoning. For direct public probe URLs, the
contract response node still enforces the public response envelope, trace ID,
and status boundary. For embedded chat, the user-facing answer should be a
normal chat answer, while structured route, trace, and worker evidence stays in
n8n execution metadata or cockpit evidence artifacts.

Live n8n production trust is not inferred from URL reachability. It requires browser/API verification that the imported workflow canvas contains the AI Agent on the active path.

## Safety Boundaries

- Actor Twin answers directly for normal identity, clarification, and context
  questions. It delegates only when knowledge work or skill work is actually
  needed.
- Knowledge Fabric Agent returns `completed`, but concepts remain `pending-review`.
- Agentic Butler returns `completed` for delegated skill execution and internal
  work artifacts. It returns `approval_required` only before generated skill or
  agent activation proposals, and later before true external side effects once
  those tools exist. It must not require approval just because Actor Twin called
  it.
- Live probes use `execute: false`.
- No private knowledge, credentials, or secret values are stored in public artifacts.

## Repo Artifacts

- `workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json`
- `workflows/n8n/import-ready/knowledge-fabric-agent.ai-agent.import.json`
- `workflows/n8n/import-ready/agentic-butler.ai-agent.import.json`
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

Align the live n8n canvas with the embedded-chat operating model, then replace
staging response normalizers with production adapters incrementally:

1. Confirm the Actor Twin workflow uses `When chat message received` in Embedded
   Chat mode and exposes the chat URL above.
2. Confirm the Actor Twin AI Agent has workflow tools connected for Knowledge
   Fabric and Agentic Butler.
3. Import or patch `workflows/n8n/import-ready/knowledge-fabric-agent.ai-agent.import.json`
   and `workflows/n8n/import-ready/agentic-butler.ai-agent.import.json` into the
   worker workflows. These files keep public webhook probes and add the
   `Receive workflow call` trigger required by Actor Twin workflow tools.
4. Do not import the direct-orchestrator JSON into the embedded Actor Twin chat
   workflow. Use the existing embedded-chat Actor Twin workflow and connect the
   two worker workflows as tools.
5. Confirm each worker AI Agent node is on the active path between webhook or
   workflow trigger and response adapter.
6. Patch each live n8n worker workflow so raw AI output is normalized through
   the production adapter response schema.
7. Add explicit error fallback branches returning `failed` with
   `INVALID_CONTRACT_PAYLOAD`.
8. Re-run live probes and record new trace IDs after adapter patching.
9. Connect Knowledge Fabric output to OKF draft creation.
10. Connect Agentic Butler output to approved skill run records and the skill or
   agent approval queue only when activation is requested.
11. Keep Actor Twin routing as the authority for answer-only, knowledge work,
   skill execution, and skill or agent creation.

## 2026-08-13 Live Alignment Note

Local validation passed for:

```powershell
node scripts\validate-actor-twin-direct-orchestrator-import.cjs
node scripts\simulate-actor-twin-direct-orchestrator-import.cjs
node scripts\validate-n8n-ai-agent-workflows.cjs
```

Local API update payloads were prepared at:

- `exports/n8n-live-backups/20260813T191210Z-actor-direct-orchestrator/actor-twin.direct-orchestrator.update-payload.json`
- `exports/n8n-live-backups/20260813T191210Z-knowledge_fabric_agent-ai-agent/knowledge_fabric_agent.update-payload.json`
- `exports/n8n-live-backups/20260813T191210Z-agentic_butler-ai-agent/agentic_butler.update-payload.json`

Live API apply was not executed from this shell because `N8N_API_KEY` was not
available in the local environment. Apply through the n8n browser import flow or
rerun the prepare scripts with `--apply` after setting the API key and workflow
ids.

## 2026-08-17 Live UAT Note

Local repository validation passes:

```powershell
npm run check:agents
```

Live n8n UAT is still blocked:

```powershell
npm run uat:agents:live
```

Current result:

```text
1/4 passed
```

The passing route is the direct Actor Twin answer route. The failing routes are
caused by live n8n worker workflow drift:

- Knowledge Fabric Agent: live workflow still errors on `Simple Memory`.
- Agentic Butler: live workflow still errors with `Referenced node does not exist`.
- Actor Twin delegated Butler route: times out while the worker route is broken.

Apply the worker import-ready JSONs to the running n8n workflows, publish them,
then rerun:

1. `workflows/n8n/import-ready/knowledge-fabric-agent.ai-agent.import.json`
2. `workflows/n8n/import-ready/agentic-butler.ai-agent.import.json`

These worker JSONs now include `Receive workflow call` so Actor Twin can call
them as n8n workflow tools. Keep the embedded-chat Actor Twin workflow as the
frontdoor.

```powershell
npm run uat:agents:live
```
