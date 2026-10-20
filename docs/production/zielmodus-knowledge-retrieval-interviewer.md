# Zielmodus: Knowledge Retrieval Interviewer Integration

## Objective

Add a Knowledge Retrieval Interviewer task agent that can elicit implicit human knowledge through circular questions, deep-dive questions, decision-criteria questions, and evidence checks, then hand structured candidates to Knowledge Fabric for automatic OKF create/update in `review_needed` states.

The knowledge-node target shape is:

- topic and purpose
- use and wider context
- application
- additional context
- implications and results

## Clarified Target

The frontend stays lean:

- User chats or talks only with Actor Twin.
- Actor Twin remains the visible voice and routing authority.
- Detailed traces, raw agent outputs, review queues, graph candidates, and persistence state stay in cockpit views.

Automatic OKF creation/update is allowed. Trust promotion is not automatic.

Allowed automatic states:

- `review_needed`
- `updated_review_needed`
- `candidate`
- `needs_clarification`

Blocked without review:

- `approved`
- trusted vector refresh
- graph edge promotion
- cross-twin sharing
- external write/send/schedule actions

## Recommended Architecture

Use a hybrid routing model.

### Scenario A: Direct Knowledge Retrieval Through Knowledge Fabric

Use when the user asks for known context or evidence:

- "What do we know about X?"
- "Find my position on Y."
- "Search OKF/vector/graph for Z."
- "Show evidence for this concept."
- "Remember this note."
- "Update this OKF concept."

Flow:

1. Frontend sends message to embedded n8n Actor Twin chat.
2. Actor Twin calls `Knowledge Fabric Agent` using `Call n8n Workflow Tool`.
3. Knowledge Fabric retrieves approved context or stages/updates OKF candidate material.
4. Knowledge Fabric may call internal retrieval tools for OKF, vector, graph, deduplication, or evidence.
5. Actor Twin returns a concise final answer.
6. Review cockpit shows created/updated candidates and trace.

Why:

- Lowest latency.
- Clear ownership: Knowledge Fabric owns knowledge retrieval and governance.
- Avoids overusing Butler for simple knowledge questions.

Weak spots:

- Knowledge Fabric may retrieve facts but not elicit enough tacit context.
- Actor Twin may ask ad hoc follow-ups without a systematic interview method.

Mitigation:

- Knowledge Fabric returns `needs_clarification` when quality-gate fields are missing.
- Actor Twin escalates to Scenario B when repeated clarification or tacit judgment extraction is needed.

### Scenario B: Butler-Orchestrated Knowledge Retrieval Interview

Use when the user asks to structure implicit knowledge, extract principles, prepare a reusable knowledge package, or when a work artifact depends on missing tacit context:

- "Help me define my consulting approach."
- "Extract my decision principles from this story."
- "Turn this experience into reusable knowledge."
- "Prepare a client meeting based on how I usually handle this."
- "Interview me until this concept is good enough for the twin."

Flow:

1. Frontend sends message to embedded n8n Actor Twin chat.
2. Actor Twin calls `Agentic Butler` using `Call n8n Workflow Tool`.
3. Agentic Butler decides this is a structured elicitation skill/run.
4. Agentic Butler calls `Knowledge Retrieval Interviewer` using `Call n8n Workflow Tool`.
5. Interviewer returns either:
   - one next question, plus the quality gap it closes; or
   - a complete OKF candidate package.
6. Actor Twin asks the next visible question to the user, preserving the single-voice interaction.
7. When the quality gate is met, Butler sends the candidate to Knowledge Fabric.
8. Knowledge Fabric automatically creates or updates the OKF concept in a review-needed state.

Why:

- Better for tacit knowledge, decision criteria, and best practices.
- Butler can coordinate multiple task agents later: interviewer, source summarizer, graph mapper, answer writer.
- Keeps the Knowledge Fabric focused on governed storage/retrieval rather than long conversational elicitation.

Weak spots:

- More latency and more agent handoffs.
- Risk of visible "agent hopping" if raw worker output reaches chat.
- Risk of endless interviewing.

Mitigation:

