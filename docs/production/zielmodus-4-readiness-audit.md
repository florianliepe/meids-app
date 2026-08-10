# Zielmodus 4 Readiness Audit

Date: 2026-08-10

Purpose: provide requirement-by-requirement evidence for the Knowledge Fabric, OKF schema, graph, and dark-mode UX scope. This audit is intentionally conservative: fixture coverage and UI readiness do not count as live agent integration.

## Executive Status

| Area | Status | Evidence | Remaining Gap |
| --- | --- | --- | --- |
| OKF markdown/YAML schema | Implemented and validated | `docs/knowledge-fabric-okf-schema.md`, `contracts/okf/examples/`, `scripts/validate-okf-fixtures.cjs` | None for public-safe schema boundary |
| Repo split target | Documented | `docs/production/repo-split-handoff-checklist.md`, `docs/production/agent-config-repo-scaffold.md` | Create/private-maintain target repos outside this public app repo |
| Knowledge Fabric Agent ingest path | Defined and fixture-backed | `contracts/okf/ingest/sample-ingest-request.json`, `scripts/mock-okf-ingest.cjs`, `contracts/okf/generated/`, `frontend/assets/n8n-contract-replay-status.json` | Live Knowledge Fabric Agent n8n webhook URL is missing |
| Graph relation promotion workflow | Visible and validated | `contracts/okf/promotions/`, `scripts/validate-graph-promotions.cjs`, Knowledge Graph candidate review UI | Live graph curator trigger still fixture-only until Knowledge Fabric Agent URL exists |
| Vector DB adapter boundary | Prepared without secrets | `contracts/okf/examples/vector/`, `contracts/okf/negative/vector/`, `scripts/validate-vector-adapter.cjs` | Azure/vector DB credentials and runtime adapter remain pending |
| Knowledge Browser dark mode | QA passed | `docs/qa/knowledge-browser-dark-mode-qa.md`, `docs/visual-qa/screenshots-20260810-z4-knowledge-browser-dark-polish/` | Optional future density tuning after real content grows |
| Knowledge Graph dark mode | QA passed | `docs/qa/knowledge-browser-dark-mode-qa.md`, `docs/visual-qa/screenshots-20260810-z4-graph-legend-dark-polish/` | Optional future simplification after user testing |
| Agent trace/history UI | Implemented | Chat latest trace panel, Production/Review trace cockpit, `docs/visual-qa/screenshots-20260810-z4-chat-latest-agent-traces/` | Live traces for two missing agents cannot be captured yet |
| n8n live URLs and workflow blueprints | Partially configured | `docs/n8n-live-url-configuration.md`, `contracts/n8n/agent-config-public-export.json`, `workflows/n8n/*.workflow.json`, `scripts/set-n8n-agent-url.cjs`, `frontend/assets/agent-runtime-config.json`, `frontend/assets/n8n-runtime-readiness-status.json` | Knowledge Fabric Agent and Agentic Butler URLs are absent |

## Requirement Evidence

| Requirement | Current Evidence | Verdict |
| --- | --- | --- |
| Formalize OKF schema for concepts, evidence, transcripts, graph nodes, graph edges, and review states | `docs/knowledge-fabric-okf-schema.md` defines repository split, review states, concept markdown, evidence YAML, transcript markdown, graph node YAML, graph edge YAML, audit event YAML, vector adapter payloads, and validation rules. Public-safe examples exist under `contracts/okf/examples/`. | Complete for public-safe MVP contract |
| Document repo split target: app repo, knowledge fabric repo, agent config repo | `docs/production/repo-split-handoff-checklist.md` defines `meids-app`, `meids-knowledge-fabric`, and `meids-agent-configs`, including responsibilities, branch model, gates, and handoff sequence. | Complete as documentation; target private repos still need operational setup |
| Define Knowledge Fabric Agent ingest path: upload/transcript input, pending OKF concept, evidence storage, CRUD log, graph curator trigger | `contracts/okf/ingest/sample-ingest-request.json` defines the request. `scripts/mock-okf-ingest.cjs` generates concept, evidence, transcript, graph node, graph edge, audit, and vector payload artifacts under `contracts/okf/generated/`. n8n fixtures include the Knowledge Fabric Agent contract and replay status. | Fixture-backed; live n8n execution pending |
| Add or refine graph relation promotion workflow: draft, candidate, accepted, rejected, needs rework | `contracts/okf/promotions/README.md` and promotion fixtures cover approve, reject, and needs-rework decisions. `scripts/validate-graph-promotions.cjs` validates these against edge fixtures. The Knowledge Graph UI exposes candidate edge review actions and QA checks candidate acceptance. | Complete for MVP review workflow |
| Prepare vector DB adapter boundary without Azure credentials | Vector upsert/request examples and negative cases exist under `contracts/okf/examples/vector/` and `contracts/okf/negative/vector/`. `scripts/validate-vector-adapter.cjs` validates accepted and blocked payloads without secrets. | Complete as boundary; runtime Azure adapter pending credentials |
| Improve dark mode Knowledge Browser | CSS-only dark-mode polish applied to increment rows and state ribbons. QA evidence stored under `docs/visual-qa/screenshots-20260810-z4-knowledge-browser-dark-polish/`; browser QA passed 6/6. | Complete for current MVP |
| Improve Knowledge Graph: clearer legend, approved vs draft vs inferred colors, readable labels, mobile containment | CSS-only graph legend polish applied. QA evidence stored under `docs/visual-qa/screenshots-20260810-z4-graph-legend-dark-polish/`; browser QA passed 6/6. | Complete for current MVP |
| Add visible agent trace/history panel in Review or Production Cockpit | Production/Review Cockpit trace history exists, and Chat now includes `Latest agent traces` linked to the cockpit. QA evidence stored under `docs/visual-qa/screenshots-20260810-z4-chat-latest-agent-traces/`. | Complete for fixture/local traces |
| Wire real n8n URLs for Knowledge Fabric Agent and Agentic Butler | Runtime config exposes slots and setup guidance. `docs/n8n-live-url-configuration.md` defines required secrets and config keys. Public-safe workflow blueprints exist under `workflows/n8n/`, and `scripts/validate-agent-config-export.cjs` validates the handoff manifest against the fixtures and blueprint files. `scripts/set-n8n-agent-url.cjs` safely applies public UAT URLs and regenerates readiness artifacts once URLs exist. | Incomplete: URLs are not available yet |
| Add contract health badges directly beside Chat modes | Chat-level contract actions and badges are documented in `docs/n8n-live-url-configuration.md`; UI includes active contract badges and mode health. | Complete for status display; live status still depends on URLs |

