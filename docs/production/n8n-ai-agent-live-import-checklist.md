# n8n AI Agent Live Import Checklist

Purpose: align the live MeIDs n8n workflows so the embedded Actor Twin chat executes AI-agent logic and calls Knowledge Fabric / Agentic Butler as workflow tools instead of relying on contract-only staging shells.

## Source Files

Use these workflow exports as the canonical public-safe import targets for
worker/direct-probe alignment. The current user-facing Actor Twin entrypoint is
the embedded n8n chat trigger, not the old `/meids/actor-twin/chat` webhook.

| Agent | Workflow export | Prompt sources |
| --- | --- | --- |
| Actor Twin | `workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json` | `prompts/actor-twin/system.md`, `prompts/actor-twin/critic.md` |
| Knowledge Fabric Agent | `workflows/n8n/import-ready/knowledge-fabric-agent.ai-agent.import.json` | `prompts/knowledge-fabric-agent/system.md`, `prompts/knowledge-fabric-agent/graph-curator.md`, `prompts/knowledge-fabric-agent/vector-refresh.md` |
| Agentic Butler | `workflows/n8n/import-ready/agentic-butler.ai-agent.import.json` | `prompts/agentic-butler/system.md`, `prompts/agentic-butler/skill-orchestrator.md`, `prompts/agentic-butler/approval-gates.md` |

Implementation-source mirrors are kept under `workflows/n8n/implementations/`.
Use the `import-ready` files for browser import/export alignment because they
contain the current n8n canvas shape.

## 2026-08-13 Prepared API Payloads

The latest local alignment run validated all three import-ready JSON files and
prepared API update payloads under `exports/n8n-live-backups/`.

| Agent | Prepared payload | Live apply status |
| --- | --- | --- |
| Actor Twin | `exports/n8n-live-backups/20260813T191210Z-actor-direct-orchestrator/actor-twin.direct-orchestrator.update-payload.json` | Prepared only; live API apply requires `N8N_API_BASE_URL`, `N8N_API_KEY`, and the active Actor Twin workflow id |
| Knowledge Fabric Agent | `exports/n8n-live-backups/20260813T191210Z-knowledge_fabric_agent-ai-agent/knowledge_fabric_agent.update-payload.json` | Prepared only; live API apply requires `N8N_API_BASE_URL`, `N8N_API_KEY`, and `N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID` |
| Agentic Butler | `exports/n8n-live-backups/20260813T191210Z-agentic_butler-ai-agent/agentic_butler.update-payload.json` | Prepared only; live API apply requires `N8N_API_BASE_URL`, `N8N_API_KEY`, and `N8N_AGENTIC_BUTLER_WORKFLOW_ID` |

Expected live workflow ids from the current n8n UAT setup:

| Agent | Expected workflow id |
| --- | --- |
| Actor Twin | `eKI3qM7nyCNn9r1q` for the current published duplicate, or `fDn8yXo3W41hh3yR` for the older default script target |
| Knowledge Fabric Agent | `7Ci86PxXipwvYpKv` |
| Agentic Butler | `KZOqZRUAnVfFEAYJ` |

Use API apply only after confirming the active workflow id in n8n.

Current embedded Actor Twin chat URL:

```text
https://eraneos-agentic-platform.azurewebsites.net/webhook/b4afb251-2ad1-43da-9d7c-6f6473fbd3db/chat
```

```powershell
$env:N8N_API_BASE_URL = "https://eraneos-agentic-platform.azurewebsites.net"
$env:N8N_ACTOR_TWIN_WORKFLOW_ID = "PASTE_ACTIVE_ACTOR_TWIN_WORKFLOW_ID"
$env:N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID = "7Ci86PxXipwvYpKv"
$env:N8N_AGENTIC_BUTLER_WORKFLOW_ID = "KZOqZRUAnVfFEAYJ"

node scripts\prepare-n8n-actor-twin-api-update.cjs --apply
node scripts\prepare-n8n-agent-workflow-api-update.cjs --agent=knowledge_fabric_agent --apply
node scripts\prepare-n8n-agent-workflow-api-update.cjs --agent=agentic_butler --apply
```

