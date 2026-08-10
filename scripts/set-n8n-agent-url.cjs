const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "frontend", "assets", "agent-runtime-config.json");

const agents = {
  actor_twin: {
    name: "Actor Twin",
    topLevelKey: "n8nActorTwinWebhookUrl",
    nextAction: "Run Actor Twin UAT and capture n8n trace evidence.",
  },
  knowledge_fabric_agent: {
    name: "Knowledge Fabric Agent",
    topLevelKey: "n8nKnowledgeFabricWebhookUrl",
    nextAction: "Run Knowledge Fabric Agent UAT with upload/transcript fixture.",
  },
  agentic_butler: {
    name: "Agentic Butler",
    topLevelKey: "n8nAgenticButlerWebhookUrl",
    nextAction: "Run Agentic Butler UAT with approval-gated skill activation fixture.",
  },
};

const forbiddenPatterns = [
  /github_pat_/i,
  /\bsk-[A-Za-z0-9_-]{12,}/,
  /\bBearer\s+[A-Za-z0-9._-]+/i,
  /AZURE_[A-Z0-9_]*KEY\s*=/i,
];

function usage() {
  return [
    "Usage:",
    "  node scripts/set-n8n-agent-url.cjs --agent knowledge_fabric_agent --url https://.../webhook/... ",
    "  node scripts/set-n8n-agent-url.cjs --agent agentic_butler --url https://.../webhook/... ",
    "",
    "Allowed agents: actor_twin, knowledge_fabric_agent, agentic_butler",
    "Boundary: public UAT webhook URLs only. Do not pass API keys, tokens, or private internal URLs.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--agent") {
      args.agent = argv[index + 1];
      index += 1;
    } else if (arg === "--url") {
      args.url = argv[index + 1];
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }
  return args;
}

function fail(message) {
  console.error(message);
  console.error("");
  console.error(usage());
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertPublicWebhookUrl(value) {
  const urlValue = String(value || "").trim();
  if (!urlValue) fail("Missing --url value.");
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(urlValue)) fail(`URL contains forbidden secret-like value: ${pattern}`);
  }
  let parsed;
  try {
    parsed = new URL(urlValue);
  } catch {
    fail("URL is not valid.");
  }
  if (parsed.protocol !== "https:") fail("URL must use https.");
  if (!/\/webhook\//i.test(parsed.pathname)) fail("URL path must include /webhook/.");
  return parsed.toString();
}

function runNodeScript(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script), ...args], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status || 1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const agentId = String(args.agent || "").trim();
  const agent = agents[agentId];
  if (!agent) fail(`Unsupported --agent value: ${agentId || "(missing)"}`);
  const url = assertPublicWebhookUrl(args.url);
  const config = readJson(configPath);
  config.n8nAgentWebhooks = config.n8nAgentWebhooks || {};
  config.n8nAgentProbeSlots = config.n8nAgentProbeSlots || {};
  config.n8nAgentWebhooks[agentId] = url;
  config[agent.topLevelKey] = url;
  config.n8nAgentProbeSlots[agentId] = {
    status: "configured",
    probe_boundary: "Public UAT webhook configured through scripts/set-n8n-agent-url.cjs. Live workflow proof still requires cockpit probe or n8n execution trace.",
    next_action: agent.nextAction,
  };
  writeJson(configPath, config);
  console.log(`${agent.name} public UAT URL written to frontend/assets/agent-runtime-config.json`);
  runNodeScript("write-n8n-runtime-readiness-status.cjs");
  runNodeScript("validate-zielmodus-4-readiness.cjs", ["--write"]);
}

main();
