const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const requireLive = args.has("--require-live");
const write = args.has("--write");
const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
const outputPath = outputArg
  ? path.resolve(root, outputArg.slice("--output=".length))
  : path.join(root, "frontend", "assets", "zielmodus-4-readiness-status.json");

const requirements = [
  {
    id: "okf_schema",
    label: "OKF markdown/YAML schema",
    evidence: [
      "docs/knowledge-fabric-okf-schema.md",
      "contracts/okf/examples/concepts",
      "contracts/okf/examples/evidence",
      "contracts/okf/examples/transcripts",
      "contracts/okf/examples/graph/nodes",
      "contracts/okf/examples/graph/edges",
    ],
  },
  {
    id: "repo_split",
    label: "Repo split target",
    evidence: [
      "docs/production/repo-split-handoff-checklist.md",
      "docs/production/agent-config-repo-scaffold.md",
    ],
  },
  {
    id: "knowledge_fabric_ingest",
    label: "Knowledge Fabric Agent ingest path",
    evidence: [
      "contracts/okf/ingest/sample-ingest-request.json",
      "scripts/mock-okf-ingest.cjs",
      "contracts/okf/generated/concepts",
      "contracts/okf/generated/evidence",
      "contracts/okf/generated/transcripts",
      "contracts/okf/generated/audit",
      "contracts/okf/generated/graph/edges",
    ],
  },
  {
    id: "graph_promotion",
    label: "Graph relation promotion workflow",
    evidence: [
      "contracts/okf/promotions/README.md",
      "contracts/okf/promotions/approve-edge-example.json",
      "contracts/okf/promotions/needs-rework-edge-example.json",
      "contracts/okf/promotions/reject-edge-example.json",
      "scripts/validate-graph-promotions.cjs",
    ],
  },
  {
    id: "vector_boundary",
    label: "Vector DB adapter boundary without credentials",
    evidence: [
      "contracts/okf/examples/vector",
      "contracts/okf/negative/vector",
      "scripts/validate-vector-adapter.cjs",
    ],
  },
  {
    id: "browser_dark_mode",
    label: "Knowledge Browser dark-mode QA",
    evidence: [
      "docs/qa/knowledge-browser-dark-mode-qa.md",
      "docs/visual-qa/screenshots-20260810-z4-knowledge-browser-dark-polish/browser-dark-mode-qa.json",
      "docs/visual-qa/screenshots-20260810-z4-final-audit/knowledge-desktop-dark.png",
      "docs/visual-qa/screenshots-20260810-z4-final-audit/knowledge-mobile-dark.png",
    ],
  },
  {
    id: "graph_dark_mode",
    label: "Knowledge Graph dark-mode QA",
    evidence: [
      "docs/qa/knowledge-browser-dark-mode-qa.md",
      "docs/visual-qa/screenshots-20260810-z4-graph-legend-dark-polish/browser-dark-mode-qa.json",
      "docs/visual-qa/screenshots-20260810-z4-final-audit/graph-desktop-dark.png",
      "docs/visual-qa/screenshots-20260810-z4-final-audit/graph-mobile-dark.png",
    ],
  },
  {
    id: "agent_trace_ui",
    label: "Agent trace/history UI",
    evidence: [
      "docs/visual-qa/screenshots-20260810-z4-chat-latest-agent-traces/chat-latest-agent-traces-qa.json",
      "docs/visual-qa/screenshots-20260810-z4-final-audit/trace-dashboard-desktop-dark.png",
      "docs/visual-qa/screenshots-20260810-z4-final-audit/trace-dashboard-mobile-dark.png",
    ],
  },
  {
    id: "live_url_guidance",
    label: "Live n8n URL guidance and workflow blueprints",
    evidence: [
      "docs/n8n-live-url-configuration.md",
      "contracts/n8n/agent-config-public-export.json",
      "workflows/n8n/actor-twin.workflow.json",
      "workflows/n8n/knowledge-fabric-agent.workflow.json",
      "workflows/n8n/agentic-butler.workflow.json",
      "scripts/validate-agent-config-export.cjs",
      "frontend/assets/agent-runtime-config.json",
      "frontend/assets/n8n-runtime-readiness-status.json",
    ],
  },
];

