# Public Launch Completion Audit

Date: 2026-10-20

This audit evaluates the complete public-launch hardening objective against
authoritative repository and live-control-plane evidence. `Ready` means the
implementation is in place but a named human gate remains. `Complete` means
the requirement has direct current evidence and no remaining action.

## Requirement matrix

| Requirement | State | Authoritative evidence | Remaining action |
| --- | --- | --- | --- |
| Zielmodus instructions and decision record | Complete | `docs/production/zielmodus-public-launch-hardening.md`; `docs/production/decision-log-public-launch-hardening.md` | None |
| Production embedding implementation | Ready | `backend/azureSearch.js` supports managed identity and enforces 1,536 dimensions; `scripts/activate-production-embeddings.ps1` validates the model, assigns the data-plane role, removes API-key configuration, and activates the backend settings | Provision and approve an Azure OpenAI `text-embedding-3-small` deployment; the current subscription inventory contains zero Azure OpenAI/AIServices accounts |
| Production semantic embedding UAT | Human-required | `docs/production/public-launch-human-actions.md` defines the semantic ingest and complete rebuild acceptance path | Run after the approved deployment exists |
| n8n publication recovery | Complete | Live API revalidation: Actor `eKI3qM7nyCNn9r1q`, Knowledge Fabric `7Ci86PxXipwvYpKv`, and Butler `KZOqZRUAnVfFEAYJ` are active on versions updated 2026-10-20 14:34 UTC | None |
| Explicit n8n identity propagation | Complete | Actor forwards `query`, signed access token, tenant, user, twin, and organization; callable triggers expose matching typed fields; canonical and live workflow checks pass | None |
| Knowledge Fabric response sanitization | Ready | Live workflow topology removes `_knowledge_access_token`, `content_vector`, and `query_vector` before `Return JSON` | Confirm with the persisted authenticated chat UAT |
| Search private networking | Complete | `srch-meids-prod-1853a19b` is running, local auth disabled, public access disabled, and private endpoint `10.42.3.4` is active | None |
| Storage private networking | Complete | `stmeidsprod1853a19b` has public access disabled, default deny, shared-key access disabled, and private endpoint `10.42.3.5` | None |
| Legacy Search public-surface closure | Complete | `srch-intellectual-twin` public network access is disabled | None |
| Knowledge retention technical defaults | Complete | Blob versioning and soft delete are active; lifecycle deletes only disposable quarantine/export data and non-current working/source/learning versions; approved knowledge has no destructive lifecycle rule | None |
| Knowledge retention governance | Human-required | `docs/production/knowledge-retention-policy-template.md` and `docs/production/public-launch-human-actions.md` | Data owner, Legal/Records, and Security approve retention, offboarding, deletion authority, and legal hold |
| PostgreSQL private service and resilience | Complete with exception | `psql-meids-prod-1853a19b` is Ready, public access disabled, SameZone HA healthy, standby zone 1, 35-day retention, and geo backup enabled; point-in-time restore drill passed | None for current configuration |
| Zone-redundant PostgreSQL HA | Human-required exception | West Europe capability API reports `ZoneRedundantHa=Disabled`; alternate-zone update was rejected | Launch-risk owner signs the SameZone exception and Azure capacity is rechecked before launch and quarterly |
| PostgreSQL-to-Search rebuild | Complete for current rows | Five source rows rebuilt without deferral; managed-identity Search queries returned approved and working documents | Repeat after semantic embeddings are activated |
| Tenant/user isolation | Complete | Signed private scope returned the assigned working candidates; a negative user probe returned zero | None |
| Azure backend deployment | Complete | GitHub Actions run `39446482213` passed OIDC sign-in, validation, deployment, and App Service state verification | None |
| Azure frontend deployment | Complete | Azure Static Web Apps run `39446483047` passed; authenticated API routes redirect unauthenticated users to `/login` | None |
| GitHub Pages sandbox deployment | Complete | GitHub Pages run `39446483102` passed | None |
| Repository secret exposure | Complete | GitHub secret scanning has zero open alerts; tracked-source pattern scan found no credential material | None |
| Authenticated Knowledge Fabric chat UAT | Human-required | Test procedure in `docs/production/public-launch-human-actions.md` | User approval is required because the test creates one persisted `review_needed` concept |
| Agentic Butler normal/new-skill UAT | Human-required | Workflow is active; routing and approval-boundary fixture tests pass | Rotate the expired n8n LLM gateway credential, then run normal draft and new-skill tests |

## Current verdict

The automated infrastructure, deployment, publication, private-networking, and
contract-validation scope is complete. Public launch is **not approved** yet.
Five human-required gates remain:

1. Provision and approve production semantic embeddings.
2. Approve knowledge-retention governance.
3. Sign the temporary SameZone PostgreSQL HA exception.
4. Approve and run the persisted authenticated Knowledge Fabric chat UAT.
5. Rotate the n8n Butler LLM credential and run its two acceptance cases.

The machine-readable companion report is
`docs/uat/public-launch-readiness-20261020.json`. Re-run it with:

```powershell
.\scripts\check-public-launch-readiness.ps1 `
  -OutputPath docs/uat/public-launch-readiness-20261020.json
```

Do not mark the launch package complete until every human-required row above
has direct acceptance evidence.
