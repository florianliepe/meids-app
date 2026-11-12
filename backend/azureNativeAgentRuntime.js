const crypto = require("node:crypto");
const { classifyAgentInteraction } = require("./agentRoutingPolicy");
const { createAgentExecutionAdapter, INPUT_CONTRACT } = require("./agentExecutionAdapter");
const { azureOpenAiChatConfigFromEnv, completeChat } = require("./azureOpenAiChat");

function messageFromEnvelope(envelope = {}) {
  return String(envelope.chatInput || envelope.input?.message || envelope.input?.query || "").trim();
}

function portableRequest(envelope = {}, options = {}) {
  const message = messageFromEnvelope(envelope);
  const routing = classifyAgentInteraction({ message, metadata: envelope.metadata || {} });
  const agentId = String(options.agentId || envelope.agent_id || "actor_twin").trim();
  if (agentId === "knowledge_fabric_agent") {
    const operation = String(envelope.input?.operation || envelope.intent || envelope.action || "retrieve").toLowerCase();
    const mutating = /\b(stage|ingest|update|merge|upsert|store|save)\b/.test(operation);
    routing.route = mutating ? "ingest_or_stage_knowledge" : "retrieve_knowledge";
    routing.target = "knowledge_fabric_agent";
    routing.operation = mutating ? "stage" : "retrieve";
    routing.gates.retrieval_required = !mutating;
    routing.gates.external_side_effect_approval = false;
    routing.budgets.response_ms = mutating ? 15_000 : 12_000;
    routing.legacy_alias = "knowledge_fabric_agent";
  } else if (agentId === "agentic_butler" && routing.route === "answer_direct") {
    routing.route = "execute_work_sync";
    routing.target = "agentic_butler";
    routing.operation = "execute_work";
    routing.gates.skill_orchestrator = false;
    routing.gates.max_task_agent_calls = 0;
    routing.budgets.response_ms = 20_000;
    routing.legacy_alias = "agentic_butler";
  }
  return {
    interface_contract: INPUT_CONTRACT,
    request_id: envelope.request_id || crypto.randomUUID(),
    message,
    principal: envelope.principal || {},
    context: envelope.context || envelope.metadata?.orchestrationEnvelope?.context || {},
    metadata: envelope.metadata || {},
    routing_contract: routing,
    original_envelope: envelope,
  };
}

function formatEvidence(retrieval = {}) {
  const hits = (retrieval.results || []).flatMap((entry) => entry.value || []).slice(0, 8);
  return hits.map((hit, index) => ({
    rank: index + 1,
    id: hit.id || hit.concept_id || hit.path || "",
    title: hit.title || hit.name || "Untitled evidence",
    content: String(hit.content || hit.summary || hit.text || "").slice(0, 2_500),
    source: hit.source_ref || hit.source || hit.path || "",
    review_state: hit.review_state || "approved",
    score: hit["@search.score"] || hit.score || null,
  }));
}

function baseSystemPrompt() {
  return [
    "You are the Me.IDs Actor Twin running behind an authenticated Azure backend.",
    "Answer the user directly, concisely, and in the user's language.",
    "Never invent personal, organizational, or source facts.",
    "When evidence is supplied, ground factual claims in it and cite sources by title in square brackets.",
    "When evidence is insufficient for a personal fact, say it is not found and ask exactly one targeted question.",
    "Do not claim that an external action, approval, write, deployment, or activation happened.",
    "Knowledge changes and external side effects require an explicit governed approval path.",
  ].join("\n");
}

function routeInstruction(route, evidence) {
  if (route === "retrieve_knowledge" || route === "retrieve_then_work") {
    return evidence.length
      ? "Use only the supplied reviewed evidence for stored facts. Distinguish evidence from inference."
      : "No reviewed evidence matched. Return not_found and ask one targeted question; do not speculate.";
  }
  if (route === "execute_work_sync") {
    return "Produce the requested no-side-effect work artifact. This is one bounded task, so do not simulate extra agents or claim tool execution.";
  }
  if (route === "elicit_tacit_knowledge") {
    return "Act as the Agentic Butler conducting a tacit-knowledge interview. Ask exactly one concise, context-specific question. Do not summarize, stage, approve, or persist knowledge in this turn.";
  }
  return "Respond directly. Avoid unnecessary orchestration narration.";
}

