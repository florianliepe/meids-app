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
| Production embedding implementation | Complete | `backend/azureSearch.js` uses the OpenAI-compatible Eraneos AI Gateway, keeps credentials server-side, and enforces 1,536 dimensions | None |
| Production semantic embedding UAT | Complete | `docs/uat/production-semantic-embedding-uat-20261021.json`: governed ingest, hybrid semantic retrieval, complete rebuild, and cleanup passed | None |
| n8n publication recovery | Complete | Actor `eKI3qM7nyCNn9r1q` and Knowledge Fabric `7Ci86PxXipwvYpKv` remain active; Actor now targets corrected callable Butler `tK8c6ZN89IpMRulz` | None |
| Explicit n8n identity propagation | Complete | Actor forwards `query`, signed access token, tenant, user, twin, and organization; callable triggers expose matching typed fields; canonical and live workflow checks pass | None |
| Knowledge Fabric response sanitization | Complete | Execution `33062` returned no `knowledge_access_token`, `content_vector`, or `query_vector`; sanitized evidence is in `docs/uat/authenticated-knowledge-fabric-uat-20261020.json` | None |
| Search private networking | Complete | `srch-meids-prod-1853a19b` is running, local auth disabled, public access disabled, and private endpoint `10.42.3.4` is active | None |
| Storage private networking | Complete | `stmeidsprod1853a19b` has public access disabled, default deny, shared-key access disabled, and private endpoint `10.42.3.5` | None |
| Legacy Search public-surface closure | Complete | `srch-intellectual-twin` public network access is disabled | None |
| Knowledge retention technical defaults | Complete | Blob versioning and soft delete are active; lifecycle deletes only disposable quarantine/export data and non-current working/source/learning versions; approved knowledge has no destructive lifecycle rule | None |
| Knowledge retention governance | Accepted for launch | Florian Liepe approved the launch schedule in `docs/production/knowledge-retention-policy-template.md` on 2026-10-21 | Complete enterprise Legal/Records and Security policy alignment before external customer production use |
| PostgreSQL private service and resilience | Complete with exception | `psql-meids-prod-1853a19b` is Ready, public access disabled, SameZone HA healthy, standby zone 1, 35-day retention, and geo backup enabled; point-in-time restore drill passed | None for current configuration |
| Zone-redundant PostgreSQL HA | Accepted exception | Florian Liepe accepted SameZone HA through 2027-01-21 with 35-day retention, geo backup, and the passed restore drill | Recheck Azure capacity quarterly; adopt zone-redundant HA when available |
| PostgreSQL-to-Search rebuild | Complete for current rows | Five source rows rebuilt without deferral; managed-identity Search queries returned approved and working documents | Repeat after semantic embeddings are activated |
| Tenant/user isolation | Complete | Signed private scope returned the assigned working candidates; a negative user probe returned zero | None |
| Azure backend deployment | Complete | GitHub Actions run `39446482213` passed OIDC sign-in, validation, deployment, and App Service state verification | None |
| Azure frontend deployment | Complete | Azure Static Web Apps run `39446483047` passed; authenticated API routes redirect unauthenticated users to `/login` | None |
| GitHub Pages sandbox deployment | Complete | GitHub Pages run `39446483102` passed | None |
| Repository secret exposure | Complete | GitHub secret scanning has zero open alerts; tracked-source pattern scan found no credential material | None |
| Authenticated Knowledge Fabric chat UAT | Complete | Actor execution `33061` and Knowledge Fabric execution `33062` staged exactly one authenticated `review_needed` concept; the approved cleanup rejected revision `1` and confirmed Search exclusion | None |
| Agentic Butler normal/new-skill UAT | Complete | `docs/uat/agentic-butler-uat-20261021.json`: normal execution `33256`; approval-gated proposal `33253` | None |

## Current verdict

The automated infrastructure, deployment, publication, private-networking,
semantic-retrieval, and contract-validation scope is complete. All twelve
machine-verifiable launch gates pass. Formal Legal/Records and Security
alignment remains a governance precondition before external customer
production use.

The machine-readable companion report is
`docs/uat/public-launch-readiness-20261021.json`. Re-run it with:

```powershell
.\scripts\check-public-launch-readiness.ps1 `
  -OutputPath docs/uat/public-launch-readiness-20261021.json
```

Do not mark the launch package complete until every human-required row above
has direct acceptance evidence.
