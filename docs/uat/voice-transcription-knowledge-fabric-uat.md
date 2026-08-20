# Voice Transcription to Knowledge Fabric UAT

## Purpose

Validate the static GitHub Pages voice path:

1. record audio in Voice Capture
2. send audio to a hosted n8n transcription proxy
3. receive transcript in the Persona Modeler conversation
4. clarify until the concept is ready
5. save the concept
6. stage the saved concept as a pending Knowledge Fabric OKF handoff

## Preconditions

- n8n workflow `Me.IDs Voice Transcription - Eraneos Gateway` is imported and published.
- n8n stores the Eraneos AI Gateway key server-side.
- GitHub repository secret `GH_PAGES_VOICE_TRANSCRIPTION_URL` contains the published n8n webhook URL.
- GitHub Pages deployment was rebuilt after the secret was added.
- Browser microphone permission is granted.

## Test Cases

| ID | Step | Expected result |
|---|---|---|
| VT-01 | Open GitHub Pages and navigate to `Voice Capture`. | The setup warning says transcription is available through hosted proxy or backend. |
| VT-02 | Record a short spoken thought and stop recording. | Audio preview is playable in the browser. |
| VT-03 | Click `Transcribe and start conversation`. | Transcript appears in Concept Conversation. No `OPENAI_API_KEY missing` message appears. |
| VT-04 | Answer the Persona Modeler clarification question. | Assessment updates and Save Concept becomes available when ready. |
| VT-05 | Click `Save concept`. | Concept saved message appears with evidence path and category credited. |
| VT-06 | Open Knowledge or Review cockpit. | A pending OKF handoff from `Guided Voice Capture` is visible. |
| VT-07 | Inspect the handoff. | Review state is pending-review, graph curator is queued, vector refresh is deferred until approval. |

## Failure Triage

- `404` or `405` on `/api/voice/concepts/transcribe`: GitHub Pages artifact was built without `GH_PAGES_VOICE_TRANSCRIPTION_URL`.
- `401` or `403` from n8n proxy: Eraneos gateway key or credential is not configured in n8n.
- `No audio binary field received`: n8n webhook did not receive multipart field `file`; check webhook binary settings.
- Transcript response has no text: adjust the n8n normalize node for the actual gateway response field.
- Concept saves but no Knowledge Fabric handoff: check browser localStorage and the Knowledge Fabric queue panel.

## Production Boundary

This UAT path stages Knowledge Fabric handoff data in browser-local storage when running on static GitHub Pages. Shared persistence still requires the hosted backend with repository/Postgres write access.
