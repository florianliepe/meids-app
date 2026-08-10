# Agent Config Handoff Package

Date: 2026-08-10

## Purpose

This handoff defines what belongs in the future private `meids-agent-configs` repository and what remains in the public app repository.

The app repository may contain public fixtures, public-safe contracts, UI code, and operator guidance. The agent-config repository should contain the operational n8n workflow definitions, agent prompts, skill runtime configs, approval gate policies, and environment templates required to run the three top-level MeIDs agents.

## Target Repository

Recommended repository: `meids-agent-configs`

Recommended visibility: private

Recommended default branch model:

- `main`: approved production-ready configs only.
- `develop`: integrated UAT-ready configs.
- `feature/<scope>`: one agent, workflow, skill, or prompt change.
- `release/<version>`: release candidate config bundle.
- `hotfix/<scope>`: urgent production config fix.

## Folder Scaffold

Detailed bootstrap scaffold: [`docs/production/agent-config-repo-scaffold.md`](agent-config-repo-scaffold.md)

```text
meids-agent-configs/
  README.md
  contracts/
    n8n/
      actor-twin.contract.json
      knowledge-fabric-agent.contract.json
      agentic-butler.contract.json
      examples/
  workflows/
    n8n/
      actor-twin.workflow.json
      knowledge-fabric-agent.workflow.json
      agentic-butler.workflow.json
  prompts/
    actor-twin/
    knowledge-fabric-agent/
    agentic-butler/
    shared/
  skills/
    approved/
    pending-approval/
  tool-manifests/
    mcp/
    n8n/
  env/
    github-pages.public.example.json
    hosted-backend.private.example.env
  uat/
    replay-results/
    live-probe-results/
    approval-gate-checklists/
```

## Top-Level Agents

| Agent | Runtime role | Config owned by agent-config repo |
|---|---|---|
| Actor Twin | User-facing decision and answer agent. Interprets intent, retrieves context, and steers decisions from the active twin persona. | n8n workflow, intent contract, persona steering prompt, retrieval request schema, answer response schema |
| Knowledge Fabric Agent | Knowledge ingest and curation agent. Converts uploads/transcripts into pending OKF concepts, manages evidence/audit, triggers graph curation, and prepares vector refresh payloads. | ingest workflow, OKF authoring prompt, CRUD audit schema, graph curator prompt, vector refresh adapter contract |
| Agentic Butler | Execution agent. Activates approved skills, manages the internal skill orchestrator, pauses for approval gates, and records traces. | skill activation workflow, skill orchestrator prompt, task-agent registry, approval gate policy, trace response schema |

## Runtime URL Mapping

The public app can display readiness from these keys. Public GitHub Pages should only receive intentionally public UAT webhook URLs.

| Agent | GitHub Pages secret | Runtime config key |
|---|---|---|
| Actor Twin | `GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL` | `n8nActorTwinWebhookUrl` / `n8nAgentWebhooks.actor_twin` |
| Knowledge Fabric Agent | `GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL` | `n8nKnowledgeFabricWebhookUrl` / `n8nAgentWebhooks.knowledge_fabric_agent` |
| Agentic Butler | `GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL` | `n8nAgenticButlerWebhookUrl` / `n8nAgentWebhooks.agentic_butler` |

For private production endpoints, use a hosted backend or workflow-generated runtime config. Do not commit secrets, bearer tokens, private webhook URLs, Azure keys, or n8n credentials.

## Public-Safe Contract Boundary

The public app repository may keep:

- fixture request and response examples;
- mock replay scripts;
- public-safe schema examples;
- operator documentation;
- status indicators and readiness UI.

The private agent-config repository should keep:

- full n8n workflow exports;
- live webhook URLs;
- credential names and environment mappings;
- agent prompts that include sensitive business logic;
- approval policy implementation details;
- UAT probe outputs that include private payloads.

## Handoff Sequence

1. Keep public contract fixtures green in `meids-app`.
2. Create `meids-agent-configs` as private.
3. Copy the folder scaffold from [`agent-config-repo-scaffold.md`](agent-config-repo-scaffold.md).
4. Use [`contracts/n8n/agent-config-public-export.json`](../../contracts/n8n/agent-config-public-export.json) as the public-safe import manifest.
5. Move workflow exports, prompts, skill activation policies, and environment templates into the private repo.
6. Configure public UAT webhook URLs through GitHub Pages secrets only if those URLs are intentionally public.
7. Run live probes from the MeIDs Production/Review Cockpit.
8. Promote an agent contract only after fixture replay, live probe, UAT, trace storage, and human approval all pass.

## Current Known Gaps

- Knowledge Fabric Agent live webhook URL is not configured.
- Agentic Butler live webhook URL is not configured.
- Azure vector DB credentials are not available yet.
- Production use remains blocked until live probes and approval-gate UAT pass.
