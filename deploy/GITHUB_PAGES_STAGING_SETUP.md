# GitHub Pages Staging Setup

## Current State

- Repository: `florianliepe/meids-app`
- Branches: `main`, `develop`
- Pages artifact branch: `gh-pages`
- Frontend can run in static n8n mode without a hosted Python backend.
- Local checked-in `frontend/runtime-config.js` points to the active n8n Actor Twin staging webhook.
- Repository secret `GH_PAGES_N8N_CHAT_WEBHOOK_URL` is configured.
- `gh-pages` contains a sanitized static artifact only: no generated audio and no uploaded profile pictures.

## Active n8n Staging Endpoint

Use this value for GitHub Pages static mode:

```text
GH_PAGES_N8N_CHAT_WEBHOOK_URL=https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/actor-twin/chat
```

Leave this empty until a hosted FastAPI backend exists:

```text
GH_PAGES_API_BASE_URL=
```

## Prepared Artifact Branch

The static frontend has been pushed to:

```text
gh-pages
```

Commit:

```text
1d98fc6 Publish static GitHub Pages artifact
```

This branch can be selected as a Pages source if the repository plan/visibility allows Pages.

## Current Blockers

1. The current GitHub auth token cannot push files under `.github/workflows/` because it lacks `workflow` scope.
2. GitHub Pages for a private repository requires a GitHub plan that supports private Pages, or the Pages repository must be public.

## Required GitHub Token

Create a fine-grained token for:

- `florianliepe/meids-app`
- `florianliepe/meids-knowledge-fabric`
- `florianliepe/meids-agent-configs`

Required permissions:

- Contents: read/write
- Actions: read/write
- Workflows: read/write
- Pull requests: read/write
- Issues: read/write
- Metadata: read
- Pages: read/write if GitHub plan supports Pages for the repository

Classic PAT alternative:

```text
repo
workflow
```

## Pending Workflow Files

After the token supports workflows, move:

```text
deploy/github-workflows-pending/intellectual-twin-pages.yml
```

to:

```text
.github/workflows/intellectual-twin-pages.yml
```

The repository secret is already configured:

```text
GH_PAGES_N8N_CHAT_WEBHOOK_URL
```

and run the workflow manually once from GitHub Actions.

If GitHub Pages remains blocked for private repositories, use one of these options:

1. Upgrade the GitHub plan to support private Pages.
2. Make only a sanitized static Pages repository public.
3. Defer browser-hosted deployment until Azure App Service or another hosted frontend/runtime target is available.
