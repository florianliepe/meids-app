# Zielmodus: UAT Intake, Review and Actor Interaction Hardening

Date: 2026-10-30

## Objective

Close the confirmed UAT defects across voice intake, human knowledge review, skill latency and the Actor Twin interaction surface without changing tenant isolation, n8n agent hierarchy, approval semantics or approved production data.

## Execution order

1. Add the missing voice-draft delete and duplicate-resolution API routes with tenant, user and twin scoping.
2. Preserve the provider transcript as evidence while allowing a user-corrected working transcript before assessment and save.
3. End a circular-question dimension after the same semantic question has been asked twice.
4. Render the structured OKF content in review and save human corrections as a new review-needed revision.
5. Remove manual MCP routing from the normal frontend. Approved concepts route through the existing Knowledge Fabric outbox.
6. Bound approved-skill foreground orchestration to 90 seconds by default, while retaining durable job status and the n8n execution trace.
7. Add Actor Twin voice input and single-source intake. Keep bulk intake in Source Upload and require explicit confirmation before staging a source.
8. Move trace entry points into Review/Production, collapse advanced readiness views, and expand the Graph V2 canvas without changing graph requests or semantics.
9. Run syntax, contract, backend, graph and browser regression checks. Promote only through a protected pull request after all required checks pass.

## Decisions

| Decision | Reason | Consequence |
| --- | --- | --- |
| Corrections create revisions | Human correction must not rewrite provenance or approved history. | Corrected concepts return to review-needed/updated state. |
| Original transcript remains immutable evidence | Speech-to-text errors are expected and must be auditable. | Actor use is based on corrected text after review; the original remains in concept metadata. |
| Two repeated semantic questions close that dimension | A circular interview must not trap users on short but valid answers such as “nobody else”. | The quality gate can progress while other missing dimensions remain enforced. |
| No manual MCP controls for end users | MCP is an implementation mechanism, not a user decision. | Approval writes the promotion/outbox event; operators retain diagnostics outside the default flow. |
| Actor Twin accepts one source; Source Upload owns bulk | Chat convenience is useful, but ingestion and chat must not become an accidental write path. | A file is staged only after confirmation and remains unusable for trusted retrieval until review. |
| Visual artifacts need private Blob storage | The current upload path extracts text and does not retain original binaries. Storing images in PostgreSQL JSON would be unsafe and expensive. | PNG/JPEG/diagram recall is deferred to a dedicated Blob artifact package with a governed reference, optional OCR and authorized download. |
| Skill foreground budget is 90 seconds | A five-minute wait is not acceptable for an interactive surface. | The durable job ledger remains authoritative; a timeout returns a bounded fallback and trace rather than blocking the UI. |

## Acceptance gates

- Voice drafts can be deleted and duplicate groups resolved without 404 responses.
- Corrected transcript text is reassessed and saved; original evidence remains available.
- A repeated `who` question cannot create an infinite clarification loop.
- Knowledge review shows topic, purpose, context, application, additional knowledge, implications and summary.
- A corrected concept is saved as a new revision and requires review again.
- No manual MCP routing button appears in the normal Voice or Review flow.
- Skill orchestration returns a timeout fallback by 90 seconds unless a lower configured boundary applies.
- Actor Twin microphone input transcribes into the embedded n8n chat; document intake requires confirmation.
- Existing graph, authorization, API parity and agent hierarchy checks remain green.
- Production promotion occurs only after protected CI passes; no real production record is modified by synthetic validation.

## Deferred production package: governed visual assets

1. Upload original image/diagram to private Azure Blob quarantine using managed identity.
2. Store a PostgreSQL artifact record with tenant, owner, twin, checksum, MIME type, consent and Blob path.
3. Generate OCR/caption/thumbnail asynchronously and stage extracted knowledge as review-needed.
4. Link approved concepts to the artifact without embedding binary data into Search or PostgreSQL JSON.
5. Return short-lived authorized download URLs only after RLS-equivalent access validation.
6. Add PNG, JPEG, WebP, SVG/PDF diagram, retention, malware scan and guest-isolation UAT.
