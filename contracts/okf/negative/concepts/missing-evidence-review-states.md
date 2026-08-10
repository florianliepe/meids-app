---
schema: okf.concept.v1
concept_id: cpt_negative_missing_evidence_review_states
twin_id: florian
title: Missing evidence review state fixture
type: Decision Principle
cluster: client-delivery
tags:
  - negative-fixture
review_state: pending-review
risk_class: medium
source_refs:
  - evidence/florian/uploads/2026-08-09-source-001.yaml
expected_failure: evidence_review_states missing for source_refs
---

## Claim
This fixture intentionally omits `evidence_review_states` although it has `source_refs`.

## Purpose
The OKF validator must reject it before vector refresh or trusted retrieval.
