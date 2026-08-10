# MeIDs Repo Split Handoff Checklist

Purpose: prepare the lift from the public app repository into three durable repositories without mixing runtime UI, private knowledge, and agent configuration.

## Target Repositories

| Repository | Default Visibility | Owns | Must Not Store |
| --- | --- | --- | --- |
| `meids-app` | Public | Static frontend, GitHub Pages workflow, public-safe fixtures, public documentation, UI QA artifacts. | Private OKF concepts, raw transcripts, secrets, live n8n credentials, embeddings. |
| `meids-knowledge-fabric` | Private | OKF Markdown/YAML concepts, evidence manifests, transcripts, CRUD audit, graph nodes/edges, promotion decisions, knowledge sync PRs. | App build artifacts, public runtime config, provider API keys. |
| `meids-agent-configs` | Private | n8n workflow contracts, prompts, skill specs, agent instructions, tool manifests, environment templates. | User source documents, approved knowledge content unless referenced through stable IDs. |

## Branch Model

Use a conservative shared model:

| Branch | Purpose | Merge Gate |
| --- | --- | --- |
| `main` | Production-ready state. | Human-approved PR only. |
| `develop` | Integrated next release state. | Passing tests and review. |
| `feature/*` | Scoped implementation work. | PR into `develop`. |
| `release/*` | Release stabilization. | Smoke QA and release notes. |
| `hotfix/*` | Urgent production fix. | Focused approval and back-merge. |

## Handoff Sequence

1. Freeze current `meids-app` `develop` and `main` state.
2. Verify GitHub Pages deploy from `main`.
3. Keep `contracts/okf/examples`, validators, and public documentation in `meids-app`.
4. Create or refresh `meids-knowledge-fabric` as private.
5. Create folder scaffold in `meids-knowledge-fabric`:
   - `concepts/`
   - `evidence/`
   - `transcripts/`
   - `graph/nodes/`
   - `graph/edges/`
   - `audit/`
   - `promotions/`
6. Apply the latest reviewed knowledge sync payload into a `feature/knowledge-sync-*` branch.
7. Review generated OKF content before merge.
8. Create or refresh `meids-agent-configs` as private.
9. Move live n8n workflow documentation, prompts, and non-secret configuration into `meids-agent-configs`.
10. Keep webhook URLs and credentials only in GitHub secrets, n8n credentials, or hosted secret stores.

## Acceptance Gates

| Gate | Evidence |
| --- | --- |
| App repository stays public-safe | `scripts/pages-smoke-check.cjs` passes and no private source text is committed. |
| OKF schema remains portable | `scripts/validate-okf-fixtures.cjs` passes. |
| Graph promotions remain reviewable | `scripts/validate-graph-promotions.cjs` passes. |
| Vector adapter boundary remains credential-free | `scripts/validate-vector-adapter.cjs` passes. |
| n8n contracts remain testable without live rollout | `scripts/validate-n8n-fixtures.cjs` and `scripts/replay-n8n-fixtures.cjs` pass. |
| Knowledge repo sync is review-gated | Payload branch exists and PR shows changed OKF Markdown/YAML before merge. |
| Agent config repo is not executable by default | Prompts and contracts are versioned, but deployment credentials remain external. |

## Production Boundary

Approved knowledge is the only trusted retrieval source. Draft, candidate, and pending-review material may be shown as untrusted context, but must not be used as production fact without explicit selection and labeling.

The Knowledge Fabric Agent may create drafts, evidence, audit entries, candidate nodes, and candidate edges. It must not mark concepts or graph relations as `approved` without a human review event.

The Agentic Butler may activate approved skills through n8n. Actions that send email, schedule meetings, modify external systems, or publish content require human approval before execution.

## Next Operator Actions

1. Confirm repository names and visibility.
2. Configure GitHub branch protection on `main`.
3. Export a fresh knowledge sync payload from the local MVP.
4. Apply payload into the private knowledge repo branch.
5. Open a human-reviewed PR.
6. Configure live n8n URLs for Knowledge Fabric Agent and Agentic Butler when available.
