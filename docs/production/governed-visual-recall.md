# Governed Visual Recall

## Purpose

Me.IDs stores original visual sources as private evidence without exposing Azure Blob URLs or bypassing knowledge review. A visual is not automatically trusted knowledge. Upload creates a review-needed knowledge concept, provenance metadata, and a private source artifact linked by concept ID.

## Storage and authorization

- Binary content is stored in the private `source-artifacts` container of `stmeidsprod1853a19b`.
- PostgreSQL `knowledge.source_artifact` is the metadata and row-level authorization authority.
- The backend App Service managed identity is the only storage caller and already holds `Storage Blob Data Contributor` on the production account.
- Blob public access is disabled. The frontend receives an authenticated backend recall route, never a Blob URI or SAS token.
- Owners and reviewers may inspect pending evidence. Ordinary recall requires the artifact to be approved.
- Approving or rejecting the linked knowledge concept cascades the artifact review state and writes an audit event.

## Intake guardrails

- Accepted formats: PNG, JPEG, WebP and GIF.
- Maximum visual size: 25 MB.
- Extension, media family and binary file signature must agree.
- SVG and executable/active document formats are not accepted by this route.
- SHA-256, filename, media type, byte count, consent scope and source timestamp are retained as provenance.
- If metadata persistence fails after knowledge staging, the private Blob is deleted and the concept is marked `needs_rework` with an audit event.

## Recall flow

1. The user uploads a visual and supplies optional context.
2. The backend writes the binary to private Blob and stages a review-needed concept.
3. The review drawer shows the source through `/api/artifacts/content` with private, no-store and nosniff response headers.
4. A reviewer corrects or reviews the linked concept and approves or rejects it.
5. Approved visuals can be recalled by authorized users of the same twin; rejected visuals remain non-recallable to ordinary users.

## Deployment order

1. Apply `018_governed_visual_artifacts.sql` with the Entra PostgreSQL administrator path.
2. Deploy the backend and frontend through the protected main pipeline.
3. Upload a synthetic tiny PNG and verify pending owner recall.
4. Verify an unauthorized user cannot list or recall the artifact.
5. Approve the linked synthetic concept and verify authorized recall, SHA-256 and media type.
6. Reject/archive the synthetic record after evidence capture.
7. Enable and verify Defender for Storage malware scanning before broad external intake; keep review gating as a separate content-governance control.

## Explicit non-goals

- No OCR or image understanding is performed in this package.
- No visual is injected directly into Actor Twin context.
- No public container, permanent SAS URL or binary PostgreSQL column is introduced.
- No cross-tenant or implicit group sharing is inferred from a filename or prompt.
