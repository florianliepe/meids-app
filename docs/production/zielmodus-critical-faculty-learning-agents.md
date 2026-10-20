# Zielmodus: Critical Faculty And Learning Agent

## Target

Keep the frontend lean: Actor Twin remains the only user-facing chat. Critical
Faculty Agent and Learning Agent run only as n8n workflow-tool subagents.

## Build Order

1. Add Critical Faculty Agent as callable n8n workflow tool for Actor Twin,
   Agentic Butler, and Knowledge Fabric.
2. Add Learning Agent as callable n8n workflow tool for Actor Twin and Knowledge
   Fabric.
3. Add Knowledge Fabric Agent as callable workflow tool inside Learning Agent so
   learning documents and concept deltas are staged as `review_needed` or
   `updated_review_needed`.
4. Patch system instructions and tool descriptions in source and live n8n.
5. Run UAT for direct Critical Faculty calls, direct Learning calls, and tool
   attachment integrity.

## Decision Principles

- Actor Twin owns visible interaction and routing.
- Critical Faculty improves decision quality before action; it does not execute,
  approve, persist, or become a visible agent.
- Learning Agent converts traces and outcomes into reviewable knowledge; it does
  not approve truth.
- Knowledge Fabric owns persistence, review state, evidence, graph candidates,
  and vector boundaries.
- No new frontend panels are required. Only trace and review surfaces should show
  subagent activity.

## Applied Command

```powershell
node scripts/integrate-n8n-critical-faculty-learning-agents.cjs
```
