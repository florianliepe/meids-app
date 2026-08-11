# n8n Live Readiness Operator Checklist

Date: 2026-08-11

Purpose: one copy-paste checklist to close the remaining Zielmodus 4 live integration gate after the missing n8n UAT URLs exist.

Boundary: public-safe. Do not commit API keys, bearer tokens, private knowledge, or secret-bearing URLs.

## What Is Left

| Agent | Current open item | Required result |
| --- | --- | --- |
| Actor Twin | Record non-demo live probe evidence | `completed` response with n8n trace id |
| Knowledge Fabric Agent | Configure live URL, then record probe evidence | `completed` no-write ingest probe |
| Agentic Butler | Configure live URL, then record probe evidence | `approval_required` skill activation probe |

Expected remaining time after both missing URLs exist: **45-90 minutes** including configuration, probes, artifact refresh, commit, deploy, and GitHub Pages verification.

## 1. Configure Public UAT URLs

Use repository secrets for durable GitHub Pages deployment:

- `GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL`
- `GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL`
- `GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL`

For local public UAT only, use:

```powershell
node scripts\set-n8n-agent-url.cjs --agent knowledge_fabric_agent --url "https://YOUR-N8N-HOST/webhook/YOUR-KNOWLEDGE-FABRIC-UAT-PATH"
node scripts\set-n8n-agent-url.cjs --agent agentic_butler --url "https://YOUR-N8N-HOST/webhook/YOUR-AGENTIC-BUTLER-UAT-PATH"
```

Rules:

- URL must use `https`.
- URL path must include `/webhook/`.
- URL must not contain tokens, API keys, passwords, or bearer credentials.

## 2. Refresh URL Readiness

```powershell
node scripts\write-n8n-runtime-readiness-status.cjs --check
node scripts\write-n8n-live-readiness-preflight.cjs --check
node scripts\write-zielmodus-4-live-completion-checklist.cjs --check
node scripts\write-n8n-live-handoff-commands.cjs --check
node scripts\validate-zielmodus-4-readiness.cjs --require-live
```

If `--require-live` fails, fix the missing URL slot first. Do not continue to probe evidence until all three URLs are configured.

## 3. Run No-Write / Approval-Safe Live Probes

Use the committed probe payloads:

- `frontend/assets/n8n-live-probes/actor-twin.json`
- `frontend/assets/n8n-live-probes/knowledge-fabric-agent.json`
- `frontend/assets/n8n-live-probes/agentic-butler.json`

Expected outcomes:

| Agent | Expected response status | Safety condition |
| --- | --- | --- |
| Actor Twin | `completed` | Answer-only request, no external action |
| Knowledge Fabric Agent | `completed` | No-write ingest probe or pending-only draft behavior |
| Agentic Butler | `approval_required` | Must stop before email, calendar, meeting, or external commitment |

## 4. Record Public-Safe Trace Evidence

Replace placeholders with the real n8n execution trace id and public-safe execution URL.

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
  --url-source github-pages-secret

node scripts\record-n8n-live-probe-evidence.cjs `
  --agent agentic_butler `
  --trace-id "TRACE_ID_FROM_N8N" `
  --execution-url "https://YOUR-N8N-HOST/workflow/.../executions/..." `
  --response-status approval_required `
  --url-source github-pages-secret
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

- all three live URL slots are configured;
- all three live probes have non-demo trace evidence;
- Agentic Butler probe returns `approval_required`;
- `node scripts\validate-zielmodus-4-readiness.cjs --require-live-probes` exits `0`;
- GitHub Pages deploy succeeds;
- deployed Production/Review Cockpit shows all three agents as live-evidence ready.
