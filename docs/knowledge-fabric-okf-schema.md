# MeIDs Knowledge Fabric OKF Schema

This document defines the durable knowledge contract for MeIDs. The app can run without hosted infrastructure, but every concept should be representable as portable Markdown with YAML frontmatter and mirrorable into database, vector, and graph stores later.

## Repository Split Target

| Repository | Responsibility | Public/Private Default |
| --- | --- | --- |
| `meids-app` | Static/frontend app, runtime contract fixtures, public documentation, UI artifacts. | Public-safe |
| `meids-knowledge-fabric` | OKF concepts, source evidence manifests, transcripts, graph relation candidates, review state, CRUD/audit exports. | Private by default |
| `meids-agent-configs` | n8n workflow contracts, agent prompts, skill specs, tool manifests, environment templates. | Private by default |

The app repo must not store private knowledge or secrets. It may store schemas, public-safe examples, and sync tooling.

Operational sync boundaries:

| Boundary | Source | Target | Review Gate |
| --- | --- | --- | --- |
| Public app release | `meids-app` static frontend and public fixtures | GitHub Pages, later hosted frontend/CDN | Branch review, Pages smoke check, no browser secrets |
| Knowledge fabric sync | Local MVP exports, approved OKF concepts, evidence manifests, transcripts, graph files, CRUD audit | `meids-knowledge-fabric` | Human-reviewed branch/PR before merge |
| Graph promotion sync | Human promotion decisions in `contracts/okf/promotions` or private equivalent | Knowledge fabric graph edge state | Candidate edges must be approved/rejected/reworked before trusted retrieval |
| Agent contract sync | n8n fixtures, prompts, skill specs, tool manifests | `meids-agent-configs` | Contract test, approval gate, no runtime secrets in repo |
| Retrieval refresh | Approved or selected pending OKF documents | Vector DB / graph projection via adapter or n8n | Adapter request review; credentials stay in hosted secret store |

Public-safe fixtures for this contract are stored in `contracts/okf/examples`.
Run `node scripts\validate-okf-fixtures.cjs` before changing the contract shape.
The deterministic local ingest mock is `node scripts\mock-okf-ingest.cjs`; it
converts `contracts/okf/ingest/sample-ingest-request.json` into generated OKF
concept, evidence, transcript, graph, audit, and vector-adapter payloads.

## Review States

Use one shared lifecycle across concepts, evidence, graph nodes, graph edges, and transcripts:

| State | Meaning | Retrieval Use |
| --- | --- | --- |
| `draft` | Created from upload, transcript, or agent output; not reviewed. | Hidden from trusted answers unless explicitly selected. |
| `candidate` | Structured enough for review; graph/vector candidates may be prepared. | Can appear as hypothesis with warning. |
| `pending-review` | Ready for human review. | Visible as untrusted context. |
| `approved` | Human-approved durable knowledge. | Trusted retrieval and graph use. |
| `needs-rework` | Human found gaps or ambiguity. | Visible in cockpit only. |
| `rejected` | Should not be used by the twin. | Excluded from retrieval. |
| `retired` | Previously approved but superseded. | Excluded unless audit history is requested. |

## Concept Markdown

Path pattern:

```text
concepts/{twin_id}/{cluster}/{yyyy-mm-dd}-{slug}.md
```

Frontmatter:

```yaml
---
schema: okf.concept.v1
concept_id: cpt_20260809_001
twin_id: florian
title: Client delivery steering principle
type: Decision Principle
cluster: client-delivery
tags:
  - stakeholder-urgency
  - delivery-steering
review_state: pending-review
risk_class: medium
source_refs:
  - evidence/florian/uploads/2026-08-09/source-001.yaml
  - transcripts/florian/2026-08-09/client-call.md
graph_refs:
  nodes:
    - node:concept/client-delivery
  edges:
    - edge:edge_20260809_001
vector_policy:
  index: selected_pending
  embedding_status: queued
provenance:
  created_by: knowledge_fabric_agent
  created_at: "2026-08-09T10:00:00Z"
  source_hash: sha256:example
  extraction_method: transcript_to_okf
review:
  required: true
  reviewer: null
  reviewed_at: null
  note: null
audit:
  last_action: create
  crud_log_ref: audit/florian/crud-log.jsonl
---
```

Body:

```markdown
## Claim
One concise statement the twin may later use.

## Context
Why this matters and when it applies.

## Evidence
- Link source references with short source anchors.

## Boundaries
- What this concept must not be used for.

## Open Questions
- Clarifications required before approval.
```

## Evidence Manifest

Path pattern:

```text
evidence/{twin_id}/{source_type}/{yyyy-mm-dd}-{slug}.yaml
```

```yaml
schema: okf.evidence.v1
evidence_id: ev_20260809_001
twin_id: florian
source_type: upload|transcript|email_export|calendar_export|teams_export|agent_output
review_state: pending-review
storage:
  repo_path: evidence/florian/uploads/2026-08-09/source-001.pdf
  mime_type: application/pdf
  sha256: example
anchors:
  - anchor_id: page-2-paragraph-4
    label: Scope decision
    excerpt_hash: sha256:example
privacy:
  pii_present: unknown
  sensitivity: internal
  retention: review_required
created_at: "2026-08-09T10:00:00Z"
```

