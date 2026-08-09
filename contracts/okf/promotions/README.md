# Graph Relation Promotion Fixtures

These fixtures define human-review decisions for candidate graph edges.

Allowed decisions:

- `approve`: promotes a candidate edge to trusted graph use.
- `reject`: excludes the edge from retrieval and graph reasoning.
- `needs-rework`: keeps the edge out of trusted use and requests clarification.

Validate with:

```powershell
node scripts\validate-graph-promotions.cjs
```
