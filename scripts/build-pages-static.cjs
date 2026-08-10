const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const frontendDir = path.join(root, "frontend");
const defaultOutputDir = path.join(root, "dist-pages");

const forbiddenPatterns = [
  /github_pat_/i,
  /\bsk-[A-Za-z0-9_-]{12,}/,
  /\bBearer\s+[A-Za-z0-9._-]+/i,
  /AZURE_[A-Z0-9_]*KEY\s*=/i,
];

function parseArgs(argv) {
  const args = { output: defaultOutputDir, clean: true, smoke: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output" || arg === "--out") {
      args.output = path.resolve(root, argv[index + 1] || "");
      index += 1;
    } else if (arg.startsWith("--output=")) {
      args.output = path.resolve(root, arg.slice("--output=".length));
    } else if (arg.startsWith("--out=")) {
      args.output = path.resolve(root, arg.slice("--out=".length));
    } else if (arg === "--no-clean") {
      args.clean = false;
    } else if (arg === "--no-smoke") {
      args.smoke = false;
    }
  }
  return args;
}

function rel(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function env(name) {
  return String(process.env[name] || "").trim();
}

function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

function assertNoSecrets(file, content) {
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) {
      throw new Error(`${rel(file)} contains forbidden secret-like value: ${pattern}`);
    }
  }
}

function shell(command, args) {
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Build command failed: node ${[command, ...args].join(" ")}`);
  }
}

function quoted(value) {
  return JSON.stringify(value || "");
}

function runtimeConfigJs() {
  const chatUrl = env("GH_PAGES_N8N_CHAT_WEBHOOK_URL");
  const actorUrl = env("GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL") || chatUrl;
  const knowledgeUrl = env("GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL");
  const butlerUrl = env("GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL");
  const apiBaseUrl = env("GH_PAGES_API_BASE_URL");

  function status(value) {
    return value ? "configured" : "awaiting_url";
  }

  return `window.INTELLECTUAL_TWIN_CONFIG = {
  apiBaseUrl: ${quoted(apiBaseUrl)},
  assetBaseUrl: "",
  n8nChatWebhookUrl: ${quoted(chatUrl)},
  n8nActorTwinWebhookUrl: ${quoted(actorUrl)},
  n8nKnowledgeFabricWebhookUrl: ${quoted(knowledgeUrl)},
  n8nAgenticButlerWebhookUrl: ${quoted(butlerUrl)},
  n8nAgentWebhooks: {
    actor_twin: ${quoted(actorUrl)},
    knowledge_fabric_agent: ${quoted(knowledgeUrl)},
    agentic_butler: ${quoted(butlerUrl)}
  },
  n8nAgentProbeSlots: {
    actor_twin: {
      status: ${quoted(status(actorUrl))},
      probe_boundary: "GitHub Pages runtime config generated from repository secrets.",
      next_action: ${quoted(actorUrl ? "Run Actor Twin UAT and capture n8n trace evidence." : "Set GH_PAGES_N8N_ACTOR_TWIN_WEBHOOK_URL or GH_PAGES_N8N_CHAT_WEBHOOK_URL.")}
    },
    knowledge_fabric_agent: {
      status: ${quoted(status(knowledgeUrl))},
      probe_boundary: "GitHub Pages runtime config generated from repository secrets.",
      next_action: ${quoted(knowledgeUrl ? "Run Knowledge Fabric Agent UAT with upload/transcript fixture." : "Set GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL.")}
    },
    agentic_butler: {
      status: ${quoted(status(butlerUrl))},
      probe_boundary: "GitHub Pages runtime config generated from repository secrets.",
      next_action: ${quoted(butlerUrl ? "Run Agentic Butler UAT with approval-gated skill activation fixture." : "Set GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL.")}
    }
  },
  n8nChatEnabled: ${Boolean(chatUrl || actorUrl)},
  staticPagesMode: ${apiBaseUrl === ""}
};
`;
}

function build() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.output || args.output === root) {
    throw new Error("Refusing to build Pages artifact into repository root.");
  }
  if (!fs.existsSync(frontendDir)) {
    throw new Error(`Missing frontend directory: ${rel(frontendDir)}`);
  }
  if (args.clean) fs.rmSync(args.output, { recursive: true, force: true });
  fs.mkdirSync(args.output, { recursive: true });
  copyDirectory(frontendDir, args.output);

  const runtimeConfigPath = path.join(args.output, "runtime-config.js");
  const runtimeConfig = runtimeConfigJs();
  assertNoSecrets(runtimeConfigPath, runtimeConfig);
  fs.writeFileSync(runtimeConfigPath, runtimeConfig, "utf8");

  const assetsDir = path.join(args.output, "assets");
  shell("scripts/write-pages-agent-runtime-config.cjs", ["--output", path.join(assetsDir, "agent-runtime-config.json")]);
  shell("scripts/write-n8n-runtime-readiness-status.cjs", [
    "--config",
    path.join(assetsDir, "agent-runtime-config.json"),
    "--output",
    path.join(assetsDir, "n8n-runtime-readiness-status.json"),
  ]);
  shell("scripts/write-n8n-live-readiness-preflight.cjs", [
    "--assets-dir",
    assetsDir,
    "--output",
    path.join(assetsDir, "n8n-live-readiness-preflight.json"),
    "--write",
  ]);
  shell("scripts/write-zielmodus-4-live-completion-checklist.cjs", [
    "--assets-dir",
    assetsDir,
    "--output",
    path.join(assetsDir, "zielmodus-4-live-completion-checklist.json"),
    "--write",
  ]);
  if (args.smoke) {
    shell("scripts/pages-smoke-check.cjs", [args.output]);
  }
  console.log(`Pages static artifact built: ${rel(args.output)}`);
}

build();
