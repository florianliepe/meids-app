# Actor-first production regression

PROD-023 was promoted through PR #37 at revision
`474cf6193b2754e775c6a57c62e3723dcdb1f238`. GitHub deployment run
`41887681177` succeeded. The development chat reported authenticated live checks;
the issue-tracking review independently verified the deployment result, not the
authenticated browser session. Other production-readiness gaps remain open.

The deterministic fixture suite remains `npm run uat:frontend-actor-first`.
Run the separate live smoke from a checkout of the deployed revision (or a branch
whose frontend app.js/styles.css are identical):

```powershell
$env:MEIDS_LIVE_URL = 'https://<approved-frontend-host>/'
$env:MEIDS_LIVE_STORAGE_STATE = 'C:\private\existing-authorized-session.json'
npm run uat:frontend-actor-first:live
```

Use an existing, privately stored Playwright authenticated session. Never commit
the state file. The script neither exports refreshed cookies nor prints page
content, screenshots, tokens or authenticated URLs. Missing/expired authentication
and missing Knowledge/Graph fixtures fail the run; they are not passing skips.
Use an account with approved synthetic/read-only Knowledge and graph content.

The script uses actual served n8n JS/CSS without route replacement or synthesized
composer markup. It records their hashes and checks deployed app/CSS against Git
HEAD bytes. On desktop and mobile viewports it checks:

- exactly one Talk, Add source, composer input, Send and control group;
- two application reconnects retaining that single group and sending no messages;
- hidden duplicate n8n branding;
- compact Knowledge rows with accessible, visible focus descriptions;
- every selectable Review queue/lane displaying exactly one lane;
- Graph canvas at least 500 pixels high and SVG filling at least 72% of its height;
- no new uncaught browser errors.

No messages are submitted, microphone capture started, files uploaded or review
decisions changed. Session restoration can read existing conversation history.
This smoke does not prove timed token expiry, successful microphone/file actions,
or prevention of replay of a previously submitted request. Those remain separate
behavioral tests. A zero-message observation in an idle reconnect is narrower.

The script was syntax-checked and the existing frontend contract validator passed
when added. Its authenticated live execution remains pending; do not present the
development chat's earlier manual smoke as a run of this new script.
