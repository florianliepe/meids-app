# Agent Interaction UAT Test Catalog

## Purpose
Verify that MeIDs Chat uses Actor Twin as the primary interaction layer and that Actor Twin can delegate to Knowledge Fabric Agent and Agentic Butler through live n8n while preserving route decisions, trace chains, and approval gates.

## Automated UAT

Run:

```powershell
node scripts\run-agent-interaction-uat.cjs
node scripts\validate-chat-live-n8n-uat.cjs --file docs\uat\agent-interaction-uat-results.json
```

Evidence:

- `docs/uat/agent-interaction-uat-results.json`

| ID | Scenario | Prompt | Expected route | Expected target | Expected status | Pass criteria |
|---|---|---|---|---|---|---|
| UAT-AI-001 | Direct Actor Twin answer | Ask who Florian is in the staging twin | `answer_direct` | `actor_twin` | `completed` | n8n returns structured answer, route decision, actor trace |
| UAT-AI-002 | Knowledge Fabric delegation | Ask to remember a source note as pending OKF evidence | `ingest_or_stage_knowledge` | `knowledge_fabric_agent` | `completed` | Actor Twin delegates; response includes delegate result and delegate trace |
| UAT-AI-003 | Agentic Butler skill creation | Ask to create a new weekly executive steering skill | `create_skill` | `agentic_butler` | `approval_required` | Actor Twin delegates; Butler returns approval gate and delegate trace |

## Manual Browser UAT

Use the public-safe prompts above in the Chat UI.

| ID | Area | Steps | Expected result |
|---|---|---|---|
| UAT-UI-001 | Chat direct answer | Select Ask Twin, ask the direct Actor Twin prompt | The answer renders as a normal Twin answer, not raw JSON |
| UAT-UI-002 | Chat Knowledge Fabric route | Ask the pending OKF evidence prompt | Chat shows Knowledge Fabric delegation summary and a trace id |
| UAT-UI-003 | Chat Butler route | Ask the skill creation prompt | Chat shows approval-required card with Butler summary and resume/copy controls |
| UAT-UI-004 | Trace cockpit | Open Review/Traces after each prompt | Parent Actor Twin trace and delegated child trace are visible |
| UAT-UI-005 | Approval cockpit | After Butler route, open pending approvals | Approval record is visible and can be copied/resumed when backend proxy is configured |
| UAT-UI-006 | n8n executions | Open n8n workflow executions | Actor Twin execution shows branch to Knowledge Fabric or Butler for delegated prompts |

## Issues Found

| Issue | Severity | Status | Evidence | Fix |
|---|---|---|---|---|
| UAT runner did not mimic frontend route context, causing live n8n to misclassify some prompts during direct script tests | Medium | Fixed | Initial `docs/uat/agent-interaction-uat-results.json` showed 1/3 pass | Runner now sends frontend-style `context.route_decision` |
| UAT runner did not parse n8n item-array/json wrappers and object-valued answers consistently | Medium | Fixed | Initial answer previews showed `[object Object]` | Runner, frontend, and backend normalizers now support these shapes |
| Actor Twin can still rely on fallback route context for deterministic classification | Medium | Open | UAT passes with frontend-style route context; raw no-hint probes can drift | Next n8n hardening should make route classification deterministic without context hints |
| Direct Actor Twin answers may return fenced JSON in `answer` | Low | Mitigated | UAT direct answer preview included fenced JSON | Runner normalizes fenced JSON; frontend/backend already parse embedded JSON |
| Live Knowledge Fabric workflow still runs an older canvas with a failing `Simple Memory` node | High | Open | `docs/uat/agent-interaction-uat-results.json` shows `knowledge_fabric_n8n_memory_error` | Import/publish `workflows/n8n/import-ready/knowledge-fabric-agent.ai-agent.import.json` or patch the live workflow to remove/correct the memory node |
| Live Agentic Butler workflow still has a dangling workflow/tool reference | High | Open | `docs/uat/agent-interaction-uat-results.json` shows `Referenced node does not exist` | Import/publish `workflows/n8n/import-ready/agentic-butler.ai-agent.import.json` or repair the referenced node/tool in the live workflow |
| Live Actor Twin delegation path times out for no-write Butler work artifact route | High | Open | `agentic_butler_work_artifact_handoff` timed out after 45s | Re-publish the Actor Twin workflow after worker workflow repair, then rerun `npm run uat:agents:live` |

## Current Result

Latest automated run: `1/4 passed`.

The verified integration path is partially active:

`Chat / script envelope -> Actor Twin n8n -> route_decision -> optional delegated workflow -> normalized response -> trace / approval evidence`.

Current live blocker: the repository workflow JSONs validate locally, but the
running n8n worker workflows are not aligned with those import-ready JSONs.
Apply these files in n8n, publish, then rerun the automated UAT:

- `workflows/n8n/import-ready/knowledge-fabric-agent.ai-agent.import.json`
- `workflows/n8n/import-ready/agentic-butler.ai-agent.import.json`
- `workflows/n8n/import-ready/actor-twin-direct-orchestrator.uat-live-urls.import.json`
