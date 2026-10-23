# Actor Twin Grounding and Answer Durability

Date: 2026-10-23

## Objective

The Actor Twin remains the only user-facing chat. It must answer personal and organizational questions from reviewed knowledge, preserve completed answers in the UI, and create a scoped post-answer trace for learning and audit.

## Routing policy

1. Direct answer: greetings, navigation, capability explanations, and clearly generic knowledge only.
2. Knowledge Fabric retrieval: every claim about the active twin's identity, biography, role, expertise, experience, preferences, decisions, processes, relationships, organization, or prior work.
3. Agentic Butler: work artifacts, approved skills, planning, synthesis, and tacit-knowledge interviews.
4. Critical Faculty: contradictions, weak evidence, high-impact recommendations, or hidden assumptions.
5. Learning Agent: detached post-turn processing from the persisted trace; routine answers do not wait for it.

## Grounding contract

- `grounded`: reviewed evidence supports the answer; include concept or source references.
- `partial`: answer only the supported portion; identify inference and unknowns.
- `not_found`: state that reviewed knowledge is unavailable and ask one targeted capture question.

Candidate, `review_needed`, `updated_review_needed`, stale, or contradictory records are not treated as established facts. The Actor Twin must not synthesize a plausible personal biography when evidence is absent.

## Answer durability

The embedded chat is no longer automatically destroyed when interaction settings or the scoped authorization token change. Settings become pending until the user selects **Apply context and reconnect**. The scoped token lifetime is one hour by default and may be configured up to eight hours.

The Actor workflow persists a post-answer trace through `/api/agents/post-answer`, then returns the unchanged Actor output. Trace persistence uses the signed knowledge token and enforces tenant, user, and assigned-twin scope. A failed trace write produces a degraded trace marker but does not replace the answer.

Azure App Service Easy Auth excludes only `/api/agents/post-answer` from platform-level login redirection so n8n can reach the transport endpoint. The backend still rejects requests without a valid signed, twin-scoped knowledge token. When Easy Auth is moved into Bicep, preserve this exclusion together with the complete existing Entra provider configuration; do not deploy a partial `authsettingsV2` resource.

## Speech-to-text boundary

The application reports voice transcription as ready only when an explicit transcription model is configured. A gateway API key or chat model is insufficient. The Eraneos AI Gateway catalogue checked on 2026-10-23 exposed no speech-to-text model, so direct audio transcription remains blocked until a governed STT model or endpoint is enabled. Pasted transcripts continue through the same Persona Modeler and review-needed knowledge flow.

## Acceptance gates

- A self-description request invokes Knowledge Fabric before the final answer.
- Missing reviewed evidence produces `not_found`, not invented biography.
- The answer remains visible after token refresh and setup changes.
- The n8n execution contains `Persist post-answer trace` and `Preserve Actor answer`.
- The backend trace is scoped to the authenticated user's assigned twin.
- Voice readiness is blocked when no explicit supported STT model exists.
