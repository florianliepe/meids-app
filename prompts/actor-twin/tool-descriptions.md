# Actor Twin n8n Workflow Tool Descriptions

Use these descriptions in the Actor Twin AI Agent tool connections for n8n `Call n8n Workflow Tool` nodes.

## Tool: MeIDs Knowledge Fabric Agent

Call this tool when the user asks to retrieve, inspect, add, update, stage, or structure knowledge for the active twin. Use it for OKF concepts, source notes, uploaded material, transcripts, evidence records, review-needed knowledge, graph hints, vector-search context, duplicate checks, and "what do we know about..." questions that require grounded memory.

Do not call this tool for ordinary identity questions, direct explanations that do not need stored knowledge, work artifacts such as emails, plans, briefs, and agendas, or multi-turn implicit-knowledge interviews. New or changed knowledge may be created automatically, but it must remain `review_needed`, `updated`, or `candidate` until reviewed. This tool must not promote concepts, approve graph edges, or execute external side effects.

Routing criteria:

- Use for retrieval: "what do we know", "find in OKF", "search knowledge", "show evidence", "use vector cache", "use graph context", "retrieve context".
- Use for ingest/update: "remember this", "save this as knowledge", "stage this", "capture this note", "ingest this transcript", "add/update OKF", "source note", "document/upload knowledge".
- If the user asks to extract tacit judgment, decision criteria, best practices, lessons learned, or implicit knowledge through an interview, call Agentic Butler instead so it can run the Knowledge Retrieval Interviewer.
- Expected return: concise answer or staged OKF/evidence summary plus trace metadata.

## Tool: MeIDs Agentic Butler

Call this tool when the user asks the Actor Twin to perform work through a skill, produce a work artifact, run an approved capability, design a new reusable capability, or structure implicit knowledge through an interview loop. Use it for email drafts, meeting preparation, agendas, planning, prioritization, summaries, status updates, reusable skill proposals, generated agent/task-agent proposals, structured tacit-knowledge elicitation, and orchestration of approved skills.

Do not call this tool for normal identity questions, knowledge storage/retrieval, or simple explanations that the Actor Twin can answer directly. Do not require human approval for draft-only or no-write work artifacts. Require human approval only before activating a newly generated skill/agent/task-agent/subagent or before a real external side effect such as sending, scheduling, publishing, deleting, or committing.

Routing criteria:

- Use for normal work artifacts: "draft/write/prepare/compose an email", "prepare a meeting brief", "create an agenda", "summarize", "prioritize backlog", "make a plan", "run the approved skill".
- Use for capability creation: "create/design/build/define/generate a new skill", "new agent", "new task agent", "new subagent", "new reusable capability".
- Use for tacit knowledge elicitation: "extract my decision principles", "turn this experience into reusable knowledge", "interview me", "help me define my approach", "capture my best practices", "ask circular questions", "deep dive until the concept is ready".
- Expected return for normal work: completed artifact and trace metadata, no approval.
- Expected return for capability creation: proposal with mode of action, value/USP, scope, boundaries, task-agent outline, and `approval_required`.
- Expected return for elicitation: one next question with the quality gap being closed, or an OKF candidate handed to Knowledge Fabric for `review_needed` staging.

## Selector Rule

If the user asks for knowledge and work in the same turn, the Actor Twin should usually call Knowledge Fabric first to retrieve or stage context, then call Agentic Butler only if a work artifact still needs to be produced. Keep the final answer lean and expose detailed traces in the cockpit.
