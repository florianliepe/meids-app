# Setup PR Checklist: App, Pages, and CI

## Purpose

Track the remaining deployment steps for `meids-app` after the baseline split and n8n staging setup.

## Verified Baseline

- `main` and `develop` are aligned.
- `gh-pages` exists and contains a sanitized static frontend artifact.
- `GH_PAGES_N8N_CHAT_WEBHOOK_URL` is configured as a repository secret.
- Local static runtime points to the active Actor Twin staging webhook.

## Merge Gate

This PR is informational until these external gates are resolved:

1. GitHub token includes `workflow` permission.
2. GitHub Pages hosting mode is selected:
   - private Pages via paid plan,
   - public sanitized Pages repo,
   - or deferred Azure/static hosting.

## Implementation Steps After Token Is Available

1. Move `deploy/github-workflows-pending/intellectual-twin-pages.yml` to `.github/workflows/intellectual-twin-pages.yml`.
2. Keep `GH_PAGES_API_BASE_URL` empty for static n8n mode.
3. Confirm `GH_PAGES_N8N_CHAT_WEBHOOK_URL` points to:

   ```text
   https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/actor-twin/chat
   ```

4. Run the GitHub Pages workflow manually.
5. Verify the deployed frontend loads and sends chat payloads to the Actor Twin webhook.

## Rollback

- Revert Pages source to `gh-pages` commit `1d98fc6`.
- Keep `main` intact as the application source of truth.
- Disable the Pages workflow if static deployment leaks unexpected local-only assets.
