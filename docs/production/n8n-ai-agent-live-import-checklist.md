# n8n AI Agent Live Import Checklist

Purpose: import or update the three MeIDs n8n workflows so the live UAT endpoints execute AI-agent logic instead of contract-only staging shells.

## Source Files

Use these workflow exports as the canonical public-safe import targets:

| Agent | Workflow export | Prompt sources |
| --- | --- | --- |
| Actor Twin | `workflows/n8n/actor-twin.workflow.json` | `prompts/actor-twin/system.md`, `prompts/actor-twin/critic.md` |
| Knowledge Fabric Agent | `workflows/n8n/knowledge-fabric-agent.workflow.json` | `prompts/knowledge-fabric-agent/system.md`, `prompts/knowledge-fabric-agent/graph-curator.md`, `prompts/knowledge-fabric-agent/vector-refresh.md` |
| Agentic Butler | `workflows/n8n/agentic-butler.workflow.json` | `prompts/agentic-butler/system.md`, `prompts/agentic-butler/skill-orchestrator.md`, `prompts/agentic-butler/approval-gates.md` |

## Required Live Workflow Shape

Each workflow must keep this active path:

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
- Delegates knowledge work to Knowledge Fabric Agent.
- Delegates skill activation or creation to Agentic Butler.
- Returns `completed`, `approval_required`, or `failed` with trace metadata.

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
- Returns `approval_required` before sending, scheduling, publishing, committing, or external execution.

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
node scripts\record-n8n-live-probe-evidence.cjs --agent agentic_butler --trace-id TRACE_ID --execution-url EXECUTION_URL --response-status approval_required --ai-agent-node "Agentic Butler AI Agent"
```

## Production Rule

Do not mark an agent as production-trusted only because its webhook URL responds. Production trust requires:

- AI Agent node on the active path.
- Model credential connected.
- System prompt installed.
- Contract adapter response valid.
- Non-demo n8n trace evidence recorded.
- Human approval gate proven for Agentic Butler.

