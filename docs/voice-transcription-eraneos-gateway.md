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
