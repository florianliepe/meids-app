# Audio Source Upload: Zielmodus and Decision Log

Date: 2026-10-23

## Goal

Allow an authorized user to upload an audio document in Source Upload, transcribe it through the existing server-side Eraneos/OpenAI-compatible transcription configuration, and continue through the same circular interview and Knowledge Fabric review path used by live Voice Capture.

## Zielmodus

1. Accept `MP3`, `MP4`, `MPEG`, `MPGA`, `M4A`, `WAV`, and `WebM` up to 25 MB.
2. Require Entra mapping, knowledge access, tenant scope, and ownership of the selected twin before transcription.
3. Require the user to confirm authorization to process the recording.
4. Treat the transcript as untrusted evidence, not as executable instructions or approved knowledge.
5. Run the existing What/How/Why/Who/What-then circular interview after transcription.
6. Create an OKF only after the quality gate passes, and persist it as `review_needed` through the existing Knowledge Fabric path.
7. Keep Actor Twin as the only user-facing agent. Any optional agent handoff still enters Actor Twin and uses `Call n8n Workflow Tool` delegation.

## Decision Log

### Supported Apple formats

M4A is the standard upload path for Apple Voice Memos and is included. AIFF and raw AAC are rejected with guidance to convert to M4A or WAV. The production contract intentionally uses the format intersection documented for Azure/OpenAI-compatible speech-to-text gateways rather than promising provider-dependent formats.

### Persistence boundary

The backend no longer writes clear-text transcription evidence to local App Service storage. It writes a scoped audit record containing source metadata plus audio and transcript SHA-256 hashes. The transcript is persisted only when the user saves a draft or passes the quality gate and stages a concept in PostgreSQL.

### Knowledge boundary

Transcription does not create approved knowledge. The transcript enters the existing Knowledge Retrieval Agent circular interview. A successful commit creates a review-needed audio-document concept and uses the existing duplicate, review, graph, and Search synchronization path.

### Agent routing

No new direct frontend-to-subagent route is introduced. The quality loop is the existing Knowledge Retrieval Agent contract. Optional prepared handoffs use Actor Twin as routing authority and n8n workflow-tool delegation to Knowledge Fabric.

## Weak Spots and Mitigations

| Weak spot | Mitigation |
| --- | --- |
| Recording includes people without permission | Explicit authorization checkbox; organization policy remains the legal control. |
| Incorrect names, speakers, or decisions | No diarization claim; the UI requires human clarification and review. |
| Prompt injection in spoken content | Transcript is evidence, not an instruction; no automatic side effect is triggered. |
| Long meetings exceed synchronous limits | 25 MB hard limit. Larger or batch jobs require a later asynchronous Blob/queue worker. |
| Provider rejects filenames with non-ASCII characters | Preserve the normalized original name in audit metadata, but send a safe ASCII filename to the gateway. |
| App Service local disk is transient and privacy-sensitive | Do not persist raw audio or transcript on local disk. |
| Duplicate concepts | Reuse Knowledge Fabric staging and its duplicate/merge scoring before review promotion. |

## UAT

1. Sign in as an active user and select an owned twin.
2. Open Source Upload and choose a short M4A file from Apple Voice Memos.
3. Confirm authorization and start transcription.
4. Verify that the UI opens Voice Capture with the transcript and first circular question.
5. Answer until the quality gate is ready, then save.
6. Verify the concept appears in Knowledge/Review as `review_needed`, with source type `audio_document_transcript`.
7. Reject or approve the test record after evidence capture.
8. Repeat with MP3 and WebM; verify AIFF, AAC, and files over 25 MB are rejected before provider submission.

## Deferred Production Extension

For files beyond the synchronous 25 MB contract, upload encrypted audio to private Blob Storage, enqueue a transcription job, delete or lifecycle-expire the audio after transcription, and notify the user when the circular interview is ready. This is intentionally outside the current lean frontend path.
