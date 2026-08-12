# Target Mode: Agent UAT Hardening and n8n Deterministic Routing

## Goal
Convert the current live n8n interaction proof into a repeatable UAT gate and reduce remaining ambiguity in Actor Twin answer creation and delegation.

## Scope
1. Maintain an executable UAT runner for the three critical routes:
   - Actor Twin direct answer
   - Actor Twin to Knowledge Fabric Agent
   - Actor Twin to Agentic Butler
2. Store public-safe UAT results under `docs/uat/`.
3. Make frontend/backend/test normalizers resilient to:
   - n8n array item wrappers
   - `{ json: ... }` wrappers
   - object-valued `answer`
   - fenced JSON inside answer text
4. Track UAT issues in a durable checklist.
5. Keep the main UI lean; move diagnostic and evidence interpretation into cockpit/docs.

## Identified Issues
1. Without frontend-style route context, live Actor Twin can misclassify some prompts as `activate_skill`.
2. Direct Actor Twin answers may still return JSON fenced as text instead of final natural-language answer.
3. Butler approval resume still needs end-to-end validation through hosted backend proxy.

## Implementation Direction
1. Treat frontend `context.route_decision` as a guardrail hint, not the final authority.
2. Harden n8n Actor Twin normalizer so final `output.route_decision` is deterministic from AI output plus fallback route reconciliation.
3. Update Actor Twin prompt to explicitly prefer:
   - `answer_direct` for answer-only questions
   - `ingest_or_stage_knowledge` for remember/store/source/update knowledge requests
   - `create_skill` for new skill shaping requests
   - `activate_skill` only for approved skill execution requests
4. Add a strict no-hint UAT once n8n routing is hardened.
5. Validate approval resume through backend proxy after hosted backend URL is configured.

## Definition of Done
- `node scripts/run-agent-interaction-uat.cjs` passes.
- `node scripts/validate-chat-live-n8n-uat.cjs --file docs/uat/agent-interaction-uat-results.json` passes.
- Chat renders delegated responses without raw nested JSON.
- UAT catalog lists current pass criteria, evidence, and remaining open issues.

## Next Forecast
1. Patch live n8n Actor Twin route classifier/normalizer to pass a no-hint UAT.
2. Add `--no-route-hints` mode to the UAT runner.
3. Validate Butler approval resume against hosted backend proxy.
4. Extend Knowledge Fabric Agent to produce concrete OKF candidate paths and graph candidate edges from live AI output.
5. Add cockpit-level UAT status card sourced from `docs/uat/agent-interaction-uat-results.json`.
