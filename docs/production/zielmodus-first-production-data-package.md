# Zielmodus: First Production Data Package

Date: 2026-10-19

## Objective

Complete the first production data package in `rg-ai-intellectual-twin` while preserving the existing Twin CRUD runtime and treating PostgreSQL as the system of record, Blob Storage as the immutable artifact store, and Azure AI Search as a rebuildable retrieval projection.

## Execution order

1. **Storage hardening**
   - Create private Blob containers for source, working, approved, learning, quarantine, and export artifacts.
   - Apply lifecycle rules only to disposable quarantine/export data and non-current versions.
   - Validate versioning and soft-delete settings remain enabled.
2. **Search activation**
   - Deploy the canonical working and approved index contracts with Microsoft Entra authentication.
   - Validate index schema and empty-index readiness.
3. **Transactional write path**
   - Add authenticated Knowledge Fabric staging, Learning increment, and review-promotion APIs.
   - Write concept/revision/evidence/chunk and outbox records in one PostgreSQL transaction.
   - Store canonical source/revision artifacts in Blob Storage.
4. **Outbox projection**
   - Claim events with `FOR UPDATE SKIP LOCKED`.
   - Generate or accept embeddings, project to the correct Search index, and mark events completed.
   - Apply bounded retries, idempotent document IDs, and dead-letter state.
5. **Agent routing**
   - Route Knowledge Fabric output to the staging API.
   - Route Learning Agent output through Knowledge Fabric into `review_needed` records.
   - Keep n8n as orchestration only; it must not become a second system of record.
6. **Backfill and validation**
   - Rebuild both indexes from PostgreSQL revisions.
   - Test tenant isolation, promotion, duplicate detection, outbox replay, full Search rebuild, and Blob recovery controls.
7. **Availability decision**
   - Attempt zone-redundant PostgreSQL HA after functional gates pass.
   - Retain healthy same-zone HA if regional zone capacity blocks the change and record the exception.

## Stop conditions

- Never automatically publish `review_needed` knowledge to the approved index.
- Never weaken row-level security to make an integration test pass.
- Never place repository credentials, n8n credentials, Search keys, or database credentials in workflow JSON or source control.
- Stop deployment if a migration, access-isolation test, or existing Twin CRUD smoke test fails.

## Evidence required

- Azure resource state for storage controls, containers, indexes, PostgreSQL HA, and managed-identity role assignments.
- Migration status and API contract tests.
- One staged knowledge concept, one `review_needed` learning increment, one approved promotion, and corresponding Search documents.
- Successful replay/rebuild proof and a negative cross-user access test.

## Execution status

| Step | Status | Follow-up |
| --- | --- | --- |
| 1. Storage hardening | Complete | Confirm final legal retention policy. |
| 2. Search activation | Complete | Add private endpoint before public launch. |
| 3. Transactional write path | Complete | None for the persistence boundary. |
| 4. Outbox projection | Complete with guarded Search deferral | Configure real embeddings for future rows; current rows rebuilt without deferral. |
| 5. Agent routing | Knowledge Fabric complete; Learning backend boundary complete | Propagate signed user/twin context through detached Learning Agent calls. |
| 6. Backfill and validation | Complete for first package | Five PostgreSQL rows rebuilt into 1 approved and 4 working documents; private point-in-time restore passed and was deleted. |
| 7. Availability decision | Same-zone HA accepted | Recheck zone-redundant capacity before public launch. |

Detailed evidence and remaining gates are recorded in
`docs/uat/first-production-data-package-evidence-20261019.md`.
