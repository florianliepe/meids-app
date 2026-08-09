# MeIDs App

Public-safe static frontend for the MeIDs intellectual twin workspace.

This repository is intentionally frontend-only for GitHub Pages staging. Private runtime data, backend state, `.agents`, generated audio, uploaded profile pictures, knowledge fabric content, and agent configs live outside this public repository.

## Runtime Mode

The current GitHub Pages staging mode uses the Actor Twin n8n webhook through `GH_PAGES_N8N_CHAT_WEBHOOK_URL`.

## Architecture Direction

The app uses a lean assistant workspace and keeps operational complexity in design,
review, graph, trace, skill, and production cockpits. The current implementation
direction is documented in
[`docs/agent-architecture-and-n8n-contracts.md`](docs/agent-architecture-and-n8n-contracts.md).
The portable knowledge contract is documented in
[`docs/knowledge-fabric-okf-schema.md`](docs/knowledge-fabric-okf-schema.md).

Top-level agents:

- Actor Twin: user-facing answer and decision interface.
- Knowledge Fabric Agent: OKF, source ingestion, CRUD, vector refresh, and graph curation.
- Agentic Butler: skill execution, internal Skill Orchestrator, task agents, traces, and refinement proposals.

## Repositories

- App frontend: this repository
- Knowledge fabric: `meids-knowledge-fabric` private
- Agent configs and n8n contracts: `meids-agent-configs` private
