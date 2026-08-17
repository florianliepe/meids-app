# n8n Live Readiness Operator Checklist

Date: 2026-08-11

Purpose: one copy-paste checklist to close the remaining Zielmodus 4 live integration gate for the embedded n8n Actor Twin chat architecture.

Boundary: public-safe. Do not commit API keys, bearer tokens, private knowledge, or secret-bearing URLs.

## What Is Left

Important boundary: this checklist verifies live contract readiness and records trace evidence. It does not create the internal AI Agent nodes inside n8n. The required n8n agent implementation package is documented in `docs/production/n8n-ai-agent-integration-plan.md`.

| Agent | Current open item | Required result |
| --- | --- | --- |
| Actor Twin | Record non-demo embedded-chat evidence | `completed` response with n8n execution id |
| Knowledge Fabric Agent | Prove Actor Twin can call it as an internal n8n tool/sub-workflow | `completed` no-write knowledge route inside the Actor Twin execution trace |
| Agentic Butler | Prove Actor Twin can call it as an internal n8n tool/sub-workflow | `completed` autonomous work-artifact route inside the Actor Twin execution trace |

Expected remaining time after the Actor Twin workflow tools are published: **45-90 minutes** including n8n chat UAT, trace capture, artifact refresh, commit, deploy, and GitHub Pages verification.

## 1. Configure Embedded Actor Twin Chat

Use repository secrets for durable GitHub Pages deployment:

- `GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL`

Knowledge Fabric Agent and Agentic Butler should be configured inside the Actor Twin workflow as n8n workflow tools or sub-workflows. Their internal workflow IDs, environment variables, or credentials should stay in n8n or a hosted backend, not in public Pages assets.

Optional direct diagnostic URLs can still be configured for local public UAT only:

```powershell
node scripts\set-n8n-agent-url.cjs --agent knowledge_fabric_agent --url "https://YOUR-N8N-HOST/webhook/YOUR-KNOWLEDGE-FABRIC-UAT-PATH"
node scripts\set-n8n-agent-url.cjs --agent agentic_butler --url "https://YOUR-N8N-HOST/webhook/YOUR-AGENTIC-BUTLER-UAT-PATH"
```

Rules:

- URL must use `https`.
- URL path must include `/webhook/`.
- URL must not contain tokens, API keys, passwords, or bearer credentials.

## 2. Refresh Runtime Readiness

```powershell
node scripts\write-n8n-runtime-readiness-status.cjs --check
node scripts\write-n8n-live-readiness-preflight.cjs --check
node scripts\write-zielmodus-4-live-completion-checklist.cjs --check
node scripts\write-n8n-live-handoff-commands.cjs --check
node scripts\validate-n8n-fixtures.cjs
```

Do not use missing direct worker URLs as a blocker when the embedded Actor Twin chat can call Knowledge Fabric Agent and Agentic Butler internally. Treat direct worker URL checks as diagnostic-only for the Pages architecture.

## 3. Run Embedded Chat UAT Probes

Use the embedded Actor Twin chat and capture the n8n execution evidence for each route:

- Direct answer: `Who are you?`
- Knowledge route: `Use my knowledge context to explain what MeIDs is for.`
- Butler route: `Draft an email for the dev team about next feature priorities.`
- Skill proposal route: `Create a new skill for preparing steering committee briefings.`

Expected outcomes:

| Agent | Expected response status | Safety condition |
| --- | --- | --- |
| Actor Twin | `completed` | Answer-only request, no external action |
| Knowledge Fabric Agent | `completed` | Internal knowledge tool route, no irreversible mutation unless explicitly configured as pending-only |
| Agentic Butler | `completed` | Drafts, plans, briefs, and approved skill runs complete without approval when no external side effect occurs |
| Agentic Butler skill/agent creation | `approval_required` or pending proposal | Approval is required before a generated skill, agent, or task-agent becomes active |

## 4. Record Public-Safe Trace Evidence

Replace placeholders with the real n8n execution trace id and public-safe execution URL. If Knowledge Fabric Agent and Agentic Butler run inside the Actor Twin execution, use the Actor Twin execution URL and record the routed sub-agent evidence in the trace notes.

```powershell
node scripts\record-n8n-live-probe-evidence.cjs `
  --agent actor_twin `
  --trace-id "TRACE_ID_FROM_N8N" `
  --execution-url "https://YOUR-N8N-HOST/workflow/.../executions/..." `
  --response-status completed `
  --url-source github-pages-secret

node scripts\record-n8n-live-probe-evidence.cjs `
  --agent knowledge_fabric_agent `
  --trace-id "TRACE_ID_FROM_N8N" `
  --execution-url "https://YOUR-N8N-HOST/workflow/.../executions/..." `
  --response-status completed `
  --url-source actor-twin-internal-tool

node scripts\record-n8n-live-probe-evidence.cjs `
  --agent agentic_butler `
  --trace-id "TRACE_ID_FROM_N8N" `
  --execution-url "https://YOUR-N8N-HOST/workflow/.../executions/..." `
  --response-status completed `
  --url-source actor-twin-internal-tool
```

The recorder rejects placeholder trace ids, non-HTTPS execution URLs, and URLs that look like they contain secrets.

## 5. Regenerate And Validate Final Gate

```powershell
node scripts\write-n8n-runtime-readiness-status.cjs --write
node scripts\write-n8n-live-readiness-preflight.cjs --write
node scripts\write-n8n-live-handoff-commands.cjs --write
node scripts\write-zielmodus-4-live-completion-checklist.cjs --write
node scripts\validate-zielmodus-4-readiness.cjs --write

node scripts\write-n8n-runtime-readiness-status.cjs --check
node scripts\write-n8n-live-readiness-preflight.cjs --check
node scripts\write-n8n-live-handoff-commands.cjs --check
node scripts\write-zielmodus-4-live-completion-checklist.cjs --check
node scripts\validate-zielmodus-4-readiness.cjs --require-live-probes
node scripts\check-zielmodus-4-public-safe.cjs
node scripts\pages-smoke-check.cjs frontend
```

## 6. Commit, Deploy, Verify

```powershell
git status --short
git add frontend\assets\n8n-live-probe-evidence.json frontend\assets\n8n-live-readiness-preflight.json frontend\assets\n8n-live-handoff-commands.json frontend\assets\zielmodus-4-live-completion-checklist.json frontend\assets\zielmodus-4-readiness-status.json
git commit -m "Record live n8n probe evidence"
git push origin main
```

Then verify GitHub Pages:

```powershell
gh run list --repo florianliepe/meids-app --branch main --limit 3
gh run watch <RUN_ID> --repo florianliepe/meids-app --exit-status
node scripts\pages-smoke-check.cjs https://florianliepe.github.io/meids-app/
```

## Done Criteria

Zielmodus 4 can be closed only when:

- embedded Actor Twin chat is configured and published;
- Actor Twin live trace evidence exists for direct answer, Knowledge Fabric route, Butler route, and skill/agent proposal route;
- Agentic Butler work-artifact probe returns `completed`;
- `node scripts\validate-zielmodus-4-readiness.cjs --require-live-probes` exits `0`;
- GitHub Pages deploy succeeds;
- deployed Production/Review Cockpit shows all three agents as live-evidence ready or internal-tool ready.