function rel(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function evidenceState(requirement) {
  const missing = requirement.evidence.filter((item) => !exists(item));
  return {
    id: requirement.id,
    label: requirement.label,
    status: missing.length ? "missing_evidence" : "ready",
    evidence: requirement.evidence,
    missing,
  };
}

function validateBrowserQa(relativePath, expectedCases = 6) {
  if (!exists(relativePath)) {
    return { status: "missing", path: relativePath, passed: false, detail: "QA artifact missing." };
  }
  const artifact = readJson(relativePath);
  const results = Array.isArray(artifact) ? artifact : Array.isArray(artifact.results) ? artifact.results : [];
  const failures = results.flatMap((result) => Array.isArray(result.failures) ? result.failures : []);
  return {
    status: results.length >= expectedCases && !failures.length ? "passed" : "failed",
    path: relativePath,
    passed: results.length >= expectedCases && !failures.length,
    case_count: results.length,
    failures,
  };
}

function liveAgentStatus() {
  const readinessPath = "frontend/assets/n8n-runtime-readiness-status.json";
  if (!exists(readinessPath)) {
    return {
      status: "missing",
      configured_count: 0,
      awaiting_url_count: 3,
      required_agents: [],
      missing_live_agents: ["actor_twin", "knowledge_fabric_agent", "agentic_butler"],
      detail: "Runtime readiness artifact missing.",
    };
  }
  const readiness = readJson(readinessPath);
  const agents = Array.isArray(readiness.agents) ? readiness.agents : [];
  const required = ["actor_twin", "knowledge_fabric_agent", "agentic_butler"];
  const missingLive = required.filter((agentId) => {
    const agent = agents.find((item) => item.agent_id === agentId);
    return !agent || agent.status !== "configured" || !agent.url_configured;
  });
  return {
    status: missingLive.length ? "partial" : "configured",
    configured_count: agents.filter((agent) => agent.status === "configured" && agent.url_configured).length,
    awaiting_url_count: agents.filter((agent) => agent.status === "awaiting_url" || !agent.url_configured).length,
    required_agents: required,
    missing_live_agents: missingLive,
    artifact_status: readiness.status || "unknown",
    detail: missingLive.length
      ? `Missing live URL(s): ${missingLive.join(", ")}`
      : "All top-level agent live URL slots are configured. Live probe evidence still must be captured before production readiness.",
  };
}

const requirementResults = requirements.map(evidenceState);
const qaResults = [
  validateBrowserQa("docs/visual-qa/screenshots-20260810-z4-final-audit/browser-dark-mode-qa.json", 5),
  validateBrowserQa("docs/visual-qa/screenshots-20260810-z4-chat-latest-agent-traces/chat-latest-agent-traces-qa.json", 2),
];
const live = liveAgentStatus();
const missingRequirements = requirementResults.filter((item) => item.status !== "ready");
const failedQa = qaResults.filter((item) => !item.passed);
const publicSafeReady = !missingRequirements.length && !failedQa.length;
const liveReady = live.status === "configured";
const status = publicSafeReady && liveReady
  ? "complete"
  : publicSafeReady
    ? "partial_live_url_blocked"
    : "incomplete";

const artifact = {
  schema_version: "0.1.0",
  generated_at: new Date().toISOString(),
  status,
  mode: requireLive ? "require_live" : "public_safe",
  summary: {
    requirement_count: requirementResults.length,
    ready_requirement_count: requirementResults.filter((item) => item.status === "ready").length,
    qa_check_count: qaResults.length,
    passed_qa_check_count: qaResults.filter((item) => item.passed).length,
    public_safe_ready: publicSafeReady,
    live_ready: liveReady,
  },
  requirements: requirementResults,
  qa: qaResults,
  live_n8n: live,
  next_actions: liveReady
    ? [
        "Run cockpit live probes for all three agents.",
        "Capture n8n execution trace evidence.",
        "Confirm human approval gate behavior for Agentic Butler.",
      ]
    : [
        "Configure GH_PAGES_N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL.",
        "Configure GH_PAGES_N8N_AGENTIC_BUTLER_WEBHOOK_URL.",
        "Regenerate runtime readiness artifacts and redeploy GitHub Pages.",
        "Run cockpit live probes and capture n8n execution trace evidence.",
      ],
};

if (write) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
}

console.log(`Zielmodus 4 readiness: ${artifact.status}`);
console.log(`Requirements: ${artifact.summary.ready_requirement_count}/${artifact.summary.requirement_count} ready`);
console.log(`QA: ${artifact.summary.passed_qa_check_count}/${artifact.summary.qa_check_count} passed`);
console.log(`Live n8n: ${live.detail}`);
if (write) console.log(`Readiness artifact written: ${rel(outputPath)}`);

if (!publicSafeReady) process.exit(1);
if (requireLive && !liveReady) process.exit(1);
