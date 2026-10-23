# PPTX and Bulk Upload Zielmodus

Date: 2026-10-23

## Goal

Support PowerPoint presentations created on macOS and make multi-document intake efficient without turning the Node.js App Service into a large-upload buffer.

## Decisions

1. `.pptx` is the canonical PowerPoint format on Mac and Windows and is parsed directly.
2. Apple Keynote `.key` files must be exported to `.pptx` or PDF. Legacy `.ppt` files must be saved as `.pptx`.
3. Each document is limited to 25 MB. A browser-selected batch is limited to 100 MB.
4. The frontend sends one authenticated request per file, sequentially. There is no 100 MB multipart request.
5. A failed file does not roll back or hide successful files; every result remains visible.
6. Every successfully extracted document enters Knowledge Fabric as a separate `review_needed` concept.
7. Audio is not included in document batches. Each audio transcript requires its own circular quality interview.

## PPTX Extraction Boundary

The backend opens PPTX as an OOXML ZIP archive, selects only slide and speaker-note XML parts, parses XML without executing macros or embedded content, and preserves slide order. Images, video, embedded files, and active content are ignored. Expanded slide XML is capped before extraction to reduce archive-expansion risk.

## Capacity Model

| Boundary | Limit | Reason |
| --- | ---: | --- |
| Individual document | 25 MB | Predictable memory and parser cost per request |
| Selected browser batch | 100 MB | Useful bulk intake without a single large request |
| Extracted knowledge text | 100,000 characters | Existing OKF ingestion and model-context boundary |
| Expanded PPTX slide/note XML | 5,000,000 characters | Archive-expansion guardrail |

For larger migrations, use private Blob Storage plus an asynchronous queue/worker. Raising the synchronous App Service request buffer to 100 MB is intentionally rejected because the current multipart reader holds each request in memory.

## UAT

1. Upload a PowerPoint for Mac `.pptx` containing slide text and speaker notes.
2. Verify the pending concept includes ordered `[Slide n]` and `[Notes n]` sections.
3. Select a mixed batch containing TXT, PDF, DOCX, and PPTX files.
4. Verify files process sequentially and each successful item creates an independent review record.
5. Include one invalid `.key` or `.ppt` file and verify the batch is rejected before upload with export guidance.
6. Verify a file over 25 MB and a combined batch over 100 MB are rejected client-side.
7. Verify an unauthenticated request is rejected before its multipart body is read.
