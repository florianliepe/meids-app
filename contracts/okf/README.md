# OKF Contract Fixtures

Public-safe fixtures for the MeIDs Knowledge Fabric contract.

These examples are intentionally synthetic. They prove the file shape for:

- concepts
- evidence manifests
- transcripts
- graph nodes
- graph edges
- CRUD/audit events
- vector adapter requests

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

The vector adapter validator also checks negative fixtures in
`contracts/okf/negative/vector`. These fixtures must fail for their declared
reason, proving rejected or needs-rework evidence cannot enter vector refresh.

The durable schema contract is documented in `docs/knowledge-fabric-okf-schema.md`.
