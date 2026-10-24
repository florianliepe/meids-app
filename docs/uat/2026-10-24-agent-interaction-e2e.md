# Agent Interaction End-to-End UAT

Date: 2026-10-24  
Environment: Azure Static Web App, Azure App Service backend, shared n8n UAT  
Test twin: `codex-platform-uat-20261022`  
Data policy: synthetic data only; generated knowledge remains `review_needed`

## Zielmode

1. Inventory routing, workflow IDs, publication state, credentials, and response contracts.
2. Exercise retrieval, retention, learning, critical review, tacit-knowledge elicitation, and skill execution through Actor Twin.
3. Reproduce defects with fresh n8n executions and preserve execution IDs.
4. Fix contract, context, routing, and frontend concurrency defects without restarting the shared n8n service.
5. Republish in dependency order and repeat live probes.
6. Keep Actor Twin as the only user-facing agent and keep subagents behind `Call n8n Workflow Tool`.

## Potential Agent-Interaction Errors

| Risk | Expected control |
|---|---|
| Route misclassification | Explicit routing criteria and negative tests |
| Stale or wrong workflow ID | Discover bindings from the live Actor workflow; validate canonical exports |
| Published definition differs from executed snapshot | Compare execution `workflowData` with active workflow; roll forward to a new ID when cache invalidation fails |
| Tenant, user, twin, or token context is lost | Typed workflow inputs and execution-level assertions |
| Agent response violates the frontend contract | Contract normalizers with tolerant JSON parsing and bounded fallback |
| Evidence-dependent task hallucinates facts | Retrieve first; block Butler, Skill Orchestrator, and Task Agent on `not_found` or insufficient evidence |
| Nested tool call times out or fails | Bounded runtime, concise fallback, and no hidden approval loop |
| Approval gate blocks normal no-write work | Gate only new capability activation and external side effects |
| Retrieval accidentally writes knowledge | Operation defaults to `retrieve`; only explicit `stage` reaches persistence |
| Post-answer branch replaces the visible answer | Preserve Actor answer and run learning asynchronously |
| Concurrent chat turn is dropped | Disable input while n8n displays its typing state |
| Learning runs on ordinary answers | Emit post-turn learning only from explicit user-side reusable-learning signals |
| Learning loses trace evidence | Include trace context in the model prompt and preserve trace IDs in evidence refs |
| Duplicate scoring is unavailable | Use the hosted score endpoint; fail closed with no merge when unavailable |
| Retries create duplicate writes | Keep all writes in `review_needed`; use duplicate scoring and idempotent request IDs |
| Cross-user or cross-twin leakage | Signed scoped token, PostgreSQL RLS, and Search filters |
| Prompt injection in ingested sources | Treat source text as evidence, never as system instructions |
| Secrets appear in prompts or traces | Omit authorization credentials from model context and persisted trace records |
| Latency or token fan-out grows unchecked | One Task Agent by default, detached learning, and agent-chain budgets |

## End-to-End Results

| Use case | Route | Evidence | Result |
|---|---|---|---|
| Active-twin propagation | Frontend -> Actor Twin | Actor `34687` | Pass: `codex-platform-uat-20261022` reached n8n metadata after chat recreation |
| Read-only missing knowledge | Actor -> Knowledge Fabric | Actor `34679`, KFA `34680` | Pass: `not_found`, no candidate created |
| Critical decision review | Actor -> Critical Faculty | Actor `34689`, Critical Faculty `34690` | Pass: `PAUSE` for decision without evidence |
| Tacit-knowledge elicitation | Actor -> Butler -> Knowledge Retrieval Interviewer | Actor `34682`, Butler `34683`, Interviewer `34684` | Pass: one focused deep-dive question |
| Skill chain before hardening | Actor -> Butler -> Skill Orchestrator -> Task Agent | `34691`, `34693`, `34694`, `34695` | Fail reproduced: invented Module Zeta and Service Nova |
| Grounded skill chain after hardening | Actor -> Knowledge Fabric, then stop | Actor `34698`, KFA `34699` | Pass: `not_found`; no Butler or Task Agent call; no invented facts |
| Busy-state concurrency | Frontend -> n8n chat | Browser UAT | Pass: textarea disabled with `Actor Twin is working...` while request was active |
| Detached learning context | Backend -> Learning -> Knowledge Fabric | Learning `34712`, KFA v4 `34713` | Pass: correct tenant/user/twin, signed token, structured concept, trace evidence, `review_needed` persistence |
| Real duplicate scoring | Knowledge Fabric v4 -> hosted backend/Search | KFA v4 `34713` | Pass: HTTP node, `azure_ai_search`, `hybrid_vector_semantic`; no fallback node |
| Ordinary retrieval after learning filter | Actor -> Knowledge Fabric v4 | Actor `34739` | Pass: 6.6 s retrieval; no subsequent Learning execution |

