# Voice Transcription via Eraneos AI Gateway

## Boundary

Speech-to-text uses a backend-only OpenAI-compatible transcription call. The Eraneos AI Gateway key must never be committed, pasted into `frontend/runtime-config.js`, stored in browser localStorage, or exposed through GitHub Pages.

GitHub Pages can record audio and support pasted transcripts. Direct transcription requires either:

- local backend: `node backend/server.js`
- hosted backend: Azure App Service or equivalent backend with environment variables
- hosted transcription proxy: n8n webhook or backend endpoint that keeps the Eraneos/OpenAI key server-side

## Local Setup

1. Reveal or rotate the key in the Eraneos AI Gateway portal:
   `https://ai-gateway.eraneos.com/portal/keys`

2. Create a local `.env` from the template:

```powershell
cd "C:\Users\e729958\Downloads\MeIDs-public-app-sanitized-20260806-01\meids-app-clean-ziel-20260817"
Copy-Item .env.example .env
notepad .env
```

3. Add backend-only values:

```powershell
OPENAI_API_KEY=<paste gateway key locally>
OPENAI_BASE_URL=<OpenAI-compatible Eraneos gateway base URL ending before /audio/transcriptions>
OPENAI_TRANSCRIPTION_MODEL=<gateway transcription model alias>
```

If the gateway exposes standard OpenAI-compatible routes, the backend calls:

```text
POST {OPENAI_BASE_URL}/audio/transcriptions
```

4. Start the backend with those environment variables loaded.

```powershell
node backend/server.js
```

5. Point the frontend runtime config to the backend:

```js
window.INTELLECTUAL_TWIN_CONFIG = {
  apiBaseUrl: "http://127.0.0.1:8080",
  agentBackendProxyEnabled: true
};
```

## Hosted Setup

For Azure App Service, configure these as application settings or Key Vault references:

- `OPENAI_API_KEY` or `ERANEOS_AI_GATEWAY_API_KEY`
- `OPENAI_BASE_URL` or `ERANEOS_AI_GATEWAY_BASE_URL`
- `OPENAI_TRANSCRIPTION_MODEL` or `ERANEOS_AI_GATEWAY_TRANSCRIPTION_MODEL`

Then set the deployed frontend runtime config to the hosted backend URL. Do not put the key into GitHub Actions Pages artifacts.

## GitHub Pages UAT Setup

GitHub Pages is static hosting. It cannot safely hold an Eraneos AI Gateway key and it cannot serve `/api/voice/concepts/transcribe` by itself. For UAT, create a hosted proxy that performs speech-to-text server-side.

Import-ready n8n blueprint:

```text
workflows/n8n/import-ready/voice-transcription-eraneos-gateway.import.json
```

Recommended n8n proxy contract:

- URL is public or otherwise reachable by the browser.
- Authentication and the Eraneos/OpenAI key stay in n8n credentials or backend settings.
- Request method: `POST`.
- Request body: `multipart/form-data`.
- Expected fields:
  - `file`: recorded audio blob, usually `webm`
  - `twin`: active twin id
  - `category`: selected concept category
- Accepted response shapes:

```json
{ "transcript": "Recognized text..." }
```

or:

```json
{
  "output": {
    "transcript": "Recognized text...",
    "category": "Personality"
  }
}
```

Configure the public proxy URL through one of these public-safe values:

```powershell
GH_PAGES_VOICE_TRANSCRIPTION_URL=https://<hosted-proxy>/voice/transcribe
GH_PAGES_N8N_VOICE_TRANSCRIPTION_WEBHOOK_URL=https://<n8n-webhook>/voice/transcribe
```

For GitHub Pages deployment, store only the proxy URL as a repository secret or build variable. Never store the API key in `frontend/runtime-config.js`, `frontend/assets/agent-runtime-config.json`, or browser storage.

GitHub repository secret:

```text
GH_PAGES_VOICE_TRANSCRIPTION_URL=https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/voice/transcribe
```

Optional alias, supported by the build scripts:

```text
GH_PAGES_N8N_VOICE_TRANSCRIPTION_WEBHOOK_URL=https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/voice/transcribe
```

After adding the secret, rerun the GitHub Pages workflow so the static artifact receives the public proxy URL.

## n8n Workflow Setup

1. Import `workflows/n8n/import-ready/voice-transcription-eraneos-gateway.import.json`.
2. Set or map the Eraneos AI Gateway credential server-side. Do not expose it as a frontend value.
3. Configure these n8n runtime variables if supported by the hosting setup:

```text
ERANEOS_AI_GATEWAY_API_KEY=<server-side key>
ERANEOS_AI_GATEWAY_BASE_URL=<OpenAI-compatible base URL ending before /audio/transcriptions>
ERANEOS_AI_GATEWAY_TRANSCRIPTION_MODEL=<speech-to-text model alias>
```

If environment variables are not available in the hosted n8n instance, use an n8n credential on the HTTP Request node and keep the same response contract.

4. Publish the workflow.
5. Copy the Production URL from the Webhook trigger into `GH_PAGES_VOICE_TRANSCRIPTION_URL`.

## Knowledge Fabric Handoff

When a voice concept is saved in static GitHub Pages mode, the frontend stages a pending Knowledge Fabric handoff in browser-local storage. This makes the Review/Knowledge cockpit UAT-visible before production repository or Postgres persistence exists.

Expected handoff properties:

- `source_type`: `voice_transcript`
- `source_name`: `Guided Voice Capture`
- `review_state`: `pending-review`
- `graph_curator_trigger`: `queued_for_candidate_generation`
- `vector_refresh`: `deferred_until_approved`

Production-grade persistence still requires the hosted backend/API and repository or Postgres writes.

## UAT Checklist

Run the detailed checklist in:

```text
docs/uat/voice-transcription-knowledge-fabric-uat.md
```

## Validation

Backend readiness:

```powershell
Invoke-RestMethod "http://127.0.0.1:8080/api/health"
```

Expected voice section:

```json
{
  "voice_transcription": {
    "status": "configured",
    "provider": "openai_compatible_gateway"
  }
}
```

The Voice Capture page should then change from backend setup warning to ready state when it runs against the backend.
