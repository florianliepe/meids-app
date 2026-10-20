# Zielmodus: Remaining Boundary Solving Path

Date: 2026-09-07

## Objective

Close the three remaining runtime boundaries before modularizing the codebase:

1. Learning Agent must run detached/post-turn for normal trace learning.
2. Knowledge Fabric duplicate/merge decisions must use real vector/graph scores.
3. Frontend/backend modularization starts only after the runtime paths are
   stable.

## Clarification Assumption

Proceed with the current architecture:

- Actor Twin remains the only user-facing chat.
- n8n remains the agent interaction layer.
- Backend provides runtime support endpoints for durable dispatch, scoring, and
  fallback behavior.
- Knowledge Fabric keeps creating/updating OKF concepts automatically, but only
  into review states.

## Solution A: Detached/Post-Turn Learning Agent

Problem:

- If Actor Twin calls Learning Agent as a synchronous n8n workflow tool, normal
  chat turns can block for learning synthesis.

Target:

- Actor Twin answers first.
- Learning is dispatched after the answer via a backend or n8n post-turn path.

Implementation path:

1. Add Learning Agent dispatch webhook to the Learning Agent workflow:
   `POST /webhook/meids/learning/dispatch`.
2. Add backend fire-and-forget endpoint:
   `POST /api/learning/post-turn`.
3. Actor Twin returns `trace_learning_recommended` in normal answers when a
   reusable lesson exists.
4. A post-turn runner calls `/api/learning/post-turn` with:
   - trace id;
   - source interaction summary;
   - reusable lesson candidate;
   - target review state.
5. Learning Agent stages outputs into Knowledge Fabric as `review_needed` or
   `updated_review_needed`.

Acceptance:

- Routine Actor Twin answers do not invoke Learning Agent inline.
- Post-turn dispatch returns HTTP 202.
- Learning Agent execution appears as a separate n8n run.
- Knowledge Fabric receives learning output only as review-needed material.

## Solution B: Score-Backed Knowledge Fabric Duplicate/Merge

Problem:

- Prompt rules alone cannot prove whether a concept is duplicate, near-match,
  related-only, or new.

Target:

- Knowledge Fabric receives a score package before deciding concept creation or
  update state.

Implementation path:

1. Backend exposes:
   `POST /api/knowledge/duplicate-check`.
2. Request body contains candidate concept data:
   - title/name;
   - aliases;
   - purpose;
   - summary/text;
   - twin id;
   - organization id;
   - graph node/cluster ids if known.
3. Backend performs Azure AI Search retrieval with approved + working knowledge.
4. Backend packages score evidence:
   - vector similarity;
   - lexical alias/title overlap;
   - graph proximity/cluster match;
   - scope compatibility;
   - merge candidates.
5. Knowledge Fabric uses thresholds:
   - `strong_duplicate`: vector >= 0.88 or exact alias/title match plus
     compatible scope.
   - `near_match`: vector 0.72-0.87, shared graph neighborhood, or overlapping
     purpose with material differences.
   - `related_only`: vector 0.55-0.71 or graph proximity without scope overlap.
   - `insufficient_evidence`: no vector/graph/alias evidence available.

Acceptance:

- Knowledge Fabric receives `duplicate_score_evidence` before concept creation.
- If scores are unavailable, output is `evidence_pending`.
- Near matches become `updated_review_needed`.
- No trusted merge or vector refresh happens automatically.

## Solution C: Modularization Gate

Problem:

- Large files should be split, but doing it before runtime paths stabilize
  increases regression risk.

Gate before modularization:

- Seven-agent live probe remains green.
- Actor Twin low-risk answers do not block on Learning Agent.
- `/api/learning/post-turn` exists and dispatches post-turn learning.
- `/api/knowledge/duplicate-check` exists and returns score-backed evidence or
  `insufficient_evidence`.
- Skill Orchestrator and Task Agent have at least three fresh passing samples.
- Backend/agent/static checks pass.

Then modularize in order:

1. Extract backend n8n/learning/vector/knowledge route adapters from
   `backend/server.js`.
2. Extract frontend n8n embedded chat/runtime setup from `frontend/app.js`.
3. Extract twin profile, knowledge cockpit, trace cockpit, voice capture, and
   local staging modules.
4. Split `frontend/styles.css` by layout/components/forms/cockpit/chat.

## Executed Changes

Repository/API-safe changes in this package:

- Backend endpoint: `POST /api/learning/post-turn`.
- Backend endpoint: `POST /api/knowledge/duplicate-check`.
- n8n patch script:
  `scripts/apply-n8n-boundary-solving-path.cjs`.
- npm script:
  `npm run n8n:boundaries:apply`.
- Learning Agent workflow receives post-turn dispatch webhook:
  `meids/learning/dispatch`.
- Knowledge Fabric workflow receives explicit duplicate-score input contract.

## Execution Commands

```powershell
$env:N8N_API_BASE_URL=[Environment]::GetEnvironmentVariable('N8N_API_BASE_URL','User')
$env:N8N_API_KEY=[Environment]::GetEnvironmentVariable('N8N_API_KEY','User')
npm run n8n:boundaries:apply
npm run check:backend
npm run check:agents
npm run probe:agents:live -- --since 2026-09-07T00:00:00.000Z
node scripts/build-pages-static.cjs --output dist-pages-check-boundary-solving
```

## Remaining n8n Wiring

Still verify in n8n editor/executions:

- The `meids/learning/dispatch` webhook is published and returns immediately.
- A post-turn runner actually calls `/api/learning/post-turn` after an Actor Twin
  answer containing `trace_learning_recommended`.
