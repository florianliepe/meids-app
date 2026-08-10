# Agent Config Repo Scaffold

Date: 2026-08-10

## Purpose

This scaffold is the first implementation package for the future private `meids-agent-configs` repository. It separates operational agent configuration from the public MeIDs frontend while preserving a public-safe contract boundary in `meids-app`.

## Repository Role

`meids-agent-configs` owns:

- n8n workflow exports for the three top-level agents;
- agent prompts and policy instructions;
- skill orchestration configs;
- approval-gate policies;
- UAT/live-probe reports;
- environment templates without actual secrets.

`meids-app` continues to own:

- GitHub Pages frontend;
- public-safe n8n fixture examples;
- mock replay runner;
- OKF schema examples;
- cockpit readiness UI;
- production handoff documentation.

## Create The Repo

Recommended GitHub repository:

```text
florianliepe/meids-agent-configs
```

Recommended settings:

- visibility: private;
- default branch: `main`;
- branch protection on `main`;
- pull request required before merge;
- no secrets committed;
- workflow exports reviewed before promotion.

## Initial Folder Structure

```text
meids-agent-configs/
  README.md
  contracts/
    n8n/
      actor-twin.contract.json
      knowledge-fabric-agent.contract.json
      agentic-butler.contract.json
      handoff-manifest.json
  workflows/
    n8n/
      actor-twin.workflow.json
      knowledge-fabric-agent.workflow.json
      agentic-butler.workflow.json
  prompts/
    actor-twin/
      system.md
      critic.md
    knowledge-fabric-agent/
      system.md
      graph-curator.md
      vector-refresh.md
    agentic-butler/
      system.md
      skill-orchestrator.md
      approval-gates.md
    shared/
      safety.md
      output-contracts.md
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
  docs/
    operating-model.md
    release-checklist.md
```

## Bootstrap Content

Copy these public-safe files from `meids-app` into the private repo:

| Source in `meids-app` | Target in `meids-agent-configs` |
|---|---|
| `contracts/n8n/fixtures/actor-twin.json` | `contracts/n8n/actor-twin.contract.json` |
| `contracts/n8n/fixtures/knowledge-fabric-agent.json` | `contracts/n8n/knowledge-fabric-agent.contract.json` |
| `contracts/n8n/fixtures/agentic-butler.json` | `contracts/n8n/agentic-butler.contract.json` |
| `contracts/n8n/agent-config-public-export.json` | `contracts/n8n/handoff-manifest.json` |
| `docs/agent-architecture-and-n8n-contracts.md` | `docs/operating-model.md` |
| `docs/n8n-live-url-configuration.md` | `docs/runtime-url-configuration.md` |

## Minimal README

```markdown
# MeIDs Agent Configs

Private operational configuration for the MeIDs top-level agents:

1. Actor Twin
2. Knowledge Fabric Agent
3. Agentic Butler

No secrets, API keys, bearer tokens, private webhook URLs, or private knowledge payloads may be committed.

Promotion rule: fixture replay + live probe + UAT + approval-gate evidence must pass before merging into `main`.
```

## Environment Templates

Public UAT example:

```json
{
  "n8nAgentWebhooks": {
    "actor_twin": "PASTE_PUBLIC_UAT_WEBHOOK_URL_HERE",
    "knowledge_fabric_agent": "PASTE_PUBLIC_UAT_WEBHOOK_URL_HERE",
    "agentic_butler": "PASTE_PUBLIC_UAT_WEBHOOK_URL_HERE"
  }
}
```

Hosted backend private example:

```text
N8N_ACTOR_TWIN_WEBHOOK_URL=
N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL=
N8N_AGENTIC_BUTLER_WEBHOOK_URL=
N8N_WEBHOOK_AUTH_HEADER=
AZURE_VECTOR_DB_ENDPOINT=
AZURE_VECTOR_DB_KEY=
AZURE_POSTGRES_URL=
```

## Acceptance Gates

Before `meids-agent-configs` is used as an active runtime dependency:

1. Contract files match the public fixtures.
2. n8n workflows are exported and reviewed.
3. Each top-level agent has a live UAT webhook.
4. Approval-required cases pause execution.
5. Failure cases return recoverable structured errors.
6. Trace IDs are returned and stored.
7. Knowledge Fabric output never writes approved knowledge without human review.
8. Agentic Butler treats Skill Orchestrator as an internal component, not a separate top-level agent.
