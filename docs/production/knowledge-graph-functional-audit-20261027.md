# Knowledge graph functional audit - 2026-10-27

## Scope

This audit covers governed OKF creation, PostgreSQL persistence, the transactional outbox, Blob and Azure AI Search projection, runtime graph creation, graph review, and n8n agent routing. Production data was inspected read-only. New automated checks use synthetic fixtures and do not approve knowledge or graph relations.

## Verified architecture

1. PostgreSQL is the system of record for concepts, immutable revisions, evidence, chunks, review state, learning increments, and outbox events.
2. Blob Storage holds revision artifacts produced by the outbox worker.
3. Azure AI Search contains derived working and approved projections. It is not the system of record.
4. The knowledge graph is currently a request-time projection over scoped OKF concepts. It derives:
   - explicit relations from `content.relations`;
   - inferred candidates from shared governed evidence;
   - candidates from shared tags and bounded lexical overlap;
   - semantic candidates from persisted duplicate-check score evidence.
5. Graph review decisions are audit events keyed by a deterministic edge key. Candidate relations remain untrusted until human acceptance.
6. Actor Twin calls callable n8n workflows. The callable Knowledge Fabric target is `dUkrCHpkLmqmFc7I`; the callable Butler target is `elbiGicaFmQQW4w8`. Public webhook workflows remain separate integration surfaces.

## Confirmed defects and mitigations

### KG-01: Hybrid Search score used as vector similarity

**Severity:** High

Azure AI Search returns an RRF score for hybrid queries. The duplicate classifier treated `@search.score` as direct semantic similarity. This can produce false decisions or thresholds that are meaningless across retrieval modes.

**Mitigation:** Duplicate detection now requests a pure vector result set, converts Azure's cosine search score to cosine similarity, and records the raw score separately. Normal Actor Twin retrieval remains hybrid plus semantic ranking.

### KG-02: Vector-only strong duplicate decisions

**Severity:** High

Live evidence showed unrelated UAT concepts classified as `strong_duplicate` with vector scores around 0.91-0.93 and lexical overlap around 0.15-0.21.

**Mitigation:** A strong duplicate now requires compatible scope and either:

- vector similarity >= 0.88 plus lexical overlap >= 0.35; or
- lexical overlap >= 0.80.

A vector score can still create a reviewable related or near-match candidate. It cannot alone trigger a strong duplicate action.

### KG-03: Semantic score evidence not projected into the graph

**Severity:** Medium

Duplicate-check evidence was persisted inside OKF evidence records but ignored by graph creation.

**Mitigation:** `merge_candidate_score` evidence now produces a `semantic-duplicate-check` candidate edge with score evidence, provenance, and rationale. It never creates an approved relation automatically.

### KG-04: Default organization fallback

**Severity:** High

The duplicate-check route could fall back to organization `default`, weakening tenant-boundary diagnostics and potentially querying the wrong scope.

**Mitigation:** Duplicate checks now require an authenticated tenant or explicit organization ID. Missing scope returns HTTP 400.

## Functional evidence

- Backend contract suite: passed.
- Agent and n8n contract suite: passed.
- Graph node detail contract: passed.
- Azure Search contract: passed.
- New duplicate-classification regression: passed.
- New semantic-edge projection regression: passed.
- Live graph before deployment: 19 nodes, 35 candidate edges, 4 approved concepts, 15 pending-review concepts, no explicit or inferred approved edges.
- Live n8n: Actor Twin, callable Knowledge Fabric, callable Butler, Skill Orchestrator, Task Agent, Critical Faculty, Learning Agent, and Knowledge Retrieval Interviewer are active.

## Hard-coded production values

| Value | Current use | Decision |
| --- | --- | --- |
| n8n workflow IDs | scripts, validators, workflow-tool nodes | Replace script constants with an environment-backed workflow registry; tool node IDs remain deployment bindings and must be checked by a live topology test. |
| Backend URLs in n8n HTTP nodes | Knowledge Fabric and post-answer trace | Replace with n8n environment variables when the hosted n8n plan supports them; until then, validate exact targets during deployment. |
| Search API version `2025-09-01` | App Service and runtime default | Keep pinned, document upgrade tests, and avoid silent latest-version adoption. |
| Embedding dimension `1536` | Search schema and App Service | Keep only while the gateway explicitly returns 1536 dimensions; store model and dimension on every projection. |
| Static semantic-production status asset | frontend status display | Treat as deployment evidence, not a runtime health signal. Runtime health must come from the protected backend status endpoint. |
| organization `default` fallbacks | generic vector helpers | Remove from authenticated production call paths; retain only in isolated fixture helpers where asserted. |

## Open production hardening

### P0: Durable graph candidate identity

Apply the existing graph projection contract as a real migration or replace it with an equivalent normalized schema. Store tenant, twin, source and target revision, relation type, model/provider, embedding dimension, prompt/rule version, confidence, provenance, evidence references, review state, and validity interval. Audit events should reference a durable edge candidate rather than being the only review store.

### P0: Semantic relation proposal pipeline

Create an asynchronous relation proposer after successful Search projection:

1. Retrieve top-k same-scope neighbors using a pure vector query.
2. Apply minimum lexical or shared-evidence corroboration.
3. Ask a constrained relation classifier only for ontology labels such as `supports`, `contradicts`, `requires`, `causes`, `derived_from`, or `similar_to`.
4. Require quoted evidence spans and source revisions for directional claims.
5. Persist only candidates; no LLM or vector score may approve an edge.
6. Re-evaluate candidates after source revision, model change, or permission change.

### P1: Projection reconciliation

Add a scheduled comparison of PostgreSQL current/approved revisions against working/approved Search documents and Blob URIs. Track projection lag, dead-letter events, stale Search records, missing vectors, and orphaned graph targets.

### P1: Evaluation corpus and thresholds

Build a reviewed multilingual corpus containing true duplicates, paraphrases, related-but-distinct concepts, contradictions, and unrelated records. Calibrate thresholds per embedding model and retrieval mode. Version the corpus, model, dimensions, chunking strategy, and threshold set.

### P1: Isolation and replay tests

Run the same concept text under two users, twins, and tenants. Verify that ingest, Search, graph traversal, duplicate detection, edge review, and agent retrieval never cross unauthorized scope. Add duplicate callback, stale callback, and out-of-order outbox tests.

## Feedback loop

1. Persist every candidate with immutable source revisions and score provenance.
2. Capture reviewer accept, reject, relabel, and merge decisions.
3. Evaluate precision and recall by relation type and scope before threshold changes.
4. Promote a new model or threshold only when the versioned evaluation passes and Search can be rebuilt safely.
5. Reopen the corresponding issue when a deployed revision fails a current probe; historical UAT is not release evidence.

## Go/no-go rule

Public launch requires tenant/twin isolation, atomic record plus outbox persistence, recoverable projection, review-gated graph relations, and exact deployed-revision evidence. Semantic relation quality may remain advisory, but it must not perform irreversible merges or create trusted relations without review.
