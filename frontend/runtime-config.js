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
  n8nAgentProbeSlots: {
    actor_twin: {
      status: "configured",
      probe_boundary: "Static Pages stores the public UAT URL; live workflow proof is captured through cockpit probe or n8n execution trace.",
      next_action: "Run Actor Twin UAT and capture trace evidence.",
    },
    knowledge_fabric_agent: {
      status: "awaiting_url",
      probe_boundary: "Webhook slot prepared; no live POST is attempted until a public UAT or hosted backend URL exists.",
      next_action: "Create the Knowledge Fabric Agent n8n workflow, expose a public UAT webhook, then add it here.",
    },
    agentic_butler: {
      status: "awaiting_url",
      probe_boundary: "Webhook slot prepared; approval-gated skill activation remains fixture-only until live workflow URL exists.",
      next_action: "Create the Agentic Butler n8n workflow with approval gate, expose public UAT webhook, then add it here.",
    },
  },
  n8nChatEnabled: true,
  staticPagesMode: true,
};
