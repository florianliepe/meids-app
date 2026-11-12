const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { portableRequest, createAzureNativeAgentAdapter } = require("../backend/azureNativeAgentRuntime");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

async function run() {
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "backend", "server.js"), "utf8");
  assert.match(serverSource, /action:\s*"sendMessage"/);
  assert.match(serverSource, /sessionId:\s*String\(body\.session_id \|\| body\.sessionId \|\| requestId\)/);
  assert.match(serverSource, /knowledgeAccessToken,\s*\n\s*knowledgeScope:\s*"active_twin"/);

  process.env.AZURE_OPENAI_ENDPOINT = "";
  process.env.AZURE_OPENAI_CHAT_DEPLOYMENT = "";
  process.env.ERANEOS_AI_GATEWAY_BASE_URL = "https://gateway.example/v1";
  process.env.ERANEOS_AI_GATEWAY_CHAT_MODEL = "test-model";
  process.env.ERANEOS_AI_GATEWAY_API_KEY = "test-key";
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Grounded test answer [Reviewed source]" } }],
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
}

run().then(() => {
  console.log(JSON.stringify({ status: "passed", contract: "azure-native route, retrieval, approval and async boundaries" }, null, 2));
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
