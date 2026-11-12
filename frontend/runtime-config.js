window.INTELLECTUAL_TWIN_CONFIG = {
  apiBaseUrl: "",
  agentBackendBaseUrl: "",
  agentBackendProxyEnabled: true,
  assetBaseUrl: "/static",
  n8nChatWebhookUrl: "",
  n8nActorTwinWebhookUrl: "",
  n8nKnowledgeFabricWebhookUrl: "",
  n8nAgenticButlerWebhookUrl: "",
  voiceTranscriptionUrl: "",
  n8nVoiceTranscriptionWebhookUrl: "",
  n8nAgentWebhooks: {
    actor_twin: "",
    knowledge_fabric_agent: "",
    agentic_butler: "",
  },
  n8nAgentProbeSlots: {
    actor_twin: {
      status: "backend_only",
      probe_boundary: "Actor Twin uses the authenticated backend composer; no n8n endpoint is published to the browser.",
      next_action: "Use backend runtime and trace evidence for Actor Twin readiness.",
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
  n8nChatEnabled: false,
  nativeActorChatEnabled: true,
  staticPagesMode: true,
  features: {
    graphExplorerV2: false,
  },
  auth: {
    enabled: false,
    provider: "azure_static_web_apps_entra_id",
    loginUrl: "/.auth/login/eraneos",
    logoutUrl: "/.auth/logout",
    allowInvitedExternalUsers: true,
    plannedSubdomain: "intellectual-twin",
    multiTwinOwnership: true,
  },
};
