# First Production Data Package Evidence

Date: 2026-10-19

## Result

The transactional production data path is operational for signed Knowledge Fabric and Learning writes. PostgreSQL is the source of truth, Blob Storage and Azure AI Search are outbox projections, and new content remains review-gated.

## Completion matrix

| Package item | Result | Evidence |
| --- | --- | --- |
| PostgreSQL Flexible Server | Complete | `psql-meids-prod-1853a19b`, PostgreSQL 16, private delegated subnet, public access disabled, Entra-only authentication. |
| Database and schemas | Complete | Migrations `001` through `007` applied to `meids_prod`; identity, twin, knowledge, learning, agent, audit, and runtime/outbox boundaries exist. |
| RLS and runtime identity | Complete | Backend managed identity is mapped to the runtime role; signed access claims carry tenant/user/twin scope. |
| Blob hardening | Complete | `stmeidsprod1853a19b` has private source, working, approved, learning, quarantine, and export containers; versioning, soft delete, and lifecycle rules are active. |
| Search indexes | Complete | `meids-okf-working-v1` and `meids-okf-approved-v1` are deployed to `srch-meids-prod-1853a19b`. |
| Transactional outbox | Complete | Knowledge and learning transactions enqueue idempotent events; the worker claims with `FOR UPDATE SKIP LOCKED`, writes Blob artifacts, and projects Search documents. |
| Knowledge Fabric routing | Complete for controlled UAT | Live n8n execution `32440` first proved staging; final contract probe execution `32444` staged concept `565beb41-a71e-4502-9004-d3212ceba443` in `review_needed`. |
| Learning increments | Complete at backend boundary | Trace `learning_prod_probe_1792428740682` staged increment `2b89d148-e8bd-475a-874d-5c0fd63ebdf3` in `review_needed`. |
| Promotion | Complete | Concept `56d22e31-a1db-4c05-86dc-df0b1084a38d`, revision 2, was promoted; it appeared in the approved index and was removed from the working index. |
| Tenant/user isolation | Passed | Florian's signed private scope returned five working candidates; `isolation-probe-user` returned zero for the same tenant/twin/query. |
| PostgreSQL resilience | Complete with documented exception | Same-zone HA is healthy, backups retain 35 days, and geo-redundant backup is enabled. A fresh zone-2 update attempt returned: `This location has a single availability zone`; the existing healthy same-zone standby was preserved. |
| PostgreSQL point-in-time restore | Passed | Temporary private server `psql-meids-restore-20261019` reached `Ready`. The VNet-hosted probe read 7 migrations through `007`, 1 tenant, 1 user, 3 twins, 5 concepts, 2 learning increments, and 9 outbox rows. The disposable server was deleted after validation. |
| PostgreSQL-to-Search rebuild | Passed | Signed `POST /api/knowledge/rebuild-search` read 5 source rows and projected all 5 without deferral. Managed-identity retrieval returned 1 approved and 4 working documents. |

## Runtime probes

- Signed Knowledge Fabric webhook returned HTTP 200 and a stable persistence receipt with `status=staged`, revision 1, and `review_state=review_needed`.
- Working Search returned the staged UAT concepts after the outbox interval.
- Direct requests without a signed knowledge token return JSON HTTP 401 from the backend rather than an HTML Easy Auth page.
- Backend deployment completed successfully on `meids-prod-backend-1853a19b`; the protected `/api/health` route correctly remains behind Easy Auth.
- App Service Authentication excludes only the signed machine routes needed by n8n, now including `/api/knowledge/rebuild-search`; an unsigned rebuild request returns JSON HTTP 401.
- Search local-key access remained unusable during the operator count probe, while the backend managed-identity route succeeded. This is the expected least-privilege runtime path.
- `npm run check:backend` passed.
- `node scripts/validate-n8n-ai-agent-workflows.cjs` passed after the validator was aligned with the governed preparation, duplicate-check, staging, and response chain.

## Open production gates

1. Approve and configure the production 1,536-dimension embedding provider. The current five-row rebuild is complete because those rows already contain caller-supplied UAT vectors; future rows without vectors are safely deferred.
2. Recover the n8n publication worker/editor state. The public publish API activates the correct routing graph, but the editor remains on `Publishing...`; node-only response changes may remain cached until the n8n runtime is recovered.
3. Remove internal vectors from the live Knowledge Fabric response after that publication recovery. The canonical workflow already contains the sanitizer, but execution `32444` still used the prior cached response-node implementation.
4. Add private endpoints and private DNS for Storage and Search, then disable their public network endpoints.
5. Re-test zone-redundant PostgreSQL HA before public launch; retain same-zone HA if the region still blocks allocation.

## Human inputs

- Provide or approve the embedding service route: endpoint, deployment/model, dimensions, authentication method, and quota owner.
- Approve a short n8n maintenance window if publication-worker recovery requires restarting the shared n8n App Service.
- Confirm approved-knowledge retention/deletion policy.
