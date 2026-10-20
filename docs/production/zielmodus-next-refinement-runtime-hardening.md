# Zielmodus: Next Runtime Refinement

Date: 2026-09-07

## Objective

Move from "seven agents connected" to robust and performant agent interaction:
Learning Agent runs post-turn by default, nested workflow tools return bounded
fallbacks, Knowledge Fabric duplicate/merge checks use real vector/graph scores,
and Skill Orchestrator/Task Agent runtime health is measured with fresh samples.

## Clarification Assumption

Proceed with the current target architecture:

- Actor Twin is the only user-facing chat.
- All other agents are n8n workflow-tool subagents.
- Repo/API-safe changes can be executed immediately.
- n8n UI-only publication or topology changes must be verified in n8n after
  source/API patches are applied.

## Package 1: Publish Learning Agent Post-Turn Routing

Target:

- Routine learning does not block Actor Twin chat.
- Actor Twin answers first, then emits `trace_learning_recommended` for a
  detached/post-turn Learning Agent job.

Execution:

1. Patch Actor Twin instructions:
   - Do not call Learning Agent inline for routine trace learning.
   - Emit post-turn trace-learning recommendation instead.
2. Patch Learning Agent instructions:
   - Assume it normally runs after Actor Twin has answered.
   - If invoked inline, produce only a compact handoff summary.
3. n8n publication step:
   - Preferred: add a post-answer branch or separate Execute Workflow trigger
     that consumes trace records and calls Learning Agent asynchronously.
   - Interim: keep Learning Agent tool available but route it only for explicit
     inline learning requests.

Acceptance:

- Low-risk Actor Twin turns do not call Learning Agent inline.
- Learning output still lands in Knowledge Fabric as `review_needed` or
  `updated_review_needed`.

## Package 2: Node-Level Timeout/Fallback Summaries

Target:

- No nested n8n workflow-tool call leaves the frontend waiting without a final
  bounded answer.

Execution:

1. Backend proxy already has timeout fallback through `N8N_AGENT_TIMEOUT_MS`.
2. Patch live n8n agent/tool instructions:
   - nested failures must return partial result, failed step, likely cause, and
     recovery action.
   - no approval gate for no-write drafts or internal skill execution.
3. n8n publication step:
   - Add node-level timeout/error branches where n8n node settings support it.
   - Remove `continueOnFail` only where a normalized fallback branch exists.

Acceptance:

- Failed nested calls return contract-shaped summaries.
- Actor Twin final output remains user-facing, not raw JSON or stack traces.

## Package 3: Knowledge Fabric Duplicate/Merge With Real Scores

Target:

- Knowledge Fabric does not invent duplicate decisions.
- Duplicate/merge decisions are backed by vector, graph, alias, source, and
  scope evidence.

Execution:

1. Patch Knowledge Fabric instructions with explicit score criteria:
   - `strong_duplicate`: vector >= 0.88 or exact alias/title match plus
     compatible scope.
   - `near_match`: vector 0.72-0.87, shared graph neighborhood, or overlapping
     purpose with material differences.
   - `related_only`: vector 0.55-0.71 or graph proximity without scope overlap.
   - `insufficient_evidence`: no real retrieval evidence available.
2. n8n publication step:
   - Wire Knowledge Fabric to actual vector retrieval and graph lookup before
     concept creation.
   - Pass scores into the AI Agent input.
   - Route ambiguous near-matches to Critical Faculty.

Acceptance:

- Knowledge Fabric returns `duplicate_check.status`, score evidence, and
  `merge_candidates`.
- Without scores, it returns `evidence_pending`, not a fabricated merge outcome.

## Package 4: Fresh Skill Orchestrator/Task Agent Samples

Target:

- Production SLOs are based on fresh executions, not migration history.

Execution:

1. Run live Actor Twin prompts that force:
   - Agentic Butler;
   - Skill Orchestrator;
   - one Task Agent call;
   - no approval gate.
2. Record evidence:
   - `npm run probe:agents:live -- --since <ISO timestamp>`
   - `npm run audit:agents -- --agent skill_orchestrator --since <ISO timestamp>`
   - `npm run audit:agents -- --agent task_agent --since <ISO timestamp>`

Acceptance:

- At least two fresh successful Skill Orchestrator samples.
- At least two fresh successful Task Agent samples.
- Preliminary UAT runtime target: Task Agent under 15s p90, Skill Orchestrator
  under 45s p90 for compact no-write tasks.

## Package 5: Modularization Readiness Gate

Do not start modularization until runtime behavior is stable.

Readiness criteria:

- Seven-agent live probe evidence is green.
- Learning Agent no longer blocks routine Actor Twin answers.
- Timeout/fallback contract is present at backend and n8n levels.
- Knowledge Fabric duplicate/merge has real score evidence.
- Skill Orchestrator and Task Agent have enough fresh samples for an initial
  SLO decision.

Then modularize in this order:

1. `frontend/app.js`
2. `frontend/styles.css`
3. `backend/server.js`

## Execution Commands

```powershell
$env:N8N_API_BASE_URL=[Environment]::GetEnvironmentVariable('N8N_API_BASE_URL','User')
$env:N8N_API_KEY=[Environment]::GetEnvironmentVariable('N8N_API_KEY','User')
npm run n8n:refinement:apply
npm run check:backend
npm run check:agents
npm run probe:agents:live -- --since 2026-09-07T00:00:00.000Z
npm run audit:agents -- --since 2026-09-07T00:00:00.000Z
node scripts/build-pages-static.cjs --output dist-pages-check-next-refinement
```

## Remaining Manual n8n Work

- Implement true detached/post-turn Learning Agent branch if not already present.
- Add node-level timeout/error fallback branches around workflow tools where n8n
  supports them.
- Wire Knowledge Fabric to actual vector and graph retrieval nodes before
  concept creation.
- Publish the updated workflows after API patching if the instance requires
  manual publish.

## Execution Result - 2026-09-07

Executed:

- Source prompt guardrails updated for Actor Twin, Learning Agent, and Knowledge
  Fabric.
- Live n8n guardrails applied with `npm run n8n:refinement:apply`.
- Backup written to:
  `exports/n8n-live-backups/20260907T193412Z-next-refinement-guardrails`.
- Two additional live Skill Orchestrator/Task Agent SLO probes executed through
  Actor Twin -> Agentic Butler -> Skill Orchestrator -> Task Agent.
- Seven-agent live probe evidence remains complete:
  `docs/uat/n8n-seven-agent-live-probe-evidence.json`.

Fresh runtime evidence:

| Agent | Fresh samples | Success | Failures | p90 |
|---|---:|---:|---:|---:|
| Skill Orchestrator | 3 | 3 | 0 | 26.7s |
| Task Agent | 3 | 3 | 0 | 10.9s |

Validation:

- `npm run check:backend` passed.
- `npm run check:agents` passed.
- `node scripts/build-pages-static.cjs --output dist-pages-check-next-refinement`
  passed.

Boundary still open:

- True detached/post-turn Learning Agent execution still needs n8n topology work
  if the current workflow does not already have a post-answer branch.
- Knowledge Fabric now has score-backed merge criteria, but production-quality
  duplicate/merge behavior still requires real vector and graph scores in the
  workflow input.
- Modularization remains intentionally deferred until the above runtime
  behaviors are stable.
