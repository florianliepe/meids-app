# GitHub Pages Contract Validation Gate Patch

Date: 2026-08-11

## Purpose

The Pages workflow already validates the main MeIDs frontend and several public-safe
contract fixtures. Zielmodus 4 needs the workflow to also enforce:

- the generated OKF public status artifact is current;
- the generated n8n live preflight artifact is current;
- the Zielmodus 4 public-safe readiness gate passes;
- the live probe evidence recorder remains syntactically valid.

## Current Constraint

The current GitHub credential used by the local automation can push ordinary app,
contract, and documentation changes, but GitHub rejects updates to
`.github/workflows/intellectual-twin-pages.yml` without `workflow` scope.

Until a token/session with `workflow` scope is available, this patch remains a
documented handoff instead of a direct workflow edit.

## Required Workflow Trigger Paths

Add these paths to the existing `on.push.paths` list:

```yaml
      - "scripts/validate-zielmodus-4-readiness.cjs"
      - "scripts/record-n8n-live-probe-evidence.cjs"
      - "scripts/write-okf-validation-status.cjs"
      - "scripts/write-n8n-live-readiness-preflight.cjs"
```

## Required Build Steps

Add these steps after `Validate Postgres graph projection schema` and before
`Prepare static artifact`:

```yaml
      - name: Validate OKF public status artifact
        run: node scripts/write-okf-validation-status.cjs --check

      - name: Validate n8n live preflight artifact
        run: node scripts/write-n8n-live-readiness-preflight.cjs --check

      - name: Validate Zielmodus 4 public-safe readiness
        run: node scripts/validate-zielmodus-4-readiness.cjs

      - name: Validate live probe evidence recorder
        run: node --check scripts/record-n8n-live-probe-evidence.cjs
```

## Local Equivalent

Run this before applying the workflow patch:

```powershell
node scripts\write-okf-validation-status.cjs --check
node scripts\write-n8n-live-readiness-preflight.cjs --check
node scripts\validate-zielmodus-4-readiness.cjs
node --check scripts\record-n8n-live-probe-evidence.cjs
```

Expected current state:

- OKF status artifact passes.
- n8n live preflight artifact passes with current status `partial_live_url_blocked`.
- Zielmodus 4 public-safe readiness passes with status `partial_live_url_blocked`.
- Strict live gate remains blocked until Knowledge Fabric Agent and Agentic Butler
  live URLs plus non-demo probe evidence are available.
