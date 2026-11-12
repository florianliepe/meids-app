const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  portableRequest,
  createAzureNativeAgentAdapter,
  createAzureNativeLearningProposal,
} = require("../backend/azureNativeAgentRuntime");
const { completeChat } = require("../backend/azureOpenAiChat");
const { agentRuntimeFallbackAllowed } = require("../backend/server");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

async function run() {
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "backend", "server.js"), "utf8");
  assert.match(serverSource, /action:\s*"sendMessage"/);
  assert.match(serverSource, /sessionId:\s*String\(body\.session_id \|\| body\.sessionId \|\| requestId\)/);
  assert.match(serverSource, /knowledgeAccessToken,\s*\n\s*knowledgeScope:\s*"active_twin"/);
  assert.match(serverSource, /job_type:\s*"learning_post_turn"/);
  assert.match(serverSource, /idempotency_key:\s*`learning:/);
  assert.match(serverSource, /knowledge_access_token:\s*omittedToken/);

  process.env.AZURE_OPENAI_ENDPOINT = "";
  process.env.AZURE_OPENAI_CHAT_DEPLOYMENT = "";
  process.env.ERANEOS_AI_GATEWAY_BASE_URL = "https://gateway.example/v1";
  process.env.ERANEOS_AI_GATEWAY_CHAT_MODEL = "test-model";
  process.env.ERANEOS_AI_GATEWAY_API_KEY = "test-key";
  const calls = [];
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    const system = body.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
    let content = "Grounded test answer [Reviewed source]";
    if (system.includes("You are the Skill Orchestrator")) {
      content = JSON.stringify({ objective: "Check ordering", tasks: ["Check alpha, beta, gamma ordering"] });
    } else if (system.includes("You are a bounded Task Agent")) {
      content = "alpha, beta, gamma are ordered.";
    } else if (system.includes("Synthesize the task results")) {
      content = "The ordering check passed.";
    } else if (system.includes("You are the Me.IDs Learning Agent")) {
      content = JSON.stringify({ summary: "User corrected a durable preference.", increment_type: "preference_correction", concept_deltas: [{ operation: "update", delta: { field: "preference" } }] });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  let retrievalCalls = 0;
  const adapter = createAzureNativeAgentAdapter({
    async retrieveKnowledge() {
      retrievalCalls += 1;
      return { results: [{ value: [{ id: "e1", title: "Reviewed source", content: "Reviewed fact", review_state: "approved" }] }] };
    },
  });

  const direct = await adapter.execute(portableRequest({ request_id: "direct", chatInput: "Hello there" }));
  assert.equal(direct.status, "completed");
  assert.equal(direct.route, "answer_direct");
  assert.equal(retrievalCalls, 0);

  const retrieval = await adapter.execute(portableRequest({ request_id: "retrieve", chatInput: "What do you know about my role?" }));
  assert.equal(retrieval.status, "completed");
  assert.equal(retrieval.route, "retrieve_knowledge");
  assert.equal(retrievalCalls, 1);
  assert.equal(retrieval.output.evidence[0].review_state, "approved");

  const approval = await adapter.execute(portableRequest({ request_id: "write", chatInput: "Remember this as knowledge" }));
  assert.equal(approval.status, "approval_required");
  assert.equal(calls.length, 2, "Approval-gated knowledge intake must not call the model");

  const queued = await adapter.execute(portableRequest({
    request_id: "async",
    chatInput: "First analyse the plan, then compare the options, and after that prepare a recommendation",
  }));
  assert.equal(queued.status, "queued");
  assert.equal(queued.output.enqueue_required, true);
  assert.equal(calls.length, 2, "Async acknowledgement must not call the model inline");

  const boundedStart = calls.length;
  const bounded = await adapter.execute(portableRequest({ request_id: "bounded", chatInput: "Draft a concise greeting" }));
  assert.equal(bounded.status, "completed");
  assert.equal(bounded.route, "execute_work_sync");
  assert.equal(calls.length - boundedStart, 1, "One bounded task must bypass Skill Orchestrator");
  assert.deepEqual(bounded.trace.role_executions.map((item) => item.agent), ["agentic_butler"]);
  assert.equal(bounded.trace.role_executions[0].mode, "single_task_bypass");

  const chainStart = calls.length;
  const chain = await adapter.execute(portableRequest({
    request_id: "chain",
    chatInput: "Check alpha, beta, gamma ordering",
    metadata: {
      source: "run-seven-agent-no-write-uat",
      intent: "live_probe",
      side_effect_policy: "no_write_probe",
      routingHints: { noWriteProbe: true },
      routingContractOverride: { route: "execute_work_sync", skill_orchestrator: true, max_task_agent_calls: 1 },
    },
  }));
  assert.equal(chain.status, "completed");
  assert.equal(chain.route, "execute_work_sync");
  assert.equal(calls.length - chainStart, 3, "Skill work must plan, execute one task, and synthesize");
  assert.deepEqual(chain.trace.role_executions.map((item) => item.agent), ["skill_orchestrator", "task_agent", "agentic_butler"]);
  assert.equal(chain.output.task_results.length, 1);

  const learning = await createAzureNativeLearningProposal({
    request_id: "learning",
    trace_id: "trace-learning",
    source_interaction_summary: "The user corrected a durable preference.",
  });
  assert.equal(learning.increment_type, "preference_correction");
  assert.equal(learning.concept_deltas[0].operation, "update");
  assert.equal(learning.payload.target_review_state, "review_needed");

  assert.equal(agentRuntimeFallbackAllowed({ statusCode: 401, code: "blocked_auth_context" }), false);
  assert.equal(agentRuntimeFallbackAllowed({ statusCode: 403 }), false);
  assert.equal(agentRuntimeFallbackAllowed({ code: "azure_chat_timeout", noRetry: true }), false);
  assert.equal(agentRuntimeFallbackAllowed({ statusCode: 503, code: "azure_chat_failed" }), true);

  global.fetch = async () => {
    const error = new Error("timed out");
    error.name = "TimeoutError";
    throw error;
  };
  await assert.rejects(
    () => completeChat([{ role: "user", content: "test" }], {
      timeoutMs: 5_000,
      config: {
        provider: "eraneos_gateway", configured: true, endpoint: "https://gateway.example/v1", deployment: "test-model",
        apiKey: "test-key", authMode: "api_key", timeoutMs: 5_000, maxOutputTokens: 256,
      },
    }),
    (error) => error.code === "azure_chat_timeout" && error.noRetry === true && error.unknownCompletion === true,
  );
}

run().then(() => {
  console.log(JSON.stringify({ status: "passed", contract: "azure-native route, retrieval, Butler bypass, Skill chain, Learning, approval and async boundaries" }, null, 2));
}).finally(() => {
  global.fetch = originalFetch;
  Object.keys(process.env).forEach((key) => {
    if (!(key in originalEnv)) delete process.env[key];
  });
  Object.assign(process.env, originalEnv);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