function elapsedMs(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function remainingStageBudget(deadline, capMs, code = "azure_agent_budget_exhausted") {
  const remaining = Math.floor(deadline - Date.now());
  if (remaining < 5_000) {
    const error = new Error("Azure-native agent exhausted its end-to-end response budget before the next required stage.");
    error.statusCode = 504;
    error.code = code;
    error.noRetry = true;
    throw error;
  }
  return Math.min(capMs, remaining);
}

function parseJsonObject(value, fallback = {}) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function learningRecommended(request, answer) {
  if (request.metadata?.side_effect_policy === "no_write_probe") return false;
  const text = `${request.message}\n${answer}`.toLowerCase();
  return /\b(remember|retain|lesson|learned|correction|corrected|decision rationale|preference|merke|behalte|lektion|gelernt|korrektur|korrigiert|entscheidungsgrund|pr[aä]ferenz)\b/i.test(text);
}

async function runBoundedButler(request, evidence, roleExecutions, deadline) {
  const startedAt = Date.now();
  const completion = await completeChat([
    { role: "system", content: baseSystemPrompt() },
    { role: "system", content: "You are the Agentic Butler for one bounded, no-side-effect task. Produce the requested artifact directly. Do not invoke or simulate a Skill Orchestrator, Task Agent, external action, persistence, or approval." },
    ...(evidence.length ? [{ role: "system", content: `Reviewed evidence:\n${JSON.stringify(evidence)}` }] : []),
    { role: "user", content: request.message },
  ], { timeoutMs: remainingStageBudget(deadline, 25_000) });
  roleExecutions.push({ agent: "agentic_butler", mode: "single_task_bypass", duration_ms: elapsedMs(startedAt) });
  return { answer: completion.text, completion };
}

async function runSkillTaskChain(request, evidence, roleExecutions, deadline) {
  const maximumTasks = Math.max(1, Math.min(Number(request.routing_contract.gates?.max_task_agent_calls || 1), 2));
  const planStartedAt = Date.now();
  const planCompletion = await completeChat([
    { role: "system", content: `You are the Skill Orchestrator. Return only JSON with keys objective and tasks. tasks must contain 1-${maximumTasks} independent, no-side-effect task strings. Never include sending, publishing, scheduling, approval, persistence, deployment, or other external effects.` },
    { role: "user", content: request.message },
  ], { timeoutMs: remainingStageBudget(deadline, 12_000), maxOutputTokens: 800 });
  const parsedPlan = parseJsonObject(planCompletion.text, {});
  const tasks = (Array.isArray(parsedPlan.tasks) ? parsedPlan.tasks : [request.message])
    .map((task) => String(typeof task === "string" ? task : task?.task || task?.description || "").trim())
    .filter(Boolean)
    .slice(0, maximumTasks);
  roleExecutions.push({ agent: "skill_orchestrator", mode: "plan", duration_ms: elapsedMs(planStartedAt), task_count: tasks.length });

  const taskResults = [];
  for (const [index, task] of tasks.entries()) {
    const taskStartedAt = Date.now();
    const taskCompletion = await completeChat([
      { role: "system", content: "You are a bounded Task Agent. Complete only the assigned in-memory task. Do not perform or claim external actions, persistence, approval, deployment, or additional agent calls." },
      ...(evidence.length ? [{ role: "system", content: `Reviewed evidence:\n${JSON.stringify(evidence)}` }] : []),
      { role: "user", content: task },
    ], { timeoutMs: remainingStageBudget(deadline, 25_000), maxOutputTokens: 1_800 });
    taskResults.push({ task, result: taskCompletion.text });
    roleExecutions.push({ agent: "task_agent", mode: "execute", task_index: index, duration_ms: elapsedMs(taskStartedAt) });
  }

  const synthesisStartedAt = Date.now();
  const synthesis = await completeChat([
    { role: "system", content: `${baseSystemPrompt()}\nYou are the Agentic Butler. Synthesize the task results into one concise final answer. Do not claim external effects.` },
    { role: "user", content: `Original request:\n${request.message}\n\nTask results:\n${JSON.stringify(taskResults)}` },
  ], { timeoutMs: remainingStageBudget(deadline, 25_000), maxOutputTokens: 2_500 });
  roleExecutions.push({ agent: "agentic_butler", mode: "synthesize", duration_ms: elapsedMs(synthesisStartedAt) });
  return { answer: synthesis.text, completion: synthesis, plan: { objective: parsedPlan.objective || request.message, tasks }, taskResults };
}

function needsRetrieval(route, routing = {}) {
  return ["retrieve_knowledge", "retrieve_then_work"].includes(route)
    || routing.gates?.retrieval_required === true;
}

function requiresApproval(route, routing) {
  return routing.gates?.external_side_effect_approval === true
    || ["create_skill", "ingest_or_stage_knowledge"].includes(route);
}

function createAzureNativeAgentAdapter({ retrieveKnowledge }) {
  return createAgentExecutionAdapter("azure_native", async (request) => {
    const routing = request.routing_contract;
    const route = routing.route;
    const criticalRequested = routing.gates?.critical_faculty === true;
    const routeBudgetMs = Math.max(criticalRequested ? 15_000 : 5_000, Number(routing.budgets?.response_ms || 25_000));
    const routeDeadline = Date.now() + routeBudgetMs;
    const criticReserveMs = criticalRequested
      ? Math.min(8_000, Math.max(5_000, Math.floor(routeBudgetMs * 0.4)))
      : 0;
    const primaryDeadline = routeDeadline - criticReserveMs;
    if (route === "request_human_clarification") {
      return {
        status: "blocked",
        output: { answer: "What specific result should I produce for you?", route_decision: routing },
        trace: { runtime: "azure_native", target_agent: "human" },
      };
    }
    if (route === "execute_work_async") {
      return {
        status: "queued",
        output: {
          answer: "This multi-step request is ready for background execution.",
          enqueue_required: true,
          route_decision: routing,
        },
        trace: { runtime: "azure_native", target_agent: "agentic_butler" },
      };
    }
    if (requiresApproval(route, routing)) {
      return {
        status: "approval_required",
        output: {
          answer: route === "ingest_or_stage_knowledge"
            ? "I can prepare this as review-needed knowledge after you confirm the knowledge intake step."
            : "This action has an external effect and requires approval before execution.",
          route_decision: routing,
        },
        trace: { runtime: "azure_native", target_agent: routing.target },
      };
    }
    const roleExecutions = [];
    let retrieval = null;
    let evidence = [];
    if (needsRetrieval(route, routing)) {
      const retrievalStartedAt = Date.now();
      try {
        retrieval = await retrieveKnowledge(request, {
          timeoutMs: remainingStageBudget(primaryDeadline, 20_000, "azure_retrieval_budget_exhausted"),
        });
      } catch (error) {
        if (!["azure_search_timeout", "azure_search_unavailable"].includes(String(error.code || ""))) throw error;
        roleExecutions.push({ agent: "knowledge_fabric_agent", mode: "retrieve", status: "unavailable", duration_ms: elapsedMs(retrievalStartedAt) });
        return {
          status: "blocked",
          output: {
            answer: "Reviewed knowledge is temporarily unavailable. Please retry in a moment.",
            error_code: "retrieval_unavailable",
            route_decision: routing,
            evidence: [],
          },
          trace: {
            runtime: "azure_native",
            target_agent: "knowledge_fabric_agent",
            knowledge_retrieved: false,
            retrieval_status: "unavailable",
            search_retry_count: Number(error.searchRetries || 0),
            role_executions: roleExecutions,
          },
        };
      }
      evidence = formatEvidence(retrieval);
    }
    let completion;
    let answer;
    let skillPlan = null;
    let taskResults = [];
    if (route === "execute_work_sync" && routing.gates?.skill_orchestrator === true) {
      const chained = await runSkillTaskChain(request, evidence, roleExecutions, primaryDeadline);
      completion = chained.completion;
      answer = chained.answer;
      skillPlan = chained.plan;
      taskResults = chained.taskResults;
    } else if (["execute_work_sync", "retrieve_then_work"].includes(route)) {
      const bounded = await runBoundedButler(request, evidence, roleExecutions, primaryDeadline);
      completion = bounded.completion;
      answer = bounded.answer;
    } else {
      const startedAt = Date.now();
      completion = await completeChat([
        { role: "system", content: baseSystemPrompt() },
        { role: "system", content: routeInstruction(route, evidence) },
        ...(evidence.length ? [{ role: "system", content: `Reviewed evidence:\n${JSON.stringify(evidence)}` }] : []),
        { role: "user", content: request.message },
      ], { timeoutMs: remainingStageBudget(primaryDeadline, 25_000) });
      answer = completion.text;
      roleExecutions.push({
        agent: needsRetrieval(route, routing) ? "knowledge_fabric_agent" : "actor_twin",
        mode: needsRetrieval(route, routing) ? "retrieve_and_answer" : "direct",
        duration_ms: elapsedMs(startedAt),
      });
    }
    let critic = null;
    if (routing.gates?.critical_faculty === true) {
      const criticStartedAt = Date.now();
      critic = await completeChat([
        { role: "system", content: "Act as a concise Critical Faculty. Return only a corrected final answer. Remove unsupported claims, preserve citations, and retain approval boundaries." },
        { role: "user", content: `Question:\n${request.message}\n\nDraft answer:\n${answer}\n\nEvidence:\n${JSON.stringify(evidence)}` },
      ], {
        timeoutMs: remainingStageBudget(routeDeadline, criticReserveMs, "azure_critical_budget_exhausted"),
        maxOutputTokens: 1_200,
      });
      answer = critic.text;
      roleExecutions.push({ agent: "critical_faculty", mode: "conditional_review", duration_ms: elapsedMs(criticStartedAt) });
    }
    const recommendLearning = learningRecommended(request, answer);
    return {
      status: "completed",
      output: {
        answer,
        summary: answer.slice(0, 1_000),
        route_decision: routing,
        evidence: evidence.map(({ id, title, source, review_state, score }) => ({ id, title, source, review_state, score })),
        ...(skillPlan ? { skill_plan: skillPlan, task_results: taskResults } : {}),
      },
      trace: {
        runtime: "azure_native",
        provider: completion.provider,
        model: completion.model,
        provider_throttle_retries: Number(completion.throttleRetries || 0),
        provider_throttle_rejections: Number(completion.throttleRejections || 0),
        target_agent: routing.target,
        knowledge_retrieved: Boolean(retrieval),
        search_retry_count: Number(retrieval?.search_retry_count || 0),
        critical_faculty_applied: Boolean(critic),
        learning_mode: routing.gates?.learning_mode || "post_turn_only",
        trace_learning_recommended: recommendLearning
          ? { recommended: true, review_state: "review_needed", summary: "The interaction contains an explicit correction, preference, decision rationale, or learning signal." }
          : null,
        role_executions: roleExecutions,
      },
    };
  });
}

async function createAzureNativeLearningProposal(payload = {}) {
  const source = String(payload.source_interaction_summary || payload.query || "").trim();
  if (!source) throw new Error("Learning proposal requires a source interaction summary.");
  const completion = await completeChat([
    { role: "system", content: [
      "You are the Me.IDs Learning Agent running asynchronously after the user-visible answer.",
      "Return only JSON with summary, increment_type, and concept_deltas.",
      "Create a proposal only; its review state is always review_needed.",
      "Preserve uncertainty and provenance. Do not approve, publish, activate, or claim persistence.",
      "concept_deltas is an array of at most 3 objects with operation=create|update|merge|relate and delta.",
    ].join("\n") },
    { role: "user", content: source },
  ], { timeoutMs: 25_000, maxOutputTokens: 1_500 });
  const proposal = parseJsonObject(completion.text, { summary: completion.text, increment_type: "agent_learning", concept_deltas: [] });
  return {
    summary: String(proposal.summary || source).slice(0, 20_000),
    increment_type: String(proposal.increment_type || "agent_learning").slice(0, 100),
    concept_deltas: (Array.isArray(proposal.concept_deltas) ? proposal.concept_deltas : []).slice(0, 3),
    payload: {
      source_trace_id: payload.trace_id || "",
      source_request_id: payload.request_id || "",
      source_interaction_summary: source,
      proposal,
      provider: completion.provider,
      model: completion.model,
      target_review_state: "review_needed",
    },
  };
}

function runtimeStatus() {
  const config = azureOpenAiChatConfigFromEnv();
  return {
    adapter: "azure_native",
    configured: config.configured,
    provider: config.provider,
    model_configured: Boolean(config.deployment),
    authentication: config.authMode,
  };
}

module.exports = {
  portableRequest,
  createAzureNativeAgentAdapter,
  createAzureNativeLearningProposal,
  learningRecommended,
  runtimeStatus,
};
