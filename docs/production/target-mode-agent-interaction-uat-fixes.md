# Zielmodus: Agent Interaction UAT Fixes + Next Forecast

## Goal
Fix the manual GitHub Pages UAT failures where ordinary Actor Twin questions routed to Agentic Butler, skill creation called unavailable backend APIs, traces opened unavailable backend trace endpoints, and Actor Twin delegation was not visible as executed route branching.

## Issues From Manual UAT

1. Plain answer prompts returned `Select one approved skill before activating Agentic Butler`.
   - Root cause: frontend fallback routing treated the existence of any approved skill as execution intent.
   - Fix: execution intent now requires explicit work/skill language; approved skill availability alone does not route to Butler.

2. Actor Twin response text could be interpreted as delegation.
   - Root cause: text parser matched generic phrases such as `Agentic Butler`.
   - Fix: answer-only fallback routes only parse route text when explicit route markers are present.

3. Skill creation failed with `405 Not Allowed`.
   - Root cause: GitHub Pages called `/api/skills/elicit`, which only exists in the backend.
   - Fix: static Pages now creates a local pending SkillSpec draft and keeps human approval gating visible.

4. Trace review failed with `405 Not Allowed`.
   - Root cause: GitHub Pages called `/api/answer-traces/detail`, which only exists in the backend.
   - Fix: static Pages now opens local/static trace evidence from browser session traces.

5. n8n route branches were not visible.
   - Root cause: frontend attempted secondary direct calls after Actor Twin already delegated inside n8n.
   - Fix: frontend now respects `delegate_result` returned by Actor Twin and does not double-call Knowledge Fabric or Butler.

## Definition of Done

- Ordinary questions stay on Actor Twin.
- Skill creation creates a pending approval draft in static Pages without backend 405.
- Trace review opens local/static trace details instead of backend HTML errors.
- Actor Twin delegated n8n responses are rendered as delegated output.
- Regression checks pass in `npm run check:agents`.

## Next Forecast

1. Run browser-level UAT on GitHub Pages after deployment.
2. Add no-route-hint Actor Twin UAT mode to test n8n classifier independence.
3. Harden Actor Twin n8n normalizer so every branch returns `route_decision`, `delegate_result`, and trace ids consistently.
4. Add a cockpit card showing the latest GitHub Pages UAT evidence.
5. Move static trace/approval persistence to hosted backend + Postgres for production.
