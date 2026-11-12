const crypto = require("node:crypto");
const { classifyAgentInteraction } = require("./agentRoutingPolicy");
const { createAgentExecutionAdapter, INPUT_CONTRACT } = require("./agentExecutionAdapter");
const { azureOpenAiChatConfigFromEnv, completeChat } = require("./azureOpenAiChat");

function messageFromEnvelope(envelope = {}) {
  return String(envelope.chatInput || envelope.input?.message || envelope.input?.query || "").trim();
}

function portableRequest(envelope = {}) {
  const message = messageFromEnvelope(envelope);
  const routing = classifyAgentInteraction({ message, metadata: envelope.metadata || {} });
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
  return "Respond directly. Avoid unnecessary orchestration narration.";
}

function needsRetrieval(route) {
  return ["retrieve_knowledge", "retrieve_then_work"].includes(route);
}

function requiresApproval(route, routing) {
  return routing.gates?.external_side_effect_approval === true
    || ["create_skill", "ingest_or_stage_knowledge"].includes(route);
}

function createAzureNativeAgentAdapter({ retrieveKnowledge }) {
  return createAgentExecutionAdapter("azure_native", async (request) => {
    const routing = request.routing_contract;
    const route = routing.route;
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
    let retrieval = null;
    let evidence = [];
    if (needsRetrieval(route)) {
      retrieval = await retrieveKnowledge(request);
      evidence = formatEvidence(retrieval);
    }
    const completion = await completeChat([
      { role: "system", content: baseSystemPrompt() },
      { role: "system", content: routeInstruction(route, evidence) },
      ...(evidence.length ? [{ role: "system", content: `Reviewed evidence:\n${JSON.stringify(evidence)}` }] : []),
      { role: "user", content: request.message },
    ], { timeoutMs: Math.min(routing.budgets.response_ms, 25_000) });
    let answer = completion.text;
    let critic = null;
    if (routing.gates?.critical_faculty === true) {
      critic = await completeChat([
        { role: "system", content: "Act as a concise Critical Faculty. Return only a corrected final answer. Remove unsupported claims, preserve citations, and retain approval boundaries." },
        { role: "user", content: `Question:\n${request.message}\n\nDraft answer:\n${answer}\n\nEvidence:\n${JSON.stringify(evidence)}` },
      ], { timeoutMs: Math.min(8_000, routing.budgets.response_ms), maxOutputTokens: 1_200 });
      answer = critic.text;
    }
    return {
      status: "completed",
      output: {
        answer,
        summary: answer.slice(0, 1_000),
        route_decision: routing,
        evidence: evidence.map(({ id, title, source, review_state, score }) => ({ id, title, source, review_state, score })),
      },
      trace: {
        runtime: "azure_native",
        provider: completion.provider,
        model: completion.model,
        target_agent: routing.target,
        knowledge_retrieved: Boolean(retrieval),
        critical_faculty_applied: Boolean(critic),
        learning_mode: routing.gates?.learning_mode || "post_turn_only",
      },
    };
  });
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

module.exports = { portableRequest, createAzureNativeAgentAdapter, runtimeStatus };
