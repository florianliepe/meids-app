window.INTELLECTUAL_TWIN_CONFIG = {
  apiBaseUrl: "",
  assetBaseUrl: "/static",
  n8nChatWebhookUrl: "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/actor-twin/chat",
  n8nActorTwinWebhookUrl: "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/actor-twin/chat",
  n8nKnowledgeFabricWebhookUrl: "",
  n8nAgenticButlerWebhookUrl: "",
  n8nAgentWebhooks: {
    actor_twin: "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/actor-twin/chat",
    // Add the live Knowledge Fabric Agent webhook when the n8n workflow is available.
    knowledge_fabric_agent: "",
    // Add the live Agentic Butler webhook when the approval-gated skill workflow is available.
    agentic_butler: "",
  },
  n8nChatEnabled: true,
  staticPagesMode: true,
};