## Defects And Fixes

| ID | Severity | Defect | Resolution |
|---|---|---|---|
| AGENT-001 | P1 | Selected frontend twin and n8n chat metadata diverged after a twin switch | Recreate embedded chat on twin activation/change |
| AGENT-002 | P1 | A second message could be entered while n8n was busy and silently disappear | Added DOM-observed busy guard and disabled textarea |
| AGENT-003 | P0 | Evidence-dependent Task Agent invented plausible entities and metrics | Added evidence-first guardrails to Actor, Butler, Skill Orchestrator, and Task Agent; remove duplicate disconnected Task node |
| AGENT-004 | P0 | Learning -> Knowledge Fabric lost token and twin scope | Added typed identity/auth propagation and normalized inline/post-turn context |
| AGENT-005 | P1 | Backend post-turn trace omitted usable interaction content | Pass bounded input/output summaries plus transient auth context |
| AGENT-006 | P0 | Learning JSON could be stored as a long title instead of a structured concept | Added tolerant parsing, keyed-object recovery, and learning-document mapping |
| AGENT-007 | P1 | Learning output omitted an available trace ID | Include sanitized full trace context in the Learning prompt and require reference fidelity |
| AGENT-008 | P0 | n8n executed an old Knowledge Fabric snapshot after successful publication | Rolled forward to Knowledge Fabric v4 (`dUkrCHpkLmqmFc7I`) and rebound Actor and Learning; v3 remains as rollback |
| AGENT-009 | P1 | Duplicate scoring stayed on guarded fallback | v4 executes the authenticated backend HTTP scorer; confirmed in execution `34713` |
| AGENT-010 | P1 | Actor answer text containing `interview` triggered unnecessary post-turn learning | Learning signal now evaluates user input only; normal retrieval `34739` produced no Learning run |
| AGENT-011 | P2 | Post-answer API reported `queued` even when learning was not recommended | Backend now returns `not_recommended`; deployment follows repository push |
| AGENT-012 | P2 | Existing chat sessions without current metadata can call Knowledge Fabric without a token | New/reloaded chats are correct; stale sessions must reconnect. The knowledge endpoint remains fail-closed |

## Decision Log

1. **Actor Twin remains the sole user-facing agent.** Specialist agents stay internal workflow tools.
2. **Evidence-first execution is a hard boundary.** Missing evidence stops execution; synthetic content is allowed only when explicitly requested and visibly labeled.
3. **No shared n8n restart.** The stale subworkflow snapshot was remediated by a new Knowledge Fabric workflow ID and caller rebinding.
4. **The old Knowledge Fabric v3 stays active temporarily.** This provides a fast rollback during soak; it should be deactivated only after production monitoring is stable.
5. **Learning is post-turn by default.** It must not delay or replace the Actor answer and stages only reviewable knowledge.
6. **No automatic approval or merge.** Learning and knowledge changes remain `review_needed`; weak duplicate evidence cannot trigger an automatic merge.

## Residual Items

- Reject the synthetic pre-fix review records after review: `295a9173-1bb9-44d4-8893-5806af1c2384`, `ccf0fc74-1643-405f-9175-4f3711b03a8f`, `aa02a5bc-1094-444b-8943-f5ed8a63e3f7`, and `bfe1a36a-f9e9-447e-979e-9463e1bd2917`.
- Keep the validated v4 record `fbc8723f-7ebd-43e7-b1c7-ee98657c5e5b` in `review_needed` until human review.
- Add a graceful `blocked_auth_context` response for old sessions that call Knowledge Fabric without a signed token; do not weaken authentication.
- Observe Learning Agent duration. Execution `34712` completed asynchronously but took about 75 seconds, so it is unsuitable for foreground use.
- Recalibrate duplicate thresholds only after more approved samples and outbox/Search indexing have completed.
- After a soak period, re-export v4, verify all callers, then deactivate v3.

## Verification

- `npm run check:agents`: passed.
- `npm run check:backend`: passed, including 50 hosted API route contracts.
- Azure frontend and backend deployment workflows for the preceding context fixes: passed.
- Live post-answer filter probe `uat_post_answer_filter_20261024`: HTTP 201 with `post_turn_learning=not_recommended`.
- `npm test` is not defined in this repository; the repository-specific check suites above are the authoritative validation commands.