- Actor Twin is the only visible voice.
- Interviewer asks one question per turn.
- Butler enforces a max loop count, for example 5 interview turns before returning `needs_clarification`.
- Every loop must close one named quality-gate field.
- Cockpit trace shows delegation; chat shows only the question/result.

## n8n Interaction Layer

Actor Twin workflow tools:

- `Knowledge Fabric Agent`
- `Agentic Butler`

Agentic Butler workflow tools:

- `Skill Orchestrator`
- `Knowledge Retrieval Interviewer`
- approved skill/task-agent workflows

Knowledge Fabric Agent workflow tools:

- `OKF Retriever`
- `Vector Retriever`
- `Graph Context Retriever`
- `Evidence/Deduplication Checker`
- `OKF Stager/Updater`

The Knowledge Retrieval Interviewer should be implemented as a separate n8n workflow with `When Executed by Another Workflow` / `Execute Workflow Trigger`. Bind it as a `Call n8n Workflow Tool` on Agentic Butler first. Add it to Knowledge Fabric only if direct retrieval repeatedly needs structured follow-up generation.

## Tool Descriptions

### Actor Twin: Knowledge Fabric Agent

Call this tool for direct knowledge retrieval, evidence lookup, OKF/vector/graph search, source-note staging, transcript ingestion, concept updates, candidate evidence creation, duplicate checks, and review-needed knowledge creation. Use this for "what do we know", "remember this", "update OKF", "show evidence", and "use graph/vector context" requests.

Do not call this tool for work artifacts such as emails or meeting briefs. Do not call it for long tacit-knowledge interviews; route those to Agentic Butler so the Knowledge Retrieval Interviewer can run.

### Actor Twin: Agentic Butler

Call this tool for work artifacts, approved skill execution, new capability proposals, and structured elicitation runs. Use it when the user asks to turn experience into reusable knowledge, extract decision criteria, define best practices, or interview the user until a concept is good enough for OKF staging.

Do not require approval for the elicitation run itself. Approval is required only before generated capabilities become active or before external side effects.

### Agentic Butler: Knowledge Retrieval Interviewer

Call this tool when a delegated work run requires tacit human knowledge before a useful artifact, skill, or OKF candidate can be created. The tool asks one high-value question at a time and returns either the next question or an OKF-ready candidate package.

Use it for circular, contrast, deep-dive, criteria, boundary, and evidence questions. Do not use it for simple retrieval or direct source ingestion.

Recommended n8n tool description:

```text
Call this tool when Actor Twin or Agentic Butler needs to elicit implicit human knowledge, tacit decision criteria, process insight, best practices, lessons learned, stakeholder dynamics, or reusable heuristics before creating an OKF knowledge node, work artifact, or skill proposal.

The tool asks one focused question at a time. It uses what/how/why/who/and-then questioning plus circular stakeholder-perspective questions to fill a knowledge-node quality gate: topic and purpose, use and wider context, application, additional context, implications and results, evidence, confidence, use cases, and non-use boundaries.

Do not call this tool for simple fact lookup, direct OKF/vector/graph retrieval, identity questions, or ordinary drafting where enough context already exists. Do not expose its raw output to the user; Actor Twin remains the visible voice.
```

## Knowledge Retrieval Interviewer System Instruction

Use [prompts/knowledge-retrieval-interviewer/system.md](../../prompts/knowledge-retrieval-interviewer/system.md) as the system instruction for the n8n Knowledge Retrieval Interviewer AI Agent.

## Call Contract

Input from Agentic Butler:

```json
{
  "task": "elicit_implicit_knowledge",
  "active_twin": "florian",
  "user_goal": "Turn this experience into reusable OKF knowledge",
  "current_understanding": "",
  "known_context": [],
  "missing_fields": ["decision_criteria", "evidence", "do_not_use_when"],
  "interview_turn": 1,
  "max_turns": 5,
  "desired_output": "okf_candidate_for_review_needed"
}
```

Output to Agentic Butler:

