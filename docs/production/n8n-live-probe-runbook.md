# n8n Live Probe Runbook

Date: 2026-08-11

Purpose: provide the operator sequence for proving that the embedded n8n Actor Twin chat can answer directly and call the two worker agents through n8n workflow tools or sub-workflows. This is the final live evidence gate for Zielmodus 4.

Boundary: this runbook is public-safe. Do not paste secrets, bearer tokens, private knowledge, or raw payloads containing personal data into committed artifacts.

## Agents

| Agent | Probe goal | Expected response status | Required evidence |
| --- | --- | --- | --- |
| Actor Twin | Answer-only query reaches the embedded Actor Twin chat workflow and returns a traceable response. | `completed` | n8n execution URL plus trace id |
| Knowledge Fabric Agent | Actor Twin calls the knowledge workflow/tool for retrieval, ingest staging, or graph/vector enrichment. | `completed` | Actor Twin execution URL plus routed tool evidence |
| Agentic Butler | Actor Twin calls Butler for an autonomous work artifact or approved skill run. | `completed` | Actor Twin execution URL plus routed tool evidence |
| Agentic Butler skill/agent creation | Actor Twin calls Butler to draft a new skill/agent proposal. | `approval_required` or pending proposal | Actor Twin execution URL plus proposal evidence |

## Prerequisites

1. Embedded n8n Actor Twin chat URL is configured in `frontend/assets/agent-runtime-config.json` or GitHub Pages secrets.
2. Knowledge Fabric Agent and Agentic Butler are attached to the Actor Twin AI Agent as n8n workflow tools or sub-workflows.
3. Contract fixtures pass:

```powershell
node scripts\validate-n8n-fixtures.cjs
```

4. Public-safe readiness preflight shows the Actor Twin chat entrypoint configured:

```powershell
node scripts\write-n8n-live-readiness-preflight.cjs --check
```

## Probe Sequence

### 1. Actor Twin

Trigger a harmless answer-only request from Chat, for example:

```text
Who is the active twin and what context is available?
```

Record the n8n execution evidence:

```powershell
node scripts\record-n8n-live-probe-evidence.cjs `
  --agent actor_twin `
  --trace-id "TRACE_ID_FROM_N8N" `
  --execution-url "https://YOUR-N8N-HOST/workflow/.../executions/..." `
  --response-status completed `
  --url-source github-pages-secret
```

### 2. Knowledge Fabric Agent Through Actor Twin

Trigger a knowledge route from the embedded Actor Twin chat. Use a public-safe question that should require OKF, vector, or graph context, for example:

```text
Use the knowledge fabric to explain what MeIDs is designed to support.
```

Record the n8n execution evidence:

```powershell
node scripts\record-n8n-live-probe-evidence.cjs `
  --agent knowledge_fabric_agent `
  --trace-id "TRACE_ID_FROM_N8N" `
  --execution-url "https://YOUR-N8N-HOST/workflow/.../executions/..." `
  --response-status completed `
  --url-source actor-twin-internal-tool
```

### 3. Agentic Butler Through Actor Twin

Trigger an autonomous work-artifact route from the embedded Actor Twin chat, for example:

```text
Draft an email for the dev team about the next feature priorities.
```

The workflow should return the draft artifact without an approval gate because no email is sent and no external system is mutated.

Record the n8n execution evidence:

```powershell
node scripts\record-n8n-live-probe-evidence.cjs `
  --agent agentic_butler `
  --trace-id "TRACE_ID_FROM_N8N" `
  --execution-url "https://YOUR-N8N-HOST/workflow/.../executions/..." `
  --response-status completed `
  --url-source actor-twin-internal-tool
```

### 4. Agentic Butler Skill Or Agent Proposal

Trigger a skill or agent creation proposal, for example:

```text
Create a new skill for preparing steering committee briefings.
```

The workflow may return `approval_required` or a pending proposal. Approval is required before a generated skill, task agent, or new agent becomes active.

## Final Gate

After all three probe records exist, regenerate and validate:

```powershell
node scripts\write-n8n-live-readiness-preflight.cjs --write
node scripts\write-n8n-live-handoff-commands.cjs --write
node scripts\write-zielmodus-4-live-completion-checklist.cjs --write
node scripts\validate-zielmodus-4-readiness.cjs --write

node scripts\write-n8n-live-readiness-preflight.cjs --check
node scripts\write-n8n-live-handoff-commands.cjs --check
node scripts\write-zielmodus-4-live-completion-checklist.cjs --check
node scripts\validate-zielmodus-4-readiness.cjs --require-live-probes
node scripts\check-zielmodus-4-public-safe.cjs
```

## Acceptance Criteria

- `frontend/assets/n8n-live-probe-evidence.json` contains connected, non-demo trace evidence for Actor Twin direct answer, Knowledge Fabric internal-tool route, Butler work-artifact route, and Butler skill/agent proposal route.
- `frontend/assets/n8n-live-readiness-preflight.json` reports the Actor Twin embedded chat entrypoint ready and worker agents internal-tool ready.
- `frontend/assets/zielmodus-4-live-completion-checklist.json` has no open live URL or probe trace gaps.
- GitHub Pages workflow succeeds.
- Production/Review Cockpit shows all three agents as connected.

## Failure Handling

| Failure | Response |
| --- | --- |
| URL validation fails | Use an HTTPS `/webhook/` URL and remove tokens or query-string secrets. |
| Workflow execution fails in n8n | Fix the workflow first; do not record failed evidence as connected. |
| Agentic Butler asks approval for ordinary drafts/plans/briefs | Treat as a blocker; ordinary internal artifacts should complete autonomously. |
| Agentic Butler activates a generated skill/agent without approval | Treat as a blocker; generated capabilities must stay pending until human approval. |
| Recorder rejects trace id | Use the real n8n execution or trace id, not a placeholder or demo id. |
| Strict gate still fails | Re-run `node scripts\write-n8n-live-readiness-preflight.cjs --check` and inspect the listed blocker. |
