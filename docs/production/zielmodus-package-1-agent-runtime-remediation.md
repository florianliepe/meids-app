# Zielmodus Package 1A: Agent Runtime Remediation

## Scope

Close the current n8n agent-interaction blockers before continuing with backend persistence, Azure vector activation, or broader cockpit work.

This package assumes the target runtime pattern is:

- Actor Twin is the only user-facing chat authority.
- Actor Twin calls Knowledge Fabric Agent and Agentic Butler through n8n workflow tools.
- Knowledge Fabric Agent and Agentic Butler run autonomously when delegated by Actor Twin.
- Human approval is required only for generated capability activation or real external side effects.

## Clarification Baseline

Proceed with these assumptions unless the operator explicitly changes them:

- Normal Agentic Butler work artifacts, including email drafts, meeting briefs, planning notes, summaries, and no-write skill execution, must not enter an approval loop.
- New skill, new agent, subagent, or task-agent activation must return a proposal and wait for human approval.
- Knowledge Fabric may automatically create or update OKF concepts, but new or changed concepts enter Knowledge/Review as `review_needed`, `updated`, or `candidate`.
- Actor Twin chat must render concise user-facing answers and artifacts, not raw workflow JSON.
- Detailed approval objects, traces, and route diagnostics belong in Review/Trace cockpit surfaces, not the lean Actor Twin chat surface.

## Ziel 1: Remove the Normal Butler Approval Loop

Objective: Agentic Butler completes no-write delegated work without human approval.

Change points in n8n:

1. In the Agentic Butler AI Agent system message, keep this boundary:
   - no approval for Actor Twin delegated no-write work artifacts
   - approval only for generated skill/agent/task-agent/subagent activation
   - approval for external send, schedule, publish, delete, commit, or other side effects only when those actions are actually executed
2. In the Agentic Butler contract response normalizer, compute `approval_required` from action semantics, not from the fact that Butler was called.
3. Remove or bypass any IF/Switch branch that sends every Butler invocation to an approval response.
4. Ensure `resume_after_approval` is used only after a real approval object has been created.

Expected UAT:

- Prompt: `draft an email to the dev team for a planning workshop`
- Expected: Actor Twin delegates to Agentic Butler, Butler returns `completed`, `approval_required: false`, and the frontend shows the email draft as a readable artifact.

## Ziel 2: Stabilize the Frontend Workflow Contract

Objective: Every n8n workflow response is consumable by the frontend without raw JSON leakage.

Required response contract:

```json
{
  "status": "completed",
  "agent_id": "actor_twin",
  "visible_state": "answered",
  "approval_required": false,
  "answer": "User-facing answer text.",
  "output": {},
  "trace_summary": {
    "steps": [],
    "called_agents": [],
    "next_suggested_action": ""
  },
  "citations": []
}
```

Allowed `status` values:

- `completed`
- `approval_required`
- `failed`

Allowed approval behavior:

- `approval_required: false` for direct answers, Knowledge Fabric retrieval/ingest, and Butler no-write artifacts.
- `approval_required: true` only when `status: "approval_required"` and an approval object exists.

Expected UAT:

- `who are you` returns a direct Actor Twin answer.
- `what do we know about this topic` returns or requests Knowledge Fabric context.
- `save this as knowledge` creates or updates OKF candidate material.
- `create a new skill for recurring backlog prioritization` returns a proposal and approval card.

## Ziel 3: Keep CI Advisory Until Live n8n Is Aligned

Objective: Keep GitHub Pages deployable while n8n live workflows are being manually aligned, then restore strict validation when live UAT passes.

Current advisory gate:

- File: `.github/workflows/intellectual-twin-pages.yml`
- Step: `Validate Chat live n8n UAT artifact`
- Temporary line: `continue-on-error: true`

Do not remove this line until:

1. Actor Twin embedded n8n chat is published.
2. Actor Twin has workflow tools connected to Knowledge Fabric Agent and Agentic Butler.
3. Knowledge Fabric workflow returns the stable frontend contract.
4. Agentic Butler workflow returns:
   - `completed` for no-write work artifacts
   - `approval_required` only for generated capability proposals or real external side effects
5. `npm run uat:agents:live` passes against `docs/uat/agent-interaction-uat-results.json`.

After those conditions pass, remove `continue-on-error: true` from the live n8n validation step and run the full Pages workflow as a strict gate.

## Recommended Next Step

Update the live Actor Twin workflow-tool descriptions and routing prompt first.

Reason:

- Actor Twin direct answer works.
- Agentic Butler no-write work artifacts now pass live UAT without approval.
- The remaining user-visible blockers are Actor Twin not selecting Knowledge Fabric for ingest and create-skill calls timing out or failing to normalize through the Butler proposal path.

Execution order:

1. Patch Actor Twin Knowledge Fabric and Agentic Butler workflow-tool descriptions in n8n.
2. Patch Actor Twin system message with the stronger routing criteria from `prompts/actor-twin/system.md`.
3. Run Knowledge Fabric ingest through the embedded Actor Twin chat.
4. Run create-skill through the embedded Actor Twin chat and confirm Butler returns one proposal approval.
5. Record UAT result in `docs/uat/agent-interaction-uat-results.json`.
6. Run `npm run check:agents`.
7. Run `npm run uat:agents:live`.
8. Remove the advisory CI gate only after live UAT passes.

## Execution Result: 2026-09-02

Local validation executed:

- `npm run check:agents` passed.
- `node --check frontend/app.js` passed.

Live UAT executed:

- `npm run uat:agents:live` failed with 2/4 passing cases.
- Evidence file: `docs/uat/agent-interaction-uat-results.json`

Passing:

- Actor Twin direct answer.
- Agentic Butler no-write email draft; this confirms the normal Butler approval loop is no longer reproduced by the current live path.

Failing:

- Knowledge Fabric ingest prompt was answered by Actor Twin instead of routed as `ingest_or_stage_knowledge` to `knowledge_fabric_agent`.
- Create-skill prompt timed out and normalized as Actor Twin/direct instead of returning an Agentic Butler `approval_required` skill proposal.

Revised next step:

1. Patch the live Actor Twin n8n workflow routing prompt/tool descriptions so explicit knowledge-ingest language calls Knowledge Fabric Agent.
2. Patch the live Actor Twin n8n workflow so explicit new-skill/new-agent creation calls Agentic Butler and waits for a proposal response.
3. Keep Agentic Butler normal work semantics as-is, because the live email-draft UAT passed.
4. Investigate create-skill timeout in the Agentic Butler subworkflow: the likely causes are missing proposal-only short path, long generation prompt, unavailable downstream tool, or workflow response not returned by the final normalizer.
5. Rerun `npm run uat:agents:live` before removing the advisory CI gate.

## Definition of Done

- Actor Twin direct answer works.
- Knowledge Fabric delegated call works.
- Agentic Butler no-write work artifact works without approval.
- Agentic Butler create-skill proposal requires approval and can resume after approval.
- Frontend displays answers/artifacts cleanly.
- Live n8n UAT is strict again in CI.
