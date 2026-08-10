const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const requireLive = args.has("--require-live");
const requireLiveProbes = args.has("--require-live-probes");
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
      "contracts/okf/schemas/shared-definitions.schema.json",
      "contracts/okf/schemas/concept.schema.json",
      "contracts/okf/schemas/evidence.schema.json",
      "contracts/okf/schemas/transcript.schema.json",
      "contracts/okf/schemas/graph-node.schema.json",
      "contracts/okf/schemas/graph-edge.schema.json",
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
      "scripts/set-n8n-agent-url.cjs",
      "scripts/record-n8n-live-probe-evidence.cjs",
      "scripts/write-n8n-live-readiness-preflight.cjs",
      "scripts/write-zielmodus-4-live-completion-checklist.cjs",
      "frontend/assets/agent-runtime-config.json",
      "frontend/assets/n8n-runtime-readiness-status.json",
      "frontend/assets/n8n-live-probe-evidence.json",
      "frontend/assets/n8n-live-readiness-preflight.json",
      "frontend/assets/zielmodus-4-live-completion-checklist.json",
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

function liveProbeEvidenceStatus() {
  const evidencePath = "frontend/assets/n8n-live-probe-evidence.json";
  const required = ["actor_twin", "knowledge_fabric_agent", "agentic_butler"];
  if (!exists(evidencePath)) {
    return {
      status: "missing",
      path: evidencePath,
      connected_count: 0,
      required_count: required.length,
      missing_probe_agents: required,
      detail: "Live probe evidence artifact missing.",
    };
  }
  const evidence = readJson(evidencePath);
  const agents = Array.isArray(evidence.agents) ? evidence.agents : [];
  const missingProbeAgents = required.filter((agentId) => {
    const agent = agents.find((item) => item.agent_id === agentId);
    if (!agent) return true;
    if (!["connected", "n8n connected"].includes(String(agent.status || "").toLowerCase())) return true;
    if (!agent.trace_id) return true;
    if (agent.demo === true) return true;
    return false;
  });
  return {
    status: missingProbeAgents.length ? "partial" : "complete",
    path: evidencePath,
    connected_count: required.length - missingProbeAgents.length,
    required_count: required.length,
    missing_probe_agents: missingProbeAgents,
    detail: missingProbeAgents.length
      ? `Missing live probe evidence for: ${missingProbeAgents.join(", ")}`
      : "All top-level agents have connected, non-demo live probe evidence.",
  };
}

function liveCompletionChecklistStatus() {
  const checklistPath = "frontend/assets/zielmodus-4-live-completion-checklist.json";
  const required = ["actor_twin", "knowledge_fabric_agent", "agentic_butler"];
  if (!exists(checklistPath)) {
    return {
      status: "missing",
      path: checklistPath,
      missing_live_url_count: required.length,
      missing_probe_trace_count: required.length,
      estimated_remaining_after_urls_exist: "unknown",
      detail: "Live completion checklist artifact missing.",
    };
  }
  const checklist = readJson(checklistPath);
  const agents = Array.isArray(checklist.agents) ? checklist.agents : [];
  const missingAgents = required.filter((agentId) => !agents.some((agent) => agent.agent_id === agentId));
  const summary = checklist.summary || {};
  const missingUrlCount = Number(summary.missing_live_url_count ?? agents.filter((agent) => agent.url_configured !== true).length);
  const missingProbeCount = Number(summary.missing_probe_trace_count ?? agents.filter((agent) => agent.live_probe_connected !== true).length);
  const status = missingAgents.length
    ? "incomplete"
    : missingUrlCount
      ? "partial_live_url_blocked"
      : missingProbeCount
        ? "live_probe_evidence_pending"
        : "ready_for_strict_gate";
  return {
    status,
    path: checklistPath,
    missing_live_url_count: missingUrlCount,
    missing_probe_trace_count: missingProbeCount,
    estimated_remaining_after_urls_exist: summary.estimated_remaining_after_urls_exist || "45-90 minutes",
    missing_agents: missingAgents,
    detail: missingAgents.length
      ? `Completion checklist missing agent row(s): ${missingAgents.join(", ")}`
      : `Completion checklist open work: ${missingUrlCount} URL(s), ${missingProbeCount} probe trace(s).`,
  };
}

const requirementResults = requirements.map(evidenceState);
const qaResults = [
  validateBrowserQa("docs/visual-qa/screenshots-20260810-z4-final-audit/browser-dark-mode-qa.json", 5),
  validateBrowserQa("docs/visual-qa/screenshots-20260810-z4-chat-latest-agent-traces/chat-latest-agent-traces-qa.json", 2),
];
const live = liveAgentStatus();
const liveProbeEvidence = liveProbeEvidenceStatus();
const liveCompletionChecklist = liveCompletionChecklistStatus();
const missingRequirements = requirementResults.filter((item) => item.status !== "ready");
const failedQa = qaResults.filter((item) => !item.passed);
const publicSafeReady = !missingRequirements.length && !failedQa.length;
const liveReady = live.status === "configured";
const liveProbeReady = liveProbeEvidence.status === "complete";
const checklistReady = liveCompletionChecklist.status !== "missing" && liveCompletionChecklist.status !== "incomplete";
const status = publicSafeReady && liveReady
  ? (liveProbeReady ? "complete" : "live_probe_evidence_pending")
  : publicSafeReady
    ? "partial_live_url_blocked"
    : "incomplete";

const artifact = {
  schema_version: "0.1.0",
  generated_at: new Date().toISOString(),
  status,
  mode: requireLiveProbes ? "require_live_probes" : requireLive ? "require_live" : "public_safe",
  summary: {
    requirement_count: requirementResults.length,
    ready_requirement_count: requirementResults.filter((item) => item.status === "ready").length,
    qa_check_count: qaResults.length,
    passed_qa_check_count: qaResults.filter((item) => item.passed).length,
    public_safe_ready: publicSafeReady,
    live_ready: liveReady,
    live_probe_ready: liveProbeReady,
  },
  requirements: requirementResults,
  qa: qaResults,
  live_n8n: live,
  live_probe_evidence: liveProbeEvidence,
  live_completion_checklist: liveCompletionChecklist,
  next_actions: liveReady && !liveProbeReady
    ? [
        "Run cockpit live probes for all three agents.",
        "Export live probe evidence to frontend/assets/n8n-live-probe-evidence.json.",
        "Capture n8n execution trace evidence.",
        "Confirm human approval gate behavior for Agentic Butler.",
      ]
    : liveReady
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
console.log(`Live probes: ${liveProbeEvidence.detail}`);
console.log(`Live completion checklist: ${liveCompletionChecklist.detail}`);
if (write) console.log(`Readiness artifact written: ${rel(outputPath)}`);

if (!publicSafeReady || !checklistReady) process.exit(1);
if (requireLive && !liveReady) process.exit(1);
if (requireLiveProbes && (!liveReady || !liveProbeReady)) process.exit(1);
