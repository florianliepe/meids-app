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
| ISO-01 | Passed at contract/unit level | Knowledge access tests plus tenant/twin parameters asserted on every graph mutation. Cross-tenant Azure parity remains pending. |
| ISO-02 | Pending isolated-cloud test | Requires two test principals and private Blob objects. No production fault injection performed. |
| TX-01 | Passed by transaction/static contract | Existing knowledge stage path commits concept, revision, evidence, chunk and outbox in one transaction. Database kill-point test remains pending in ephemeral PostgreSQL. |
| REV-01 | Passed | Non-reviewer guard, candidate-only semantic proposals and human promotion boundary validated. |
| REL-01 | Passed locally | Durable candidate/review schema, idempotent upsert, stale marking and behavioral mock test passed. Azure migration/live persistence check follows deployment. |
| REL-02 | Passed locally | Source/target revisions are stored; changed revisions invalidate old approval and return the edge to candidate. |
| OUT-01 | Partially covered | Dedupe keys, retry state and bounded attempts exist. Crash-after-ack test requires disposable Blob/Search endpoints. |
| OUT-02 | Pending isolated-cloud test | Concurrent worker and out-of-order revision test must not run against production. |
| OUT-03 | Partially covered | Dead-letter and backoff code is present; recovery observability test remains open. |
| REC-01 | Pending | Scheduled PostgreSQL/Search/Blob reconciliation is not implemented yet. |
| REC-02 | Pending | Full rebuild/cutover requires a separate nonproduction Search index. |
| SEM-01 | Passed | Pure-vector query, score conversion and classification threshold regression tests passed. |
| SEM-02 | Partially passed | Model/dimension provenance is now recorded per edge. Controlled M1/M2 corpus evaluation remains open. |
| AGT-01 | Passed at contract level | Actor Twin, Knowledge Fabric and response-adapter suites passed. Live execution evidence from the preceding audit remains valid only for its pinned revision. |
| AGT-02 | Partially covered | Trace and approval boundaries pass; callback replay/cancellation needs isolated n8n workflow copies. |
| DEP-01 | Pending new deployment evidence | Must verify exact deployed SHA after this hardening commit is pushed. |

## Commands executed

- `npm run check:backend`
- `npm run check:agents`
- `node scripts/validate-postgres-graph-schema.cjs`
- `node scripts/validate-graph-promotions.cjs`
- `node scripts/test-graph-persistence.cjs`
- `git diff --check`

All executed checks passed.

## Defect backlog

### Fixed in this package

1. `KG-001` Graph candidates and reviews existed only as request-time projection plus audit events.
2. `KG-002` Accepted relations could survive changed concept revisions without renewed review.
3. `KG-003` Graph review endpoint lacked an explicit owner/admin/reviewer authorization gate.
4. `KG-004` Vector rebuild retained production-unsafe `default`/`unknown` scope fallbacks.
5. `KG-005` Non-deterministic semantic relation proposals lacked a strict evidence/provenance contract.
6. `KG-006` Embedding provenance lookup used environment names different from the production Search adapter.

### Open release-hardening items

1. `KG-007` Apply migration 016 and verify durable projection in Azure PostgreSQL.
2. `KG-008` Add a scheduled PostgreSQL-to-Search-to-Blob reconciliation worker and orphan report.
3. `KG-009` Execute fault-injected outbox replay, lease expiry, poison event and out-of-order tests in disposable infrastructure.
4. `KG-010` Execute cross-tenant/twin API, Search, Blob and graph traversal tests with dedicated test identities.
5. `KG-011` Build a versioned multilingual semantic evaluation corpus and release thresholds per embedding model.
6. `KG-012` Centralize n8n callable workflow IDs and distinguish callable workflows from public webhook wrappers.
7. `KG-013` Run callback replay, cancellation and stale-result tests against isolated n8n workflow copies.
8. `KG-014` Rebuild an empty nonproduction Search index and verify cutover/rollback.

## Release rule

No isolation or approval-boundary failure may be waived. Other P1 failures require a named owner, mitigation and review date. Semantic scores may discover candidates but never approve, merge or expose knowledge by themselves.
