---
schema: okf.concept.v1
concept_id: cpt_ing_example_001
twin_id: florian
title: Prepare client alignment before status update
type: Decision Principle
cluster: client-delivery
tags:
  - client alignment
  - decision options
  - status update
review_state: pending-review
risk_class: medium
source_refs:
  - evidence/florian/transcripts/2026-08-09-prepare-client-alignment-before-status-update.yaml
  - transcripts/florian/2026-08-09-prepare-client-alignment-before-status-update.md
graph_refs:
  nodes:
    - node:concept/client-delivery
    - node:concept/decision-preparation
  edges:
    - edge:edge_ing_example_001
vector_policy:
  index: selected_pending
  embedding_status: queued
provenance:
  created_by: knowledge_fabric_agent
  created_at: "2026-08-09T12:00:00Z"
  source_hash: sha256:e39f5e3f473b78a3c5677d8e47f0cb7be8af73e4ea31247d4a277066481b8ca4
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
When a client alignment meeting has unresolved decisions, prepare decision options and risks before drafting status communication.

## Context
Use for daily planning, client delivery steering, and meeting preparation.

## Evidence
- `evidence/florian/transcripts/2026-08-09-prepare-client-alignment-before-status-update.yaml#source-claim`

## Boundaries
- Do not send external communication without human approval.
- Do not invent delivery commitments, owners, or deadlines.

## Application Cues
- client alignment
- decision options
- status update
