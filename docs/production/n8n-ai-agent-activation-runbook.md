# n8n AI Agent Activation Runbook

Purpose: move the three MeIDs n8n workflows from contract/staging responders to verified AI-agent workflows without weakening approval, trace, or OKF governance boundaries.

## Scope

Top-level agents:

| Agent | Live workflow role | Required AI logic |
| --- | --- | --- |
| Actor Twin | Primary UI, intent router, answer and decision instance | Interpret intent, retrieve approved-first context, decide answer-only versus Agentic Butler or Knowledge Fabric delegation |
| Knowledge Fabric Agent | Background knowledge ingest and OKF curation | Convert uploads/transcripts into pending OKF candidates, evidence, CRUD entries, candidate graph relations, and vector refresh decisions |
| Agentic Butler | Work execution and skill activation | Validate approved skills, run internal Skill Orchestrator, coordinate task agents, and stop at human approval gates |

## Required Live Workflow Shape

Each live n8n workflow must follow this active path:

1. Receive request.
2. Validate envelope.
3. Run AI Agent node with the correct system instruction.
4. Normalize the AI output into `contracts/n8n/schemas/agent-response.schema.json`.
5. Return JSON.
6. Preserve trace id / execution id for cockpit evidence.

The response normalizer must stay after the AI Agent. The promoted workflow artifacts use `Contract response normalizer`; it must consume real AI Agent output and return it inside the contract envelope.

## Verification Gates

| Gate | Pass condition |
| --- | --- |
| AI Agent node present | Workflow canvas contains the expected AI Agent node on the active request path |
| Model attached | AI Agent has a connected chat model credential |
| System instruction set | Agent prompt describes role, boundaries, approval gates, and output contract |
| Adapter valid | Response matches `contracts/n8n/schemas/agent-response.schema.json` |
| No-write probe | Public-safe live probe returns no side effects |
| Trace recorded | Response contains a non-demo trace/execution id |
| Approval preserved | Agentic Butler returns `approval_required` before external actions |

## Current Evidence Boundary

`frontend/assets/n8n-ai-agent-readiness-status.json` is public-safe and separates:

- repo blueprint readiness
- runtime URL readiness
- live probe evidence
- AI-agent execution claims
- manual live workflow verification requirement

This file does not call n8n and does not prove the live workflow canvas by itself.

## Commands

Regenerate status:

```powershell
node scripts\write-n8n-ai-agent-readiness-status.cjs
```

Check status:

```powershell
node scripts\write-n8n-ai-agent-readiness-status.cjs --check
```

Run full public-safe gate:

```powershell
node scripts\check-zielmodus-4-public-safe.cjs
```

## Production Rule

Do not treat `URL configured` or `n8n connected` as equivalent to `AI logic active`.

Production trust requires verified AI Agent nodes in the live workflow plus adapter-valid responses and recorded trace evidence.
