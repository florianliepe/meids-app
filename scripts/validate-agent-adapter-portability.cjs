const assert = require("node:assert/strict");
const { POLICY_VERSION, classifyAgentInteraction } = require("../backend/agentRoutingPolicy");
const { INPUT_CONTRACT, BACKGROUND_CONTRACT, createAgentExecutionAdapter } = require("../backend/agentExecutionAdapter");

const cases = [
  ["direct", "Hello", "answer_direct", 8_000],
  ["retrieval", "Show reviewed evidence about my profile", "retrieve_knowledge", 12_000],
  ["single work", "Draft a concise note", "execute_work_sync", 20_000],
  ["background work", "Research and compare three options, then prepare a recommendation", "execute_work_async", 3_000],
];

for (const [name, message, route, budget] of cases) {
  const contract = classifyAgentInteraction({ message });
  assert.equal(contract.contract, POLICY_VERSION, `${name}: policy version drift`);
  assert.equal(contract.route, route, `${name}: route drift`);
  assert.equal(contract.budgets.response_ms, budget, `${name}: budget drift`);
  assert.equal(contract.budgets.timeout_behavior, "return_bounded_fallback", `${name}: fallback drift`);
}

const migrationBoundary = {
  input_contract: INPUT_CONTRACT,
  routing_contract: POLICY_VERSION,
  background_contract: BACKGROUND_CONTRACT,
  implementation_adapters: ["n8n", "azure_native"],
};
assert.deepEqual(migrationBoundary.implementation_adapters, ["n8n", "azure_native"]);

async function verifyExecutableAdapters() {
  const routing = classifyAgentInteraction({ message: "Draft a concise note" });
  const request = {
    interface_contract: INPUT_CONTRACT,
    background_contract: BACKGROUND_CONTRACT,
    routing_contract: routing,
    idempotency_key: "portable-fixture-1",
    authorization: { tenant_id: "tenant-fixture", twin_id: "twin-fixture", subject: "user-fixture" },
    input: { message: "Draft a concise note" },
  };
  const makeExecutor = () => async (portable) => {
    assert.equal(portable.background_contract, BACKGROUND_CONTRACT);
    assert.equal(portable.idempotency_key, "portable-fixture-1");
    assert.deepEqual(portable.authorization, request.authorization);
    return {
      status: "completed",
      output: { answer: "synthetic", route: portable.routing_contract.route },
      trace: { synthetic: true },
    };
  };
  const n8n = await createAgentExecutionAdapter("n8n", makeExecutor()).execute(request);
  const azure = await createAgentExecutionAdapter("azure_native", makeExecutor()).execute(request);
  assert.deepEqual({ ...n8n, adapter: "portable" }, { ...azure, adapter: "portable" });
  await assert.rejects(
    () => createAgentExecutionAdapter("invalid", async () => undefined).execute(request),
    /invalid result/,
  );
  return [n8n.adapter, azure.adapter];
}

verifyExecutableAdapters().then((adapters) => {
  console.log(JSON.stringify({ status: "passed", migration_boundary: migrationBoundary, executable_adapters: adapters }, null, 2));
}).catch((error) => { console.error(error.stack || error.message); process.exit(1); });
