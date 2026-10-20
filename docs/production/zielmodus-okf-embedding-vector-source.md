# Zielmodus: OKF Embedding Vector Source

## Target

Ingested OKF documents must reach Azure AI Search with a valid
`content_vector`.

## Build Order

1. Keep Azure OpenAI embeddings as the production vector source.
2. Preserve caller-supplied `content_vector` values when they are present.
3. Enable deterministic fallback vectors only for UAT environments by setting
   `MEIDS_ALLOW_DETERMINISTIC_VECTORS=true` and sending
   `vector_mode=deterministic_fallback` or
   `allow_deterministic_vectors=true`.
4. Use deterministic query vectors for UAT search/duplicate-check only when the
   same fallback is enabled.
5. Return the active vector provider in `/api/vector-index/rebuild` responses.
6. Verify backend contracts and live hosted upsert/search probes.

## Boundary

Deterministic vectors are not semantic embeddings. They are valid for proving
workflow plumbing, Azure Search writes, and duplicate-check execution. They are
not valid for production relevance thresholds or SLO decisions.

## Acceptance

- `npm run check:backend` passes.
- Hosted `/api/vector-index/status` reports Azure Search configured.
- Hosted `/api/vector-index/rebuild` accepts OKF documents without
  `content_vector` when deterministic fallback is explicitly enabled.
- Response includes `embedding.provider`.
- Duplicate-check can retrieve the newly upserted OKF document with
  `retrieval_mode=hybrid_deterministic_vector_keyword` in UAT.