Evidence `review_state` controls whether a source can support trusted answers:

- `draft` evidence can only support local review.
- `candidate` and `pending-review` evidence may appear as untrusted context.
- `approved` evidence can support trusted retrieval, graph promotion, and vector refresh.
- `needs-rework`, `rejected`, and `retired` evidence must not feed trusted answer generation.

## Transcript Markdown

Path pattern:

```text
transcripts/{twin_id}/{yyyy-mm-dd}-{slug}.md
```

```yaml
---
schema: okf.transcript.v1
transcript_id: tr_20260809_001
twin_id: florian
source_type: voice_capture
transcription_provider: openai|n8n|manual
review_state: draft
linked_concepts:
  - cpt_20260809_001
evidence_ref: evidence/florian/transcripts/2026-08-09/source-001.yaml
created_at: "2026-08-09T10:00:00Z"
---
```

## Graph Nodes

```yaml
schema: okf.graph_node.v1
node_key: concept/client-delivery
twin_id: florian
label: Client Delivery
node_type: cluster|concept|skill|task|person|project|risk|decision
review_state: approved
concept_refs:
  - concepts/florian/client-delivery/2026-08-09-client-delivery-steering.md
```

## Graph Edges

```yaml
schema: okf.graph_edge.v1
edge_key: edge_20260809_001
twin_id: florian
from: concept/client-delivery
to: concept/stakeholder-urgency
relation: supports|contradicts|requires|similar_to|causes|evidence_for|uses_skill
edge_class: explicit|inferred|candidate|duplicate-candidate|contradiction-candidate
review_state: candidate
confidence: 0.72
evidence_refs:
  - evidence/florian/uploads/2026-08-09/source-001.yaml#page-2-paragraph-4
promotion:
  proposed_by: graph_curator
  proposed_at: "2026-08-09T10:00:00Z"
  decision: pending
```

## Knowledge Fabric Agent Ingest Path

1. Receive upload, transcript, email export, calendar export, Teams export, or agent output.
2. Store evidence manifest and raw source reference.
3. Extract candidate OKF concept(s).
4. Write concepts as `draft` or `pending-review`.
5. Append CRUD/audit event.
6. Trigger Graph Curator to propose nodes and candidate edges.
7. Queue vector refresh only for `approved` or explicitly selected pending concepts.
8. Surface review tasks in the Review/Graph cockpit.

## Graph Relation Promotion

```text
draft -> candidate -> pending-review -> approved
                         |              |
                         v              v
                    needs-rework      rejected
```

Promotion rules:

- `explicit` edges require at least one evidence reference.
- `inferred` edges require confidence and rationale.
- `candidate` edges are never trusted retrieval facts until approved.
- `contradiction-candidate` edges should create a review task before answer use.

Human promotion decisions are represented as `okf.graph_promotion.v1` JSON files
in `contracts/okf/promotions`. Validate candidate-to-approved/rejected/rework
transitions with `node scripts\validate-graph-promotions.cjs`.

## Vector DB Adapter Boundary

No Azure/vector credentials are required for this repo. The adapter boundary is a
portable request contract that can be sent later to Azure AI Search, pgvector,
Qdrant, Pinecone, or an n8n-mediated vector workflow without changing OKF files.

The public app repo stores only synthetic vector request fixtures. It must not
store embeddings, private chunk text, provider API keys, or live index names.
Private deployments may replace `text` with `text_ref` when source text should
remain inside the knowledge fabric repo or hosted storage.

Adapter requests accept:

```json
{
  "operation": "upsert|delete|refresh_status",
  "twin_id": "florian",
  "source_policy": "approved_only|selected_pending",
  "documents": [
    {
      "concept_id": "cpt_20260809_001",
      "repo_path": "concepts/florian/client-delivery/2026-08-09-client-delivery-steering.md",
      "review_state": "approved",
      "text": "chunk text or pointer",
      "metadata": {
        "cluster": "client-delivery",
        "type": "Decision Principle",
        "evidence_refs": [],
        "evidence_review_states": []
      }
    }
  ]
}
```

Adapter responses must include `status`, `indexed_count`, `rejected_count`, `trace_id`, and `errors`.

Validation rules:

- `approved_only` requests may include only `approved` documents and `approved` evidence references.
- `selected_pending` requests may include `approved`, `pending-review`, or `candidate` documents and evidence references, but the caller must label them as untrusted context.
- `upsert` documents require either inline `text` or a `text_ref`.
- Every document requires `concept_id`, `repo_path`, `review_state`, `cluster`, `type`, `evidence_refs`, and one aligned `evidence_review_states` entry per evidence reference.
- Vector refresh is an adapter concern. It must not change OKF review states.

Validate the boundary with:

```powershell
node scripts\validate-vector-adapter.cjs
```

## Human Approval Boundary

The Knowledge Fabric Agent may create drafts and candidates. It must not mark concepts, edges, skills, or high-risk memory as `approved` without an explicit human review event.