## Validation Commands

Run from the repository root:

```powershell
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --check frontend\app.js
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\validate-zielmodus-4-readiness.cjs
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\validate-zielmodus-4-readiness.cjs --write
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\validate-n8n-fixtures.cjs
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\validate-agent-config-export.cjs
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\validate-okf-fixtures.cjs
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\validate-graph-promotions.cjs
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\validate-vector-adapter.cjs
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\validate-postgres-graph-schema.cjs
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\pages-smoke-check.cjs frontend
$env:NODE_PATH="C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"
& "C:\Users\e729958\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\browser-dark-mode-qa.cjs frontend docs\visual-qa\screenshots-20260810-z4-final-audit
```

## Machine Readiness Gate

`scripts/validate-zielmodus-4-readiness.cjs` is the machine-checkable gate for this audit.

The same status is surfaced in the Production Cockpit as a `Zielmodus gate` card next to the n8n runtime boundary. This keeps the closure state visible in the operator UI and links directly to the static readiness artifact and this audit.

| Command | Expected result now | Purpose |
| --- | --- | --- |
| `node scripts/validate-zielmodus-4-readiness.cjs` | Exit `0`, status `partial_live_url_blocked` | Confirms all public-safe evidence and QA are ready while live n8n URLs are still missing |
| `node scripts/validate-zielmodus-4-readiness.cjs --write` | Exit `0`, writes `frontend/assets/zielmodus-4-readiness-status.json` | Publishes a static readiness artifact for GitHub Pages and operator review |
| `node scripts/validate-zielmodus-4-readiness.cjs --require-live` | Exit `1` until both missing live URLs exist | Strict production/live gate for final Zielmodus closure |
| `node scripts/validate-zielmodus-4-readiness.cjs --require-live-probes` | Exit `1` until live URLs and non-demo probe trace evidence exist | Strict final gate for URL plus workflow-reached proof |

The current correct status is `partial_live_url_blocked`: all schema, fixture, graph, vector-boundary, trace, and dark-mode evidence is present; Knowledge Fabric Agent and Agentic Butler remain blocked on live webhook URLs. After URLs are configured, the status may advance to `live_probe_evidence_pending` until public UAT probes reach the workflows and return trace ids.

Live probe evidence is tracked in `frontend/assets/n8n-live-probe-evidence.json`. Keep placeholder entries in `awaiting_probe` until the corresponding n8n execution is visible and the response includes a non-demo `trace_id`.

Use `node scripts/record-n8n-live-probe-evidence.cjs --agent <agent_id> --trace-id <trace_id> --execution-url <public_safe_execution_url>` to capture the evidence in the public readiness artifact after each successful UAT probe. The script validates the agent id, rejects demo/fixture trace ids, and prevents obvious secret-like URL values from being written.

## Live n8n Completion Gate

Zielmodus 4 must remain open until these two live URL slots are provided and tested:

| Agent | Required key | Expected transition |
| --- | --- | --- |
| Knowledge Fabric Agent | `GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL` or `n8nAgentWebhooks.knowledge_fabric_agent` | `awaiting_url` -> `configured` -> `n8n connected` after probe trace |
| Agentic Butler | `GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL` or `n8nAgentWebhooks.agentic_butler` | `awaiting_url` -> `configured` -> `n8n connected` after approval-gated skill probe trace |

Do not mark these agents production-ready based only on fixtures. Required proof:

1. Public UAT or hosted backend URL configured.
2. Pages/runtime readiness artifact regenerated.
3. Cockpit live probe reaches the n8n workflow.
4. n8n execution trace is retained.
5. Human approval gate is confirmed for any external action path.

## Next Forecast

1. Configure Knowledge Fabric Agent and Agentic Butler public UAT URLs when available.
2. Regenerate runtime readiness artifacts and redeploy GitHub Pages.
3. Run live probes from Chat and Production/Review Cockpit.
4. Capture n8n execution evidence and update this audit.
5. After live evidence exists, perform a final completion audit and close Zielmodus 4 if every requirement is proven.