The `N8N_API_KEY` value must be provided through a local shell secret or hosted
secret store. It must not be committed.

## Required Live Workflow Shape

The Actor Twin workflow must keep this active path:

1. `When chat message received` in Embedded Chat mode.
2. `Actor Twin AI Agent`.
3. Eraneos LLM Gateway chat model connected to the AI Agent.
4. Workflow tools connected to:
   - `MeIDs Knowledge Fabric Agent`
   - `MeIDs Agentic Butler`
5. Published workflow with public chat enabled.

The worker/direct-probe workflows must keep this active path:

1. `Receive request`
2. `<Agent> AI Agent`
3. `Staging contract response` or production adapter response normalizer
4. `Return JSON`

The chat model node must be connected to the AI Agent through the n8n AI language model connection.

## Agent-Specific Acceptance Criteria

### Actor Twin

- Interprets intent.
- Chooses a route decision: `answer_direct`, `retrieve_knowledge`, `ingest_or_stage_knowledge`, `activate_skill`, `create_skill`, or `request_human_clarification`.
- Answers directly only when no execution or external side effect is needed.
- Delegates knowledge work to Knowledge Fabric Agent through a workflow tool.
- Delegates skill activation or creation to Agentic Butler through a workflow tool.
- Does not show approval gates for normal answers or internal work artifacts.
- Returns normal chat answers in embedded chat and keeps trace metadata available in n8n execution evidence.

### Knowledge Fabric Agent

- Creates pending OKF candidates from uploads, transcripts, or source text.
- Creates evidence and CRUD audit references.
- Produces candidate graph relation hints only.
- Defers vector refresh unless approval policy allows it.
- Never promotes concepts or graph edges directly.

### Agentic Butler

- Activates approved skills only.
- Keeps Skill Orchestrator internal.
- Creates new skill drafts through elicitation when no approved skill fits.
- Keeps generated skills `pending_approval`.
- Returns `completed` for delegated drafts, planning, summaries, meeting prep, and internal work artifacts.
- Returns `approval_required` only before a generated skill, task-agent, subagent, or agent design becomes active, or before a real external write action is executed.
- Does not require approval merely because Actor Twin delegated the request.

## Live Probe Sequence

After importing or updating workflows:

```powershell
node scripts\validate-n8n-ai-agent-workflows.cjs
node scripts\validate-n8n-fixtures.cjs
node scripts\replay-n8n-fixtures.cjs --write
node scripts\write-n8n-ai-agent-readiness-status.cjs
node scripts\check-zielmodus-4-public-safe.cjs
```

Then run the cockpit live probes and record new trace evidence:

```powershell
node scripts\record-n8n-live-probe-evidence.cjs --agent actor_twin --trace-id TRACE_ID --execution-url EXECUTION_URL --response-status completed --ai-agent-node "Actor Twin AI Agent"
node scripts\record-n8n-live-probe-evidence.cjs --agent knowledge_fabric_agent --trace-id TRACE_ID --execution-url EXECUTION_URL --response-status completed --ai-agent-node "Knowledge Fabric AI Agent"
node scripts\record-n8n-live-probe-evidence.cjs --agent agentic_butler --trace-id TRACE_ID --execution-url EXECUTION_URL --response-status completed --ai-agent-node "Agentic Butler AI Agent"
```

## Production Rule

Do not mark an agent as production-trusted only because its webhook or chat URL responds. Production trust requires:

- AI Agent node on the active path.
- Model credential connected.
- System prompt installed.
- Contract adapter response valid.
- Non-demo n8n trace evidence recorded.
- Actor Twin embedded chat UAT passed for direct answer, knowledge delegation, Butler skill execution, and skill or agent proposal.
- Agentic Butler approval gate proven only for generated capability activation or true external write actions.
