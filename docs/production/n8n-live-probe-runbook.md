# n8n Live Probe Runbook

Date: 2026-08-11

Purpose: provide the operator sequence for proving that the three MeIDs top-level agents are connected to live n8n workflows. This is the final live evidence gate for Zielmodus 4.

Boundary: this runbook is public-safe. Do not paste secrets, bearer tokens, private knowledge, or raw payloads containing personal data into committed artifacts.

## Agents

| Agent | Probe goal | Expected response status | Required evidence |
| --- | --- | --- | --- |
| Actor Twin | Answer-only query reaches the Actor Twin workflow and returns a traceable response. | `completed` | n8n execution URL plus trace id |
| Knowledge Fabric Agent | No-write ingest probe reaches the knowledge workflow without mutating production stores. | `completed` | n8n execution URL plus trace id |
| Agentic Butler | Approval-gated skill activation reaches the butler workflow and stops before external action. | `approval_required` | n8n execution URL plus trace id |

## Prerequisites

1. Public UAT webhook URLs exist for all three agents.
2. `frontend/assets/agent-runtime-config.json` or GitHub Pages secrets expose those URLs intentionally for UAT.
3. Contract fixtures pass:

```powershell
node scripts\validate-n8n-fixtures.cjs
```

4. Public-safe readiness preflight shows all URLs configured:

```powershell
node scripts\write-n8n-live-readiness-preflight.cjs --check
node scripts\validate-zielmodus-4-readiness.cjs --require-live
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

### 2. Knowledge Fabric Agent

Trigger a no-write ingest probe. Use a short public-safe transcript or fixture input only.

Record the n8n execution evidence:

```powershell
node scripts\record-n8n-live-probe-evidence.cjs `
  --agent knowledge_fabric_agent `
  --trace-id "TRACE_ID_FROM_N8N" `
  --execution-url "https://YOUR-N8N-HOST/workflow/.../executions/..." `
  --response-status completed `
  --url-source github-pages-secret
```

### 3. Agentic Butler

Trigger an approval-required skill activation probe. The workflow must stop at approval and must not send email, create meetings, write to external systems, or mutate production knowledge.

Record the n8n execution evidence:

```powershell
node scripts\record-n8n-live-probe-evidence.cjs `
  --agent agentic_butler `
  --trace-id "TRACE_ID_FROM_N8N" `
  --execution-url "https://YOUR-N8N-HOST/workflow/.../executions/..." `
  --response-status approval_required `
  --url-source github-pages-secret
```

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

- `frontend/assets/n8n-live-probe-evidence.json` contains connected, non-demo trace evidence for all three agents.
- `frontend/assets/n8n-live-readiness-preflight.json` reports all URLs and probes ready.
- `frontend/assets/zielmodus-4-live-completion-checklist.json` has no open live URL or probe trace gaps.
- GitHub Pages workflow succeeds.
- Production/Review Cockpit shows all three agents as connected.

## Failure Handling

| Failure | Response |
| --- | --- |
| URL validation fails | Use an HTTPS `/webhook/` URL and remove tokens or query-string secrets. |
| Workflow execution fails in n8n | Fix the workflow first; do not record failed evidence as connected. |
| Agentic Butler proceeds beyond approval | Treat as a blocker; update the n8n workflow to stop at human approval. |
| Recorder rejects trace id | Use the real n8n execution or trace id, not a placeholder or demo id. |
| Strict gate still fails | Re-run `node scripts\write-n8n-live-readiness-preflight.cjs --check` and inspect the listed blocker. |

