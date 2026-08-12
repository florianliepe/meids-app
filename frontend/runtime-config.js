window.INTELLECTUAL_TWIN_CONFIG = {
  apiBaseUrl: "",
  agentBackendBaseUrl: "",
  agentBackendProxyEnabled: true,
  assetBaseUrl: "/static",
  n8nChatWebhookUrl: "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/actor-twin/chat",
  n8nActorTwinWebhookUrl: "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/actor-twin/chat",
  n8nKnowledgeFabricWebhookUrl: "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/knowledge-fabric/ingest",
  n8nAgenticButlerWebhookUrl: "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/agentic-butler/run",
  n8nAgentWebhooks: {
    actor_twin: "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/actor-twin/chat",
    knowledge_fabric_agent: "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/knowledge-fabric/ingest",
    agentic_butler: "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/agentic-butler/run",
  },
  n8nAgentProbeSlots: {
    actor_twin: {
      status: "configured",
      probe_boundary: "Static Pages stores the public UAT URL; live workflow proof is captured through cockpit probe or n8n execution trace.",
      next_action: "Run Actor Twin UAT and capture trace evidence.",
    },
    knowledge_fabric_agent: {
      status: "configured",
      probe_boundary: "Static Pages stores the public UAT URL; production should call the hosted backend proxy.",
      next_action: "Run Knowledge Fabric UAT and capture trace evidence.",
    },
    agentic_butler: {
      status: "configured",
      probe_boundary: "Static Pages stores the public UAT URL; approval resume requires the hosted backend proxy.",
      next_action: "Run Agentic Butler approval-gated UAT and capture trace evidence.",
    },
  },
  n8nChatEnabled: true,
  staticPagesMode: true,
};
