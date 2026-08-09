---
schema: okf.concept.v1
concept_id: cpt_example_001
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
  - evidence/florian/uploads/2026-08-09-source-001.yaml
  - transcripts/florian/2026-08-09-client-call.md
graph_refs:
  nodes:
    - node:concept/client-delivery
  edges:
    - edge:edge_example_001
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

## Claim
When a client delivery topic contains stakeholder urgency and unresolved decisions, the twin should prioritize explicit decision preparation before status reporting.

## Context
Use this when preparing a daily plan, meeting brief, or client steering summary.

## Evidence
- `evidence/florian/uploads/2026-08-09-source-001.yaml#page-2-paragraph-4`

## Boundaries
- Do not infer delivery commitments without source evidence.
- Escalate before sending external messages or scheduling meetings.

## Application Cues
- Client alignment
- Urgent decision
- Delivery steering
