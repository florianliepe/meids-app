window.INTELLECTUAL_TWIN_CONFIG = {
  apiBaseUrl: "",
  assetBaseUrl: "",
  orchestrationMode: "actor_twin_embedded_chat",
  n8nChatWebhookUrl: "https://eraneos-agentic-platform.azurewebsites.net/webhook/b4afb251-2ad1-43da-9d7c-6f6473fbd3db/chat",
  n8nActorTwinWebhookUrl: "https://eraneos-agentic-platform.azurewebsites.net/webhook/b4afb251-2ad1-43da-9d7c-6f6473fbd3db/chat",
  n8nKnowledgeFabricWebhookUrl: "",
  n8nAgenticButlerWebhookUrl: "",
  n8nAgentWebhooks: {
    actor_twin: "https://eraneos-agentic-platform.azurewebsites.net/webhook/b4afb251-2ad1-43da-9d7c-6f6473fbd3db/chat",
    knowledge_fabric_agent: "",
    agentic_butler: ""
  },
  n8nAgentProbeSlots: {
    actor_twin: {
      status: "configured",
      probe_boundary: "GitHub Pages runtime config generated from repository secrets.",
      next_action: "Run Actor Twin UAT and capture n8n trace evidence."
    },
    knowledge_fabric_agent: {
      status: "internal_tool_via_actor_twin",
      probe_boundary: "Knowledge Fabric Agent is called by Actor Twin inside n8n through a workflow tool. A direct public Pages URL is optional.",
      next_action: "Verify the Actor Twin n8n workflow has the Knowledge Fabric workflow tool connected and published."
    },
    agentic_butler: {
      status: "internal_tool_via_actor_twin",
      probe_boundary: "Agentic Butler is called by Actor Twin inside n8n through a workflow tool. A direct public Pages URL is optional.",
      next_action: "Verify the Actor Twin n8n workflow has the Agentic Butler workflow tool connected and published."
    }
  },
  n8nChatEnabled: true,
  staticPagesMode: true
};