```json
{
  "status": "question_needed",
  "next_question": "What would a skeptical client stakeholder say is the main risk in this situation?",
  "question_type": "circular",
  "gap_being_closed": "stakeholder perspective and risk criteria",
  "current_understanding": "The concept concerns consulting decision-making under unclear stakeholder alignment.",
  "covered_sections": ["topic_and_purpose"],
  "missing_sections": ["use_and_wider_context", "application", "additional_context", "implications_and_results"],
  "okf_candidate": null,
  "recommended_knowledge_fabric_action": "no_write",
  "trace": {
    "used_agents": ["knowledge_retrieval_interviewer"],
    "quality_gate_state": "missing decision criteria, evidence, non-use boundary",
    "handoff_target": "agentic_butler"
  }
}
```

When ready:

```json
{
  "status": "candidate_ready",
  "next_question": "",
  "question_type": "",
  "gap_being_closed": "",
  "current_understanding": "Sufficient fields captured.",
  "okf_candidate": {
    "title": "Stakeholder Alignment Before Prioritization",
    "category": "decision_principle",
    "topic_and_purpose": "Use stakeholder alignment as a prerequisite for prioritizing product or consulting work.",
    "use_and_wider_context": "Use it when several stakeholders influence delivery, acceptance, or tradeoff decisions.",
    "application": "Clarify the accountable decision owner, collect constraints, surface tradeoffs, and document the decision before backlog commitment.",
    "additional_context": "If decision ownership is already explicit, keep this lightweight and avoid unnecessary ceremony.",
    "implications_and_results": "Backlog priorities become easier to defend; missing decision logs become visible before delivery risk increases.",
    "claim": "Before prioritizing backlog items, validate stakeholder alignment and decision ownership.",
    "why_it_matters": "Prevents feature prioritization from becoming detached from decision accountability.",
    "use_when": "Planning product or consulting work with multiple stakeholders.",
    "do_not_use_when": "A single accountable owner has already made the decision criteria explicit.",
    "decision_criteria": ["clear owner", "known constraints", "accepted tradeoffs"],
    "example": "Client alignment meeting moved and decision log required.",
    "evidence": "Human interview answer and source note.",
    "confidence": "medium",
    "review_state": "review_needed"
  },
  "covered_sections": ["topic_and_purpose", "use_and_wider_context", "application", "additional_context", "implications_and_results"],
  "missing_sections": [],
  "recommended_knowledge_fabric_action": "stage_new_concept",
  "trace": {
    "used_agents": ["knowledge_retrieval_interviewer"],
    "quality_gate_state": "met",
    "handoff_target": "knowledge_fabric_agent"
  }
}
```

## Build Order

1. Create the n8n `Knowledge Retrieval Interviewer - staging` workflow.
2. Add `When Executed by Another Workflow` trigger.
3. Add AI Agent node with the system instruction from `prompts/knowledge-retrieval-interviewer/system.md`.
4. Add response normalizer that guarantees `status`, `next_question`, `okf_candidate`, `recommended_knowledge_fabric_action`, and `trace`.
5. Add the workflow as `Call n8n Workflow Tool` to Agentic Butler.
6. Update Agentic Butler system instruction to call the interviewer for structured elicitation.
7. Update Actor Twin tool description so tacit-knowledge elicitation routes to Butler, while simple retrieval routes to Knowledge Fabric.
8. Add UAT cases:
   - simple retrieval routes to Knowledge Fabric
   - note/update routes to Knowledge Fabric and creates review-needed candidate
   - tacit-knowledge elicitation routes Actor Twin → Butler → Interviewer and returns one next question
   - completed interview routes Butler → Knowledge Fabric and creates/updates OKF `review_needed`
9. Run:
   - `npm run check:agents`
   - `npm run uat:agents:live`
10. Only after UAT passes, publish the updated n8n workflows.

## Definition Of Done

- Actor Twin still answers identity/simple questions directly.
- Actor Twin routes simple knowledge retrieval/staging to Knowledge Fabric.
- Actor Twin routes tacit-knowledge elicitation to Agentic Butler.
- Agentic Butler calls Knowledge Retrieval Interviewer for structured elicitation.
- Interviewer asks one high-value question per turn and names the quality gap.
- Knowledge Fabric automatically creates/updates OKF candidates in review-needed states.
- No raw JSON or internal worker output appears in the frontend chat.
- n8n executions show Actor Twin, Butler, Interviewer, and Knowledge Fabric traces where applicable.
