# Knowledge Graph Hardening Test Report

Date: 2026-10-27  
Baseline: `96513c18bb08b9ec7a8903d59e7a800bbdfb4d52`  
Scope: OKF creation, vector candidate discovery, durable graph projection, relation review, agent contracts, isolation and deployment evidence.

## Implemented hardening

- Added PostgreSQL migration `016_durable_knowledge_graph.sql` for scoped graph nodes, edges, reviews and projection runs.
- Added row-level security using authenticated tenant and allowed-twin context.
- Added idempotent projection with stale marking instead of destructive deletion.
- Added relation provenance, source/target revisions, algorithm version, model provenance, score evidence and stable input hashes.
- Invalidated accepted reviews when source or target concept revisions change.
- Preserved historical audit reviews during migration to durable review records.
- Restricted graph review to twin owner/reviewer or application owner/admin.
- Added evidence-gated, ontology-bounded semantic relation proposals. They remain candidates and confidence is capped at `0.85`.
- Removed remaining `default` and `unknown` scope fallbacks from vector rebuild.

## Executed test cases

| ID | Result | Evidence |
|---|---|---|
| ISO-01 | Passed live | Runtime-role probe returned 19 nodes for the authenticated tenant/twin and 0 nodes for a deliberately wrong tenant. |
| ISO-02 | Pending isolated-cloud test | Requires two test principals and private Blob objects. No production fault injection performed. |
| TX-01 | Passed by transaction/static contract | Existing knowledge stage path commits concept, revision, evidence, chunk and outbox in one transaction. Database kill-point test remains pending in ephemeral PostgreSQL. |
| REV-01 | Passed | Non-reviewer guard, candidate-only semantic proposals and human promotion boundary validated. |
| REL-01 | Passed live | Migration 016 applied in Azure. A production graph refresh persisted 19 nodes, 37 active edges and one projection run. |
| REL-02 | Passed locally | Source/target revisions are stored; changed revisions invalidate old approval and return the edge to candidate. |
| OUT-01 | Partially covered | Dedupe keys, retry state and bounded attempts exist. Crash-after-ack test requires disposable Blob/Search endpoints. |
| OUT-02 | Pending isolated-cloud test | Concurrent worker and out-of-order revision test must not run against production. |
| OUT-03 | Partially covered | Dead-letter and backoff code is present; recovery observability test remains open. |
| REC-01 | Pending | Scheduled PostgreSQL/Search/Blob reconciliation is not implemented yet. |
| REC-02 | Pending | Full rebuild/cutover requires a separate nonproduction Search index. |
| SEM-01 | Passed | Pure-vector query, score conversion and classification threshold regression tests passed. |
| SEM-02 | Partially passed | Model/dimension provenance is now recorded per edge. Controlled M1/M2 corpus evaluation remains open. |
| AGT-01 | Passed live | Actor Twin plus all six workflow-tool subagents have successful live n8n executions in the inspected window (`7/7`). Contract and response-adapter suites also passed. |
| AGT-02 | Partially covered | Trace and approval boundaries pass; callback replay/cancellation needs isolated n8n workflow copies. |
| DEP-01 | Passed | Azure App Service build-info reports exact SHA `00cdb3145b2507d5f6148fb4456a7f357a206d28`, run `40509765893`. |

## Commands executed

- `npm run check:backend`
- `npm run check:agents`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/test-graph-persistence.cjs`
- `git diff --check`

All executed checks passed.

## Live Azure evidence

- Deployment run `40509765893` completed successfully for exact revision `00cdb3145b2507d5f6148fb4456a7f357a206d28`.
- Migration `016_durable_knowledge_graph.sql` was applied through the private App Service network path with a short-lived Entra database-admin token. The temporary script and token-bearing file were deleted immediately after execution.
- Runtime managed identity was not left in the PostgreSQL administrator group, and `MEIDS_AUTO_MIGRATE` was returned to `false`.
- Production UI refresh showed 19 nodes and 37 candidate relations.
- PostgreSQL verification showed 19 durable nodes, 37 durable edges, 37 active edges, zero review decisions and one projection run.
- RLS verification under `meids_app_runtime` showed 19 nodes in the permitted scope and zero nodes in a cross-tenant scope.
- Read-only n8n execution probes found fresh successful executions for Actor Twin, Knowledge Fabric, Agentic Butler, Skill Orchestrator, Task Agent, Critical Faculty and Learning Agent (`7/7`).

## Defect backlog

### Fixed in this package

1. `KG-001` Graph candidates and reviews existed only as request-time projection plus audit events.
2. `KG-002` Accepted relations could survive changed concept revisions without renewed review.
3. `KG-003` Graph review endpoint lacked an explicit owner/admin/reviewer authorization gate.
4. `KG-004` Vector rebuild retained production-unsafe `default`/`unknown` scope fallbacks.
5. `KG-005` Non-deterministic semantic relation proposals lacked a strict evidence/provenance contract.
6. `KG-006` Embedding provenance lookup used environment names different from the production Search adapter.
7. `KG-007` Migration 016 was applied and durable projection was verified in Azure PostgreSQL.
8. `KG-015` A synchronous migration wrapper prevented `server.js` from opening its HTTP listener. Startup now opens the API first and schedules optional migrations asynchronously; production auto-migration is disabled after the one-time migration.

### Open release-hardening items

1. `KG-008` Add a scheduled PostgreSQL-to-Search-to-Blob reconciliation worker and orphan report.
2. `KG-009` Execute fault-injected outbox replay, lease expiry, poison event and out-of-order tests in disposable infrastructure.
3. `KG-010` Extend the passed database RLS probe to API, Search, Blob and graph traversal with two dedicated test identities.
4. `KG-011` Build a versioned multilingual semantic evaluation corpus and release thresholds per embedding model.
5. `KG-012` Centralize n8n callable workflow IDs and distinguish callable workflows from public webhook wrappers.
6. `KG-013` Run callback replay, cancellation and stale-result tests against isolated n8n workflow copies.
7. `KG-014` Rebuild an empty nonproduction Search index and verify cutover/rollback.

## Release rule

No isolation or approval-boundary failure may be waived. Other P1 failures require a named owner, mitigation and review date. Semantic scores may discover candidates but never approve, merge or expose knowledge by themselves.
