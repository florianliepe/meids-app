# Azure Static Web Apps UAT cutover

## Target state

- Primary Me.IDs UAT frontend: `https://victorious-flower-0f10a8303.6.azurestaticapps.net`
- Azure resource: `intellectual-twin` in `rg-ai-intellectual-twin`
- Source: `florianliepe/meids-app`, branch `main`
- Deployment: GitHub Actions workflow `intellectual-twin-azure-static-web-app.yml`
- Customer sandbox: GitHub Pages remains deployed by `intellectual-twin-pages.yml`
- Future domain: `intellectual-twin.eraneos.com`

Azure Static Web Apps is the primary hosted UAT boundary. GitHub Pages remains a
static sandbox and must not be treated as the persistence or authentication
boundary.

## Runtime connections

The Static Web App is linked to App Service `meids-backend-1853a19b` in the same
resource group. Requests under `/api/*` use that linked backend. The frontend
build enables Microsoft Entra ID authentication and uses `/api/session` to
resolve the signed-in user and assigned twins.

The only user-facing agent interface is the embedded Actor Twin n8n chat:

```text
https://eraneos-agentic-platform.azurewebsites.net/webhook/b4afb251-2ad1-43da-9d7c-6f6473fbd3db/chat
```

Knowledge Fabric, Agentic Butler, and their specialist agents remain internal
n8n workflow-tool calls. Direct worker webhook URLs in runtime metadata are UAT
probe paths, not additional frontend chats.

## Deployment behavior

Every relevant push to `main` triggers both frontend deployments:

1. Azure Static Web Apps builds `dist-swa` with authentication enabled and
   `staticPagesMode: false`, then deploys using the repository secret
   `AZURE_STATIC_WEB_APPS_API_TOKEN_INTELLECTUAL_TWIN`.
2. GitHub Pages builds its own static artifact and remains the customer sandbox.

The Azure workflow validates frontend JavaScript, workflow contracts, runtime
handoffs, OKF fixtures, graph/vector contracts, and the generated static
artifact before deployment. The Azure resource is connected to the same GitHub
repository and `main` branch, so future committed frontend changes use the same
path without a portal-side manual upload.

## UAT gates

- The Azure root page, runtime config, and agent runtime asset return HTTP 200.
- `/.auth/me` returns the Static Web Apps identity envelope.
- `/api/session` returns authenticated JSON for an assigned user and a JSON 401
  for an anonymous request.
- The Actor Twin chat CORS preflight allows the Azure Static Web Apps origin.
- A browser-origin `sendMessage` probe receives HTTP 200 from the Actor Twin.
- The embedded chat composer appears on first entry to the Actor Twin workspace,
  without requiring a second navigation click.
- The latest Azure and GitHub Pages workflow runs both succeed for `main`.

## Remaining production promotion work

- Add and validate `intellectual-twin.eraneos.com` before changing bookmarks or
  Entra redirect configuration.
- Replace deployment-token authentication with GitHub-to-Azure workload identity
  federation when the tenant deployment policy is ready.
- Keep direct worker-agent URLs out of production runtime configuration once all
  probes can run through authenticated backend/operator tooling.
- Add deployment protection rules to the `azure-static-web-app` GitHub
  environment when UAT and production become separate Azure environments.
