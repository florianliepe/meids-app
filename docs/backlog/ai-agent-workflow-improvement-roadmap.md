# AI Agent and Agent-Driven Workflow Improvement Roadmap

This roadmap defines the next major improvements after the Actor Twin routing contract and AI-agent workflow export package.

## Priority 1: Live n8n AI Agent Import and Verification

Benefit: moves from contract-ready frontend to actual external agent execution.

- Import or patch `workflows/n8n/*.workflow.json` into the three live n8n workflows.
- Verify each live canvas has `Receive request -> AI Agent -> response adapter -> Return JSON`.
- Confirm model credential attachment and prompt installation.
- Run live no-write probes and record trace IDs.
- Keep `Agentic Butler` approval-required behavior for risky probes.

## Priority 2: Actor Twin Intent Router Hardening

Benefit: makes the Actor Twin the reliable highest-level interaction layer.

- Add route confidence scoring.
- Add route explanation visible only in cockpit/debug trace.
- Add safe fallback route when n8n is unreachable.
- Add route-specific telemetry: direct answer, knowledge retrieval, knowledge staging, skill activation, skill creation, clarification.
- Add test fixtures for ambiguous and high-risk requests.

## Priority 3: Knowledge Fabric Agent Durable Write Path

Benefit: turns source upload and transcripts into governed OKF assets.

- Convert uploads/transcripts to pending OKF Markdown/YAML.
- Attach evidence records and CRUD audit entries.
- Generate candidate graph edges.
- Defer vector refresh until approved or explicitly selected by policy.
- Add GitHub knowledge repo sync as a controlled writeback step.

## Priority 4: Agentic Butler Skill Creation Loop

Benefit: lets the platform create new reusable skills without bypassing human approval.

- Implement Elicitation Agent inside Agentic Butler.
- Generate SkillSpec draft from human input and context.
- Keep SkillSpec `pending_approval`.
- After approval, run decomposition into SKILL.md, `skill.config.yaml`, prompts, schemas, and eval fixtures.
- Store trace and approval history.

## Priority 5: Skill Activation Runtime

Benefit: moves approved skills from static definitions to useful work execution.

- Validate approved skill selection.
- Build internal Skill Orchestrator plan.
- Coordinate task-agent steps.
- Consult Actor Twin at decision checkpoints.
- Return structured run output and approval queue.
- Persist traces for review and critic evaluation.

## Priority 6: Graph and Retrieval Integration

Benefit: improves compound knowledge usage beyond keyword retrieval.

- Add graph relation promotion workflow.
- Show approved, draft, candidate, inferred, rejected, and needs-rework edges distinctly.
- Feed approved graph context into Actor Twin retrieval.
- Add vector adapter boundary for Azure vector DB once credentials exist.
- Combine OKF Markdown/YAML, graph, and vector retrieval into one context package.

## Priority 7: Production Trust and Governance

Benefit: makes agent behavior auditable and safe enough for hosted use.

- Add durable trace store.
- Add approval queue with explicit decisions.
- Add prompt/version changelog.
- Add rollback for agent prompts and skill configs.
- Add run replay/eval harness before production promotion.

## Priority 8: Lean Frontend Continuation

Benefit: keeps the user-facing workspace focused while moving diagnostics into cockpit.

- Keep Chat focused on ask, add context, activate work, and show outputs.
- Keep Knowledge, Review, Graph, Traces, and Production as cockpit views.
- Remove manual background-agent activation from the user-facing workspace.
- Improve dark-mode density and source affordances in Knowledge Browser and Graph.
- Add cockpit-only trace detail for routing, n8n payloads, and probe evidence.