- Knowledge Fabric has an HTTP/vector/graph scoring step before the AI Agent and
  passes the result as `duplicate_score_evidence`.

## Execution Result - 2026-09-07

Applied:

- Backend `POST /api/learning/post-turn`.
- Backend `POST /api/knowledge/duplicate-check`.
- Live n8n Learning Agent webhook entrypoint:
  `POST /webhook/meids/learning/dispatch`.
- Live Knowledge Fabric duplicate-score input contract.
- npm script: `npm run n8n:boundaries:apply`.

Live n8n backup:

- `exports/n8n-live-backups/20260907T200546Z-boundary-solving-path`

Endpoint probes:

- `POST /api/learning/post-turn` returned `202 accepted` on local backend.
- Direct n8n `POST /webhook/meids/learning/dispatch` returned successfully.
- `POST /api/knowledge/duplicate-check` returned
  `duplicate_check.status=insufficient_evidence` because local Azure AI Search
  secrets were not configured. This is the intended safe fallback.

Validation:

- `npm run check:backend` passed.
- `npm run check:agents` passed.
- `npm run probe:agents:live -- --since 2026-09-07T00:00:00.000Z` passed with
  7/7 fresh connected.
- `node scripts/build-pages-static.cjs --output dist-pages-check-boundary-solving`
  passed.

Next unresolved runtime step:

- Wire the Knowledge Fabric n8n workflow to call the hosted backend
  `/api/knowledge/duplicate-check` before the AI Agent node and pass the returned
  object as `duplicate_score_evidence`.
- Add the actual post-turn caller: either backend trace-store event hook,
  scheduled n8n trace poller, or frontend callback if the embedded chat wrapper
  exposes completed-message events.

## Zielmodus Priority Plan - 2026-09-08

Priority 1: Knowledge Fabric duplicate scoring topology.

- Insert `Score duplicate and merge evidence` before `Knowledge Fabric AI Agent`.
- Call hosted backend `POST /api/knowledge/duplicate-check`.
- Pass the response into `Attach duplicate score evidence`.
- Ensure the AI Agent receives `duplicate_score_evidence`.
- n8n must have `MEIDS_BACKEND_URL` configured to the hosted Me.IDs backend
  origin, not GitHub Pages.

Priority 2: Post-answer Learning Agent trigger.

- Backend trace persistence now queues post-turn learning when a stored trace
  contains `trace_learning_recommended`.
- The dispatch stays fire-and-forget and does not block the user-facing answer.
- Disable with `MEIDS_POST_TURN_LEARNING_ENABLED=false` if needed.
- Direct embedded n8n chat still needs an n8n-side post-answer branch if it
  bypasses the backend proxy.

Priority 3: Modularization readiness gate.

- Keep `frontend/app.js`, `frontend/styles.css`, and `backend/server.js`
  modularization deferred until:
  - Knowledge Fabric scoring executes successfully in live n8n;
  - Learning Agent post-turn dispatch is visible as a separate execution;
  - seven-agent probe remains green;
  - backend and agent checks pass.

## Execution Result - 2026-09-08

Applied:

- Backend trace persistence now dispatches Learning Agent post-turn work after
  storing traces with `trace_learning_recommended`.
- n8n boundary patch script now creates the Knowledge Fabric scoring topology:
  `Receive request/workflow call -> Score duplicate and merge evidence -> Attach
  duplicate score evidence -> Knowledge Fabric AI Agent`.
- Local Knowledge Fabric workflow JSON is aligned with the same topology.
- Live Learning Agent and Knowledge Fabric workflows were republished through
  the n8n API using PowerShell after Node `fetch` failed against the API path.

Required live setting:

- `MEIDS_BACKEND_URL` must be available at publish time and point to the hosted
  backend that exposes `/api/knowledge/duplicate-check`.
- The current n8n runtime blocks `$env` access inside node expressions
  (`N8N_BLOCK_ENV_ACCESS_IN_NODE`), so workflow nodes cannot read
  `$env.MEIDS_BACKEND_URL` directly. The publish script materializes a static
  backend URL when the env var is present locally.

Known boundary:

- If the frontend embeds n8n chat directly and does not call the backend proxy,
  backend trace hooks cannot observe chat completion. In that mode, add a
  post-answer n8n branch or trace poller that calls `/api/learning/post-turn`.
- Because no hosted backend URL was configured locally during this run, the live
  Knowledge Fabric workflow was repaired in fallback mode:
  `duplicate_check.status=insufficient_evidence`. This keeps UAT functional but
  does not yet provide real vector/graph-backed duplicate decisions.

Validation:

- `npm run check:backend` passed.
- `npm run check:agents` passed.
- `node scripts/build-pages-static.cjs --output dist-pages-check-boundary-20260908`
  passed.
- Knowledge Fabric live UAT returned HTTP 200 with
  `duplicate_score_evidence` fallback and `evidence_pending` reasoning.
- Direct `POST /api/learning/post-turn` returned `202 accepted` and created
  Learning Agent n8n execution `19798`.
- Backend trace hook stored a trace with `trace_learning_recommended` and created
  detached Learning Agent n8n execution `19799`.

Next action to get real duplicate/merge scoring:

1. Deploy or identify the hosted Me.IDs backend origin.
2. Set local `MEIDS_BACKEND_URL` to that backend origin.
3. Rerun `npm run n8n:boundaries:apply`.
4. Verify Knowledge Fabric execution shows `Score duplicate and merge evidence`
   as an HTTP node returning real vector/graph score evidence.
