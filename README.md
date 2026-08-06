# MeIDs App

Public-safe static frontend for the MeIDs intellectual twin workspace.

This repository is intentionally frontend-only for GitHub Pages staging. Private runtime data, backend state, `.agents`, generated audio, uploaded profile pictures, knowledge fabric content, and agent configs live outside this public repository.

## Runtime Mode

The current GitHub Pages staging mode uses the Actor Twin n8n webhook through `GH_PAGES_N8N_CHAT_WEBHOOK_URL`.

## Repositories

- App frontend: this repository
- Knowledge fabric: `meids-knowledge-fabric` private
- Agent configs and n8n contracts: `meids-agent-configs` private
