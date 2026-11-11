# n8n to Azure Agent Adapter Migration

## Invariants

The Azure-native implementation replaces the execution adapter, not the behavior contracts:

- Actor input: `meids.actor_twin.embedded_chat.v1`
- Routing: `meids.agent-routing.v1`
- Durable background work: `meids.agent-work.v1`
- SLOs: `meids.agent-slo.v1`
- Authorization: signed tenant, user, active-twin and allowed-twin context
- Learning: post-turn by default and never blocks the visible answer
- Critical Faculty: conditional on the routing gate
- Skill Orchestrator: bypassed for one-step work
- Timeout: bounded fallback with no automatic retry after uncertain completion

## Adapter boundary

Both adapters must accept the same normalized request and return the same status,
output, approval, error and trace shape. The routing classifier runs before either
adapter. Azure must not reclassify a request or silently increase a response
budget.

## Migration order

1. Implement Azure handlers behind the existing backend proxy routes.
2. Replay the routing and adapter-portability suites against both adapters.
3. Shadow only no-write traffic and compare route, output status, evidence and latency.
4. Move one internal worker at a time; keep Actor as the stable frontend contract.
5. Require rolling p50/p90 evidence and zero authorization-scope drift.
6. Switch through a runtime adapter flag with n8n retained as rollback.
7. Remove n8n nodes only after the rollback window and audit retention period.

## Release gates

- No browser-visible worker endpoint.
- No changed route or timeout budget.
- No synchronous Learning regression.
- No unconditional Critical Faculty or Skill call.
- No loss of execution correlation, evidence references or approval gates.
- Background acknowledgement remains below the 10-second critical threshold.
- Unknown completion is terminal and is never retried automatically.
