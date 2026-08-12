# Target Mode: Agent Runtime Hardening and n8n Answer Creation

## Goal
Harden the n8n-level Actor Twin orchestration so the MeIDs app treats the Actor Twin as the primary routing authority, persists delegated trace chains, and renders final answers plus approval gates without exposing technical controls in the main workspace.

## Scope
1. Normalize `route_decision` from live n8n responses whether it is returned as an object or a string.
2. Preserve `delegate_result` from Actor Twin responses when it calls Knowledge Fabric Agent or Agentic Butler.
3. Persist parent Actor Twin traces and delegated child traces through the backend proxy.
4. Store approval records with enough original request and delegated response context to resume Agentic Butler runs.
5. Render delegated agent summaries in Chat as compact answer evidence, not raw JSON.
6. Keep diagnostics, live probes, production path, and contract evidence inside Production/Review Cockpit.

## Non-Goals
- No new public secrets.
- No vector DB live write enablement in this step.
- No UI re-expansion of manual Knowledge Fabric or Agentic Butler activation controls.
- No replacement of the published n8n workflows unless contract validation shows a blocker.

## Definition of Done
- Backend proxy accepts Actor Twin route decisions as the runtime source of truth.
- Actor Twin-to-Knowledge-Fabric and Actor Twin-to-Butler delegations persist as trace chains.
- `approval_required` Butler results create backend approval queue records.
- Chat displays the Actor Twin answer and delegated agent summary with trace identifiers.
- Syntax and contract checks pass.

## Next Forecast
1. Run real browser UAT against the published Actor Twin workflow for answer, knowledge, and Butler routes.
2. Validate Butler approval resume against the live n8n workflow.
3. Extend Knowledge Fabric Agent from staging response to real OKF candidate artifact creation.
4. Move trace and approval persistence to hosted Postgres for non-local deployment.
5. Add cockpit-level trace-chain comparison between frontend, backend, and n8n execution IDs.
