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

The durable schema contract is documented in `docs/knowledge-fabric-okf-schema.md`.
