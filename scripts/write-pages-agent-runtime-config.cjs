const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultOutputPath = path.join(root, "dist-pages", "assets", "agent-runtime-config.json");

const forbiddenPatterns = [
  /github_pat_/i,
  /\bsk-[A-Za-z0-9_-]{12,}/,
  /\bBearer\s+[A-Za-z0-9._-]+/i,
  /AZURE_[A-Z0-9_]*KEY\s*=/i,
];

function parseArgs(argv) {
  const args = { output: defaultOutputPath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output" || arg === "--out") {
      args.output = path.resolve(argv[index + 1] || "");
      index += 1;
    }
  }
  return args;
}

function env(name) {
  return String(process.env[name] || "").trim();
}

function assertNoSecrets(file, serialized) {
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(serialized)) {
      throw new Error(`${file} contains forbidden secret-like value: ${pattern}`);
    }
  }
}

function slot(status, probeBoundary, nextAction) {
  return {
    status,
    probe_boundary: probeBoundary,
    next_action: nextAction,
  };
}

function configuredStatus(value) {
  return value ? "configured" : "awaiting_url";
}

const DEFAULT_ACTOR_TWIN_CHAT_URL = "https://eraneos-agentic-platform.azurewebsites.net/webhook/b4afb251-2ad1-43da-9d7c-6f6473fbd3db/chat";
const LEGACY_ACTOR_TWIN_CHAT_URL = "https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/actor-twin/chat";

function actorTwinChatUrl(value) {
  const candidate = String(value || "").trim();
  if (!candidate || candidate === LEGACY_ACTOR_TWIN_CHAT_URL) return DEFAULT_ACTOR_TWIN_CHAT_URL;
  return candidate;
}

function buildConfig() {
  const chatUrl = actorTwinChatUrl(env("GH_PAGES_N8N_CHAT_WEBHOOK_URL"));
  const actorUrl = actorTwinChatUrl(env("GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL") || chatUrl);
  const knowledgeUrl = env("GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL");
  const butlerUrl = env("GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL");
  const voiceTranscriptionUrl = env("GH_PAGES_VOICE_TRANSCRIPTION_URL") || env("GH_PAGES_N8N_VOICE_TRANSCRIPTION_WEBHOOK_URL");

  return {
    purpose: "GitHub Pages generated public runtime endpoints for the MeIDs n8n agent runtime. Actor Twin embedded chat is the frontend entrypoint; Knowledge Fabric and Agentic Butler are normally called inside n8n as workflow tools.",
    generated_at: new Date().toISOString(),
    orchestration_mode: "actor_twin_embedded_chat",
    frontend_required_agents: ["actor_twin"],
    internal_n8n_tool_agents: ["knowledge_fabric_agent", "agentic_butler"],
    n8nAgentWebhooks: {
      actor_twin: actorUrl,
      knowledge_fabric_agent: knowledgeUrl,
      agentic_butler: butlerUrl,
    },
    n8nAgentProbeSlots: {
      actor_twin: slot(
        configuredStatus(actorUrl),
        "GitHub Pages runtime config generated from repository secrets.",
        actorUrl ? "Run Actor Twin UAT and capture n8n trace evidence." : "Set GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL or GH_PAGES_N8N_CHAT_WEBHOOK_URL.",
      ),
      knowledge_fabric_agent: slot(
        knowledgeUrl ? "configured" : "internal_tool_via_actor_twin",
        knowledgeUrl
          ? "Optional direct public Knowledge Fabric webhook configured for UAT."
          : "Knowledge Fabric Agent is expected to be called by Actor Twin inside n8n through a workflow tool. A direct public Pages URL is optional.",
        knowledgeUrl
          ? "Run Knowledge Fabric Agent direct UAT with upload/transcript fixture."
          : "Verify the Actor Twin n8n workflow has the Knowledge Fabric workflow tool connected and published.",
      ),
      agentic_butler: slot(
        butlerUrl ? "configured" : "internal_tool_via_actor_twin",
        butlerUrl
          ? "Optional direct public Agentic Butler webhook configured for UAT."
          : "Agentic Butler is expected to be called by Actor Twin inside n8n through a workflow tool. A direct public Pages URL is optional.",
        butlerUrl
          ? "Run Agentic Butler direct UAT with autonomous no-write work-artifact fixture."
          : "Verify the Actor Twin n8n workflow has the Agentic Butler workflow tool connected and published.",
      ),
    },
    n8nActorTwinWebhookUrl: actorUrl,
    n8nKnowledgeFabricWebhookUrl: knowledgeUrl,
    n8nAgenticButlerWebhookUrl: butlerUrl,
    voiceTranscriptionUrl,
    n8nVoiceTranscriptionWebhookUrl: voiceTranscriptionUrl,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = buildConfig();
  const serialized = JSON.stringify(config, null, 2);
  assertNoSecrets(args.output, serialized);
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${serialized}\n`, "utf8");
  console.log(`Pages agent runtime config written: ${path.relative(root, args.output).replaceAll("\\", "/")}`);
}

main();
