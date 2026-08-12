const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const routingFixturePath = path.join(root, "contracts", "n8n", "fixtures", "actor-twin-routing.json");
const blueprintPath = path.join(root, "workflows", "n8n", "implementations", "actor-twin-direct-orchestrator.workflow.json");
const outputPath = path.join(root, "frontend", "assets", "actor-twin-orchestration-readiness-status.json");
const checkMode = process.argv.includes("--check");

function rel(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function runValidator(script) {
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) fail((result.stderr || result.stdout || `${script} failed`).trim());
}

function buildStatus() {
  runValidator("scripts/validate-actor-twin-routing.cjs");
  if (!fs.existsSync(blueprintPath)) fail(`Missing direct orchestrator blueprint: ${rel(blueprintPath)}`);
  const fixture = readJson(routingFixturePath);
  const blueprint = readJson(blueprintPath);
  const delegatedRouteCases = (fixture.route_decisions || []).filter((item) => {
    const target = item.expected_route?.target_agent;
    return ["knowledge_fabric_agent", "agentic_butler"].includes(target);
  });
  const blueprintNodeNames = new Set((blueprint.nodes || []).map((node) => node.name));
  const requiredNodes = [
    "Receive request",
    "Actor Twin AI Agent",
    "Normalize route decision",
    "Switch by route",
    "Call Knowledge Fabric Agent",
    "Call Agentic Butler",
    "Finalize Actor Twin response",
    "Return JSON",
  ];
  const missingNodes = requiredNodes.filter((node) => !blueprintNodeNames.has(node));
  const requiredSteps = [
    "Receive Chat request.",
    "Actor Twin AI Agent generates route_decision.",
    "If answer_direct, answer directly.",
    "If retrieve_knowledge or ingest_or_stage_knowledge, call Knowledge Fabric Agent workflow directly.",
    "If activate_skill or create_skill, call Agentic Butler workflow directly.",
    "Normalize returned delegate output.",
    "Persist full trace chain.",
    "Return final Actor Twin response/status to frontend.",
  ];
  const targetSteps = blueprint.target_implementation_steps || [];
  const missingSteps = requiredSteps.filter((step) => !targetSteps.includes(step));
  const envVars = blueprint.required_n8n_environment_variables || [];
  const requiredEnv = ["N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL", "N8N_AGENTIC_BUTLER_WEBHOOK_URL"];
  const missingEnvRefs = requiredEnv.filter((item) => !envVars.includes(item));
  const ready = !missingNodes.length && !missingSteps.length && !missingEnvRefs.length && delegatedRouteCases.length >= 4;
  return {
    schema_version: "0.1.0",
    generated_at: new Date().toISOString(),
    status: ready ? "orchestration_blueprint_ready" : "blocked",
    orchestration_model: fixture.orchestration_model || {},
    key_point: fixture.orchestration_model?.key_point || "",
    summary: {
      delegated_route_count: delegatedRouteCases.length,
      required_node_count: requiredNodes.length,
      missing_node_count: missingNodes.length,
      required_step_count: requiredSteps.length,
      missing_step_count: missingSteps.length,
      required_env_count: requiredEnv.length,
      missing_env_count: missingEnvRefs.length,
      direct_n8n_orchestration_ready_for_uat: ready,
      backend_orchestration_deferred_for_hardening: true,
    },
    cockpit_indicators: [
      {
        key: "actor_twin_decision_authority",
        label: "Actor Twin decision authority",
        status: fixture.orchestration_model?.key_point ? "documented" : "blocked",
        detail: "Actor Twin decides, delegates, reviews, and shapes final response.",
        artifact: rel(routingFixturePath),
      },
      {
        key: "knowledge_fabric_direct_call",
        label: "Knowledge Fabric direct call",
        status: delegatedRouteCases.some((item) => item.expected_route?.target_agent === "knowledge_fabric_agent") ? "fixture_ready" : "blocked",
        detail: "Actor Twin can call Knowledge Fabric for retrieval and source staging.",
        artifact: rel(blueprintPath),
      },
      {
        key: "agentic_butler_direct_call",
        label: "Agentic Butler direct call",
        status: delegatedRouteCases.some((item) => item.expected_route?.target_agent === "agentic_butler") ? "fixture_ready" : "blocked",
        detail: "Actor Twin can call Agentic Butler for skill activation and skill creation.",
        artifact: rel(blueprintPath),
      },
      {
        key: "backend_orchestration_hardening",
        label: "Backend orchestration hardening",
        status: "deferred",
        detail: "Backend proxy orchestration remains the later production-hardening step.",
        artifact: "docs/production/agent-backend-proxy.md",
      },
    ],
    required_nodes: requiredNodes,
    missing_nodes: missingNodes,
    required_steps: requiredSteps,
    missing_steps: missingSteps,
    required_n8n_environment_variables: requiredEnv,
    missing_environment_references: missingEnvRefs,
    artifacts: {
      routing_fixture: rel(routingFixturePath),
      direct_orchestrator_blueprint: rel(blueprintPath),
    },
    next_actions: [
      "Apply the direct-orchestrator blueprint to the live Actor Twin workflow.",
      "Set N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL and N8N_AGENTIC_BUTLER_WEBHOOK_URL in the n8n runtime environment.",
      "Run live UAT for answer_direct, retrieve_knowledge, ingest_or_stage_knowledge, activate_skill, create_skill, and clarification routes.",
      "Capture full actor-to-delegate trace chains in the Review/Traces cockpit.",
      "Move delegation to backend proxy after hosted secret storage and durable persistence are active.",
    ],
  };
}

const artifact = buildStatus();
if (checkMode) {
  if (!fs.existsSync(outputPath)) fail(`Missing orchestration readiness asset: ${rel(outputPath)}`);
  const current = readJson(outputPath);
  if (current.status !== artifact.status) fail(`${rel(outputPath)} status is out of date`);
  if (current.summary?.delegated_route_count !== artifact.summary.delegated_route_count) {
    fail(`${rel(outputPath)} delegated route count is out of date`);
  }
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
}
console.log(JSON.stringify({
  status: artifact.status,
  output: rel(outputPath),
  delegated_route_count: artifact.summary.delegated_route_count,
  direct_n8n_orchestration_ready_for_uat: artifact.summary.direct_n8n_orchestration_ready_for_uat,
}, null, 2));
