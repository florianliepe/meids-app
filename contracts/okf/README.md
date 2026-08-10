# OKF Contract Fixtures

Public-safe fixtures for the MeIDs Knowledge Fabric contract.

These examples are intentionally synthetic. They prove the file shape for:

- concepts
- evidence manifests
- transcripts
- graph nodes
- graph edges
- Postgres graph projection schema
- CRUD/audit events
- vector adapter requests
- OKF + graph repo-sync packages

Validate them with:

```powershell
node scripts\validate-okf-fixtures.cjs
```

Regenerate the synthetic Knowledge Fabric ingest output with:

```powershell
node scripts\mock-okf-ingest.cjs
```

Validate graph relation promotion decisions with:

```powershell
node scripts\validate-graph-promotions.cjs
```

Validate vector adapter request fixtures with:

```powershell
node scripts\validate-vector-adapter.cjs
```

Validate the hosted graph projection schema boundary with:

```powershell
node scripts\validate-postgres-graph-schema.cjs
```

The vector adapter validator also checks negative fixtures in
`contracts/okf/negative/vector`. These fixtures must fail for their declared
reason, proving rejected or needs-rework evidence cannot enter vector refresh.

The OKF fixture validator also checks negative concept fixtures in
`contracts/okf/negative/concepts`. These fixtures must fail for their declared
reason, proving source-linked concepts cannot omit aligned
`evidence_review_states`.

The repo-sync package fixture in `contracts/okf/repo-sync` proves the combined
OKF handoff + graph promotion export shape. It must keep knowledge repository
application human-reviewed and defer vector refresh until after the reviewed
knowledge repo merge.

The durable schema contract is documented in `docs/knowledge-fabric-okf-schema.md`.
