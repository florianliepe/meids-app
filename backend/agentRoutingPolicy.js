const POLICY_VERSION = "meids.agent-routing.v1";

function classifyAgentInteraction(input = {}) {
  const policyVersion = "meids.agent-routing.v1";
  const message = String(input.message || input.chatInput || "").trim();
  const text = message.toLowerCase();
  const has = (pattern) => pattern.test(text);
  const matches = (pattern) => text.match(pattern) || [];

  const explicitKnowledgeWrite = has(/\b(remember|save|store|retain|ingest|upload|attach|add|update|capture|stage|merke\w*|speicher\w*|behalt\w*|hochlad\w*|anh[aä]ng\w*|erg[aä]nz\w*)\b.{0,45}\b(knowledge|memory|note|source|document|transcript|wissen|notiz|quelle|dokument|transkript)\b|\b(remember this|save this|merke dir das|speichere das)\b/i);
  const evidenceRequest = has(/\b(source|sources|evidence|citation|cite|according to|documented|reviewed knowledge|okf|knowledge graph|vector|quelle|quellen|beleg|belege|zitat|laut dokument|wissensgraph)\b/i);
  const storedFactRequest = has(/\b(what do (we|you) know|find in|search (the )?knowledge|show evidence|who am i|my |mine |our |active twin|this twin|prior work|previous decision|wer bin ich|was (weißt|wissen)|mein(e|er|en|em)? |unser(e|er|en|em)? |fr[uü]here|vorherige)\b/i);
  const workIntent = has(/\b(draft|write|prepare|compose|summari[sz]e|prioriti[sz]e|plan|analyse|analyze|compare|create|build|generate|review|entwirf|schreib|erstelle|bereite|fasse|priorisiere|plane|analysiere|vergleiche|pr[uü]fe)\b/i);
  const capabilityCreation = has(/\b(new|create|build|design|generate|neue[nmrs]?|erstelle|entwickle)\b.{0,30}\b(skill|agent|subagent|task agent|capability|f[aä]higkeit)\b/i);
  const tacitInterview = has(/\b(tacit|implicit knowledge|decision criteria|best practice|lessons learned|interview me|circular question|deep dive|implizit|erfahrungswissen|entscheidungskriterien|best practice|lessons learned|interviewe? mich|zirkul[aä]re frage|tiefeninterview)\b/i);
  const explicitLearningNow = has(/\b(learn from this now|create (a )?learning summary now|retrospective now|after.action review now|lerne jetzt daraus|erstelle jetzt.{0,20}lerner|retrospektive jetzt)\b/i);
  const externalSideEffect = has(/\b(send|publish|schedule|book|delete|commit|deploy|approve|reject|activate|sende|ver[oö]ffentliche|plane ein|buche|l[oö]sche|deploye|genehmige|lehne ab|aktiviere)\b/i);
  const highImpact = has(/\b(legal|contract|financial|medical|security|privacy|production|architecture decision|binding|irreversible|rechtlich|vertrag|finanziell|medizinisch|sicherheit|datenschutz|produktion|architekturentscheidung|verbindlich|irreversibel)\b/i);
  const uncertainty = has(/\b(uncertain|ambiguous|contradict|conflict|weak evidence|assumption|unknown|unklar|mehrdeutig|widerspruch|konflikt|schwache belege|annahme|unbekannt)\b/i);
  const multiStepCue = has(/\b(first|then|after that|step by step|end.to.end|multiple|several|research and|analyse and|analyze and|compare and|zuerst|danach|anschlie[sß]end|schritt f[uü]r schritt|mehrere|recherchiere und|analysiere und|vergleiche und)\b/i);
  const conjunctions = matches(/\b(and|then|after|und|danach|anschlie[sß]end)\b/gi).length;
  const likelyMultiStep = workIntent && (multiStepCue || conjunctions >= 2 || message.length > 520);
  const missingObject = workIntent && message.split(/\s+/).length < 4;

  const knowledgeDependency = explicitKnowledgeWrite || evidenceRequest || storedFactRequest ? 3 : 0;
  const executionDepth = likelyMultiStep ? 3 : workIntent || tacitInterview ? 1 : 0;
  const decisionRisk = highImpact && (uncertainty || externalSideEffect) ? 3 : highImpact || externalSideEffect ? 2 : 0;
  const ambiguity = missingObject || uncertainty ? 2 : 0;

  let route = "answer_direct";
  let target = "actor_twin";
  let operation = "answer";
  if (explicitKnowledgeWrite) {
    route = "ingest_or_stage_knowledge";
    target = "knowledge_fabric_agent";
    operation = "stage";
  } else if (tacitInterview) {
    route = "elicit_tacit_knowledge";
    target = "agentic_butler";
    operation = "interview";
  } else if ((evidenceRequest || storedFactRequest) && workIntent) {
    route = "retrieve_then_work";
    target = "knowledge_fabric_agent_then_agentic_butler";
    operation = "retrieve_then_execute";
  } else if (evidenceRequest || storedFactRequest) {
    route = "retrieve_knowledge";
    target = "knowledge_fabric_agent";
    operation = "retrieve";
  } else if (missingObject) {
    route = "request_human_clarification";
    target = "human";
    operation = "clarify";
  } else if (capabilityCreation) {
    route = "create_skill";
    target = "agentic_butler";
    operation = "propose_capability";
  } else if (externalSideEffect) {
    route = "execute_work_sync";
    target = "agentic_butler";
    operation = "propose_approval_gated_action";
  } else if (workIntent) {
    route = likelyMultiStep ? "execute_work_async" : "execute_work_sync";
    target = "agentic_butler";
    operation = likelyMultiStep ? "queue_work" : "execute_work";
  }

  const criticalFaculty = decisionRisk >= 3
    || (decisionRisk >= 2 && knowledgeDependency >= 3)
    || (uncertainty && (knowledgeDependency >= 3 || executionDepth >= 3));
  const learningMode = explicitLearningNow ? "inline_required" : "post_turn_only";
  const responseBudgetMs = route === "answer_direct" ? 8_000
    : route === "retrieve_knowledge" ? 12_000
      : route === "execute_work_sync" ? 20_000
        : route === "execute_work_async" ? 3_000
          : 15_000;

  const contract = {
    contract: policyVersion,
    route,
    target,
    operation,
    scores: { knowledge_dependency: knowledgeDependency, execution_depth: executionDepth, decision_risk: decisionRisk, ambiguity },
    gates: {
      critical_faculty: criticalFaculty,
      learning_mode: learningMode,
      external_side_effect_approval: externalSideEffect,
      skill_orchestrator: likelyMultiStep,
      max_task_agent_calls: likelyMultiStep ? 2 : 0,
    },
    budgets: {
      response_ms: responseBudgetMs,
      max_inline_specialists: route === "retrieve_then_work" ? 2 : route === "answer_direct" ? 0 : 1,
      timeout_behavior: "return_bounded_fallback",
    },
  };
  const override = input.metadata?.routingContractOverride;
  const trustedNoWriteProbe = input.metadata?.source === "run-seven-agent-no-write-uat"
    && input.metadata?.intent === "live_probe"
    && input.metadata?.side_effect_policy === "no_write_probe"
    && input.metadata?.routingHints?.noWriteProbe === true;
  if (trustedNoWriteProbe && override?.route === "execute_work_sync") {
    contract.route = "execute_work_sync";
    contract.target = "agentic_butler";
    contract.operation = "execute_work";
    contract.gates.skill_orchestrator = override.skill_orchestrator === true;
    contract.gates.max_task_agent_calls = Math.max(0, Math.min(Number(override.max_task_agent_calls) || 0, 2));
    contract.gates.critical_faculty = false;
    contract.gates.external_side_effect_approval = false;
    contract.budgets.response_ms = 90_000;
    contract.budgets.max_inline_specialists = 1;
    contract.probe_override = "trusted_no_write_chain";
  }
  return contract;
}

function n8nClassifierCode() {
  return `const classifyAgentInteraction = ${classifyAgentInteraction.toString()};\nreturn $input.all().map((item) => ({ json: { ...item.json, routing_contract: classifyAgentInteraction(item.json) } }));`;
}

module.exports = { POLICY_VERSION, classifyAgentInteraction, n8nClassifierCode };
