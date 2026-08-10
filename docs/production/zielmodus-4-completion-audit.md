# Zielmodus 4 Completion Audit

Date: 2026-08-11

Purpose: provide a single requirement-by-requirement audit for Zielmodus 4 so completion is based on current evidence, not memory or partial progress.

Current status: **partial_live_url_blocked**.

Interpretation: the public-safe Knowledge Fabric, OKF, graph, vector-boundary, dark-mode QA, and cockpit work is ready. Full Zielmodus closure is not yet proven because live n8n URLs and non-demo probe evidence are missing for the three-agent runtime.

## Requirement Audit

| Requirement | Evidence | Status | Remaining gap |
| --- | --- | --- | --- |
| OKF markdown/YAML schema for concepts, evidence, transcripts, graph nodes, graph edges, and review states | `docs/knowledge-fabric-okf-schema.md`, `contracts/okf/schemas/*.json`, `contracts/okf/examples/**` | Ready | None |
| Knowledge repo split target for app repo, knowledge fabric repo, and agent config repo | `docs/production/repo-split-handoff-checklist.md`, `docs/production/agent-config-repo-scaffold.md`, `docs/production/agent-config-handoff-package.md` | Ready | None |
| Knowledge Fabric Agent ingest path | `contracts/okf/ingest/sample-ingest-request.json`, `scripts/mock-okf-ingest.cjs`, `contracts/okf/generated/**` | Ready as fixture-backed MVP path | Live Knowledge Fabric Agent URL still missing |
| Evidence storage and CRUD log path | `contracts/okf/examples/evidence/**`, `contracts/okf/generated/evidence/**`, `contracts/okf/examples/audit/florian/crud-log.jsonl`, `contracts/okf/generated/audit/florian/crud-log.jsonl` | Ready | None for public-safe MVP |
| Graph curator / relation promotion workflow | `contracts/okf/promotions/README.md`, `contracts/okf/promotions/*.json`, `scripts/validate-graph-promotions.cjs`, Knowledge Graph review UI | Ready | Live Knowledge Fabric Agent graph-curator trigger still needs URL/probe |
| Vector DB adapter boundary without Azure credentials | `contracts/okf/examples/vector/**`, `contracts/okf/negative/vector/**`, `scripts/validate-vector-adapter.cjs` | Ready | Actual Azure/vector credentials intentionally deferred |
| Knowledge Browser dark-mode contrast, density, review-state labels, and source affordances | `docs/qa/knowledge-browser-dark-mode-qa.md`, `docs/visual-qa/screenshots-20260810-z4-final-audit/**`, `docs/visual-qa/screenshots-20260810-z4-knowledge-browser-dark-polish/**` | Ready | None currently known |
| Knowledge Graph legend, approved/draft/inferred colors, labels, and mobile containment | `docs/qa/knowledge-browser-dark-mode-qa.md`, `docs/visual-qa/screenshots-20260810-z4-final-audit/**`, `docs/visual-qa/screenshots-20260810-z4-graph-legend-dark-polish/**` | Ready | None currently known |
| Visible agent trace/history panel in Review or Production Cockpit | `docs/visual-qa/screenshots-20260810-z4-final-audit/trace-dashboard-*.png`, `docs/visual-qa/screenshots-20260810-z4-chat-latest-agent-traces/chat-latest-agent-traces-qa.json` | Ready | None for fixture/local traces |
| Contract health badges beside Chat modes | `frontend/app.js`, `contracts/n8n/fixtures/*.json`, `scripts/validate-n8n-fixtures.cjs` | Ready | Live badges remain blocked for missing Knowledge Fabric Agent and Agentic Butler URLs |
| Real n8n URLs for Knowledge Fabric Agent and Agentic Butler | `frontend/assets/n8n-runtime-readiness-status.json`, `frontend/assets/n8n-live-readiness-preflight.json`, `frontend/assets/zielmodus-4-readiness-status.json` | Not complete | Missing `GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL` and `GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL` |
| Non-demo live probe evidence for all three top-level agents | `frontend/assets/n8n-live-probe-evidence.json` | Not complete | Missing Actor Twin, Knowledge Fabric Agent, and Agentic Butler trace evidence |

## Machine Evidence

The authoritative machine-readable readiness artifact is:

- `frontend/assets/zielmodus-4-readiness-status.json`

Current expected values before live integration:

- `public_safe_ready`: `true`
- `live_ready`: `false`
- `live_probe_ready`: `false`
- missing live URL agents: `knowledge_fabric_agent`, `agentic_butler`
- missing probe agents: `actor_twin`, `knowledge_fabric_agent`, `agentic_butler`

The live handoff artifacts are:

- `frontend/assets/n8n-runtime-readiness-status.json`
- `frontend/assets/n8n-live-readiness-preflight.json`
- `frontend/assets/n8n-live-handoff-commands.json`
- `frontend/assets/n8n-live-probe-evidence.json`
- `frontend/assets/zielmodus-4-live-completion-checklist.json`

## Verification Commands

Public-safe gate:

```powershell
node scripts\check-zielmodus-4-public-safe.cjs
```

Strict live URL gate:

```powershell
node scripts\validate-zielmodus-4-readiness.cjs --require-live
```

Strict final live probe gate:

```powershell
node scripts\validate-zielmodus-4-readiness.cjs --require-live-probes
```

## Closure Rule

Do not mark Zielmodus 4 complete until all of the following are true:

1. `node scripts\validate-zielmodus-4-readiness.cjs --require-live-probes` exits `0`.
2. GitHub Pages workflow succeeds after the final evidence commit.
3. Live Pages smoke check passes.
4. Production/Review Cockpit shows all three top-level agents connected.
5. `frontend/assets/n8n-live-probe-evidence.json` contains connected, non-demo evidence for Actor Twin, Knowledge Fabric Agent, and Agentic Butler.

