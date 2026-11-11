const { POLICY_VERSION } = require("./agentRoutingPolicy");

const INPUT_CONTRACT = "meids.actor_twin.embedded_chat.v1";
const BACKGROUND_CONTRACT = "meids.agent-work.v1";

function assertPortableAgentRequest(request = {}) {
  if (request.interface_contract !== INPUT_CONTRACT) throw new Error("Agent adapter input contract mismatch.");
  if (request.routing_contract?.contract !== POLICY_VERSION) throw new Error("Agent adapter routing contract mismatch.");
  if (!request.routing_contract?.route || !request.routing_contract?.budgets?.response_ms) {
    throw new Error("Agent adapter requires a routed request with an explicit response budget.");
  }
  return request;
}

function createAgentExecutionAdapter(name, execute) {
  if (!name || typeof execute !== "function") throw new Error("An agent adapter name and execute function are required.");
  return {
    name,
    async execute(request) {
      const portable = assertPortableAgentRequest(request);
      const result = await execute(portable);
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error(`Agent adapter ${name} returned an invalid result.`);
      }
      if (!result.status || !("output" in result)) {
        throw new Error(`Agent adapter ${name} must return status and output.`);
      }
      return {
        adapter: name,
        contract: portable.routing_contract.contract,
        route: portable.routing_contract.route,
        budget_ms: portable.routing_contract.budgets.response_ms,
        status: result.status,
        output: result.output,
        trace: result.trace || {},
      };
    },
  };
}

module.exports = {
  INPUT_CONTRACT,
  BACKGROUND_CONTRACT,
  assertPortableAgentRequest,
  createAgentExecutionAdapter,
};
