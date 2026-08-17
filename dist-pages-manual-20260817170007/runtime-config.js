window.INTELLECTUAL_TWIN_CONFIG = {
  apiBaseUrl: "",
  agentBackendBaseUrl: "",
  agentBackendProxyEnabled: true,
  assetBaseUrl: "/static",
  n8nChatWebhookUrl: "https://eraneos-agentic-platform.azurewebsites.net/webhook/b4afb251-2ad1-43da-9d7c-6f6473fbd3db/chat",
  n8nActorTwinWebhookUrl: "https://eraneos-agentic-platform.azurewebsites.net/webhook/b4afb251-2ad1-43da-9d7c-6f6473fbd3db/chat",
  n8nKnowledgeFabricWebhookUrl: "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/knowledge-fabric/ingest",
  n8nAgenticButlerWebhookUrl: "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/agentic-butler/run",
  n8nAgentWebhooks: {
    actor_twin: "https://eraneos-agentic-platform.azurewebsites.net/webhook/b4afb251-2ad1-43da-9d7c-6f6473fbd3db/chat",
    knowledge_fabric_agent: "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/knowledge-fabric/ingest",
    agentic_butler: "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/agentic-butler/run",
  },
  n8nAgentProbeSlots: {
    actor_twin: {
      status: "configured",
      probe_boundary: "Static Pages embeds the public n8n Actor Twin chat. Live proof is captured through n8n chat execution traces.",
      next_action: "Run Actor Twin embedded-chat UAT and verify calls to internal workflow tools when needed.",
    },
    knowledge_fabric_agent: {
      status: "internal_tool_via_actor_twin",
      probe_boundary: "Knowledge Fabric Agent is called by Actor Twin inside n8n through a workflow tool. A direct public Pages URL is optional for probes only.",
      next_action: "Verify the Actor Twin n8n workflow has the Knowledge Fabric workflow tool connected and published.",
    },
    agentic_butler: {
      status: "internal_tool_via_actor_twin",
      probe_boundary: "Agentic Butler is called by Actor Twin inside n8n through a workflow tool. A direct public Pages URL is optional for probes only.",
      next_action: "Verify the Actor Twin n8n workflow has the Agentic Butler workflow tool connected and published.",
    },
  },
  n8nChatEnabled: true,
  staticPagesMode: true,
};
