const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const fixturePath = path.join(root, "contracts", "n8n", "fixtures", "actor-twin-routing.json");
const defaultOutput = path.join(root, "frontend", "assets", "actor-twin-routing-readiness-status.json");

const requiredRoutes = [
  "answer_direct",
  "retrieve_knowledge",
  "ingest_or_stage_knowledge",
  "activate_skill",
  "create_skill",
  "request_human_clarification",
];

function parseArgs(argv) {
  const args = { output: defaultOutput, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") {
      args.output = path.resolve(argv[index + 1] || "");
      index += 1;
    } else if (arg === "--check") {
      args.check = true;
    }
  }
  return args;
}

function rel(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function runValidator() {
  const result = spawnSync(process.execPath, ["scripts/validate-actor-twin-routing.cjs"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Actor Twin routing validation failed").trim());
  }
}

function routeStatus(route, fixture) {
  const item = (fixture.route_decisions || []).find((candidate) => candidate.expected_route?.decision === route) || {};
  const expected = item.expected_route || {};
  return {
    route,
    status: item.case_id ? "fixture_ready" : "blocked",
    case_id: item.case_id || "",
    target_agent: expected.target_agent || "",
    intent: expected.intent || "",
    visible_state: expected.visible_state || "",
    approval_required: Boolean(expected.approval_required),
    fixture_path: rel(fixturePath),
  };
}

function buildArtifact() {
  runValidator();
  const fixture = readJson(fixturePath, {});
  const routes = requiredRoutes.map((route) => routeStatus(route, fixture));
  const readyCount = routes.filter((route) => route.status === "fixture_ready").length;
  const delegationTargets = new Set(routes.map((route) => route.target_agent).filter(Boolean));
  const approvalGateActive = routes.some((route) => route.route === "create_skill" && route.approval_required === true)
    && routes.some((route) => route.route === "request_human_clarification" && route.approval_required === true);
  const chatPolicy = fixture.chat_surface_policy || {};
  return {
    schema_version: "0.1.0",
    generated_at: new Date().toISOString(),
    status: readyCount === requiredRoutes.length && approvalGateActive ? "routing_contract_ready" : "blocked",
    summary: {
      route_count: routes.length,
      required_route_count: requiredRoutes.length,
      fixture_ready_count: readyCount,
      delegation_target_count: delegationTargets.size,
      approval_gate_active: approvalGateActive,
      chat_diagnostics_policy: chatPolicy.diagnostics || "unknown",
      chat_manual_agent_activation_disabled: chatPolicy.manual_knowledge_fabric_activation === false
        && chatPolicy.manual_agentic_butler_activation === false,
    },
    cockpit_indicators: [
      {
        key: "actor_twin_routing_contract",
        label: "Actor Twin routing contract",
        status: readyCount === requiredRoutes.length ? "fixture_ready" : "blocked",
        detail: `${readyCount}/${requiredRoutes.length} route decisions covered.`,
        artifact: rel(fixturePath),
      },
      {
        key: "knowledge_fabric_delegation",
        label: "Knowledge Fabric delegation",
        status: routes.some((route) => route.target_agent === "knowledge_fabric_agent") ? "fixture_ready" : "blocked",
        detail: "Retrieval and source staging routes target Knowledge Fabric Agent.",
        artifact: rel(fixturePath),
      },
      {
        key: "agentic_butler_activation",
        label: "Agentic Butler skill activation",
        status: routes.some((route) => route.route === "activate_skill" && route.target_agent === "agentic_butler") ? "fixture_ready" : "blocked",
        detail: "Approved skill activation is routed through Agentic Butler.",
        artifact: rel(fixturePath),
      },
      {
        key: "agentic_butler_skill_creation",
        label: "Agentic Butler skill creation",
        status: routes.some((route) => route.route === "create_skill" && route.target_agent === "agentic_butler") ? "fixture_ready" : "blocked",
        detail: "New skill creation routes to elicitation/decomposition with pending approval.",
        artifact: rel(fixturePath),
      },
      {
        key: "approval_gate_active",
        label: "Approval gate active",
        status: approvalGateActive ? "fixture_ready" : "blocked",
        detail: "Clarification and generated skill approval gates are represented in the route contract.",
        artifact: rel(fixturePath),
      },
    ],
    routes,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifact = buildArtifact();
  const content = `${JSON.stringify(artifact, null, 2)}\n`;
  if (args.check) {
    if (!fs.existsSync(args.output)) throw new Error(`${rel(args.output)} is missing`);
    const current = readJson(args.output, {});
    if (current.status !== artifact.status) throw new Error(`${rel(args.output)} status is out of date`);
    if (current.summary?.fixture_ready_count !== artifact.summary.fixture_ready_count) {
      throw new Error(`${rel(args.output)} route fixture count is out of date`);
    }
    if (current.summary?.approval_gate_active !== artifact.summary.approval_gate_active) {
      throw new Error(`${rel(args.output)} approval gate status is out of date`);
    }
  } else {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, content, "utf8");
  }
  console.log(`Actor Twin routing readiness ${args.check ? "checked" : "written"}: ${rel(args.output)}`);
}

main();
