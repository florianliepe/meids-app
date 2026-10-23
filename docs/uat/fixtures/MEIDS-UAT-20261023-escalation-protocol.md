# MEIDS-UAT-20261023: Evidence escalation protocol

## Topic and purpose

This synthetic UAT concept defines when an evidence gap must be escalated before a decision is released. Its purpose is to prevent confident recommendations from being based on incomplete or stale evidence.

## Wider context and rationale

Use the protocol for decisions that affect a customer commitment, production access, regulated data, or a release gate. A decision may proceed only when the owner, evidence source, freshness date, and expected consequence are explicit. This protects auditability and makes uncertainty visible.

## How to apply

1. State the decision and the reversible or irreversible consequence.
2. Name the accountable decision owner and the evidence owner.
3. Check whether at least two independent evidence signals support the decision.
4. Check that each source is current enough for the decision horizon.
5. If an owner is missing, evidence conflicts, or a source is stale, pause the release and escalate to the accountable decision owner.
6. Record the missing evidence, the person who will obtain it, and a review date.
7. Resume only after the gap is closed or the accountable owner explicitly accepts the residual risk.

## Responsibilities and relationships

The decision owner accepts or rejects residual risk. The evidence owner obtains and documents sources. The reviewer challenges assumptions and confirms that the decision criteria are met. The Actor Twin may summarize and route the case, but it must not silently accept the risk.

## What else to know

A single source is acceptable only for a reversible, low-impact decision and must be labelled as a weak-evidence exception. Conflicting sources are not averaged; the conflict is made explicit and investigated. Missing evidence is a decision input, not proof that an assumption is false.

## Implications and expected results

When the protocol is applied, releases with unresolved material evidence gaps remain paused. The expected result is a traceable decision record containing the owner, sources, unresolved uncertainty, review date, and final disposition.

UAT marker: `MEIDS-UAT-20261023-ESCALATION`
