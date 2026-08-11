const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultOutput = path.join(root, "frontend", "assets", "n8n-ai-agent-readiness-status.json");
const implementationDir = path.join(root, "workflows", "n8n", "implementations");
const runtimePath = path.join(root, "frontend", "assets", "n8n-runtime-readiness-status.json");
const probePath = path.join(root, "frontend", "assets", "n8n-live-probe-evidence.json");
const adapterPath = path.join(root, "frontend", "assets", "n8n-production-adapter-status.json");

const agents = [
  {
    agent_id: "actor_twin",
    agent_name: "Actor Twin",
    implementation: "actor-twin.ai-agent.workflow.json",
    required_ai_node: "Actor Twin AI Agent",
    required_model_node: "Actor Twin Chat Model",
    expected_live_workflow: "fDn8yXo3W41hh3yR",
    role: "Primary user interface, intent router, decision instance, and answer agent.",
  },
  {
    agent_id: "knowledge_fabric_agent",
    agent_name: "Knowledge Fabric Agent",
    implementation: "knowledge-fabric-agent.ai-agent.workflow.json",
    required_ai_node: "Knowledge Fabric AI Agent",
    required_model_node: "Knowledge Fabric Chat Model",
    expected_live_workflow: "7Ci86PxXipwvYpKv",
    role: "Background ingest, OKF concept staging, evidence, CRUD, graph candidate, and vector-boundary agent.",
  },
  {
    agent_id: "agentic_butler",
    agent_name: "Agentic Butler",
    implementation: "agentic-butler.ai-agent.workflow.json",
    required_ai_node: "Agentic Butler AI Agent",
    required_model_node: "Agentic Butler Chat Model",
    expected_live_workflow: "KZOqZRUAnVfFEAYJ",
    role: "Skill activation and work execution agent; contains Skill Orchestrator as internal component.",
  },
];

function parseArgs(argv) {
  const args = { output: defaultOutput, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") {
      args.output = path.resolve(argv[index + 1] || "");
      index += 1;
    }
    if (arg === "--check") args.check = true;
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

function nodeByName(workflow, name) {
  return (workflow.nodes || []).find((node) => node.name === name);
}

function hasAiModelConnection(workflow, modelNodeName, agentNodeName) {
  const modelConnections = workflow.connections?.[modelNodeName]?.ai_languageModel || [];
  return modelConnections.some((group) =>
    Array.isArray(group) && group.some((connection) => connection.node === agentNodeName),
  );
}

function liveProbeFor(probe, agentId) {
  return (probe?.agents || []).find((agent) => agent.agent_id === agentId) || {};
}

function runtimeFor(runtime, agentId) {
  return (runtime?.agents || []).find((agent) => agent.agent_id === agentId) || {};
}

function buildAgent(agent, runtime, probe, adapterReady) {
  const implementationPath = path.join(implementationDir, agent.implementation);
  const workflow = readJson(implementationPath, {});
  const aiNode = nodeByName(workflow, agent.required_ai_node);
  const modelNode = nodeByName(workflow, agent.required_model_node);
  const modelConnected = hasAiModelConnection(workflow, agent.required_model_node, agent.required_ai_node);
  const probeAgent = liveProbeFor(probe, agent.agent_id);
  const runtimeAgent = runtimeFor(runtime, agent.agent_id);
  const liveProbeClaimsAi = probeAgent.ai_agent?.integrated === true;
  const implementationReady = Boolean(
    aiNode &&
      String(aiNode.type || "").includes("langchain.agent") &&
      modelNode &&
      String(modelNode.type || "").includes("lmChat") &&
      modelConnected,
  );
  const liveUrlReady = runtimeAgent.url_configured === true;
  const traceReady = probeAgent.status === "connected" && probeAgent.demo !== true && Boolean(probeAgent.trace_id);
  const manualVerificationRequired = true;
  const state = implementationReady && adapterReady && liveUrlReady && traceReady && liveProbeClaimsAi
    ? "live_ai_claimed_verify_in_n8n"
    : implementationReady && adapterReady
      ? "blueprint_ready_live_incomplete"
      : "blocked";
  const blockers = [];
  if (!implementationReady) blockers.push("AI Agent blueprint lacks required AI Agent, chat model, or model connection.");
  if (!adapterReady) blockers.push("Production response adapter is not validated.");
  if (!liveUrlReady) blockers.push("Public UAT/live webhook URL is not configured.");
  if (!traceReady) blockers.push("Non-demo live trace evidence is missing.");
  if (!liveProbeClaimsAi) blockers.push("Live probe response does not claim AI Agent execution.");
  blockers.push("Human/browser verification of the live n8n workflow canvas is still required before production trust.");
  return {
    agent_id: agent.agent_id,
    agent_name: agent.agent_name,
    role: agent.role,
    status: state,
    implementation_path: rel(implementationPath),
    expected_live_workflow: agent.expected_live_workflow,
    gates: {
      ai_agent_blueprint_ready: implementationReady,
      response_adapter_ready: adapterReady,
      live_url_configured: liveUrlReady,
      live_trace_recorded: traceReady,
      live_probe_claims_ai_agent: liveProbeClaimsAi,
      manual_live_workflow_verification_required: manualVerificationRequired,
    },
    nodes: {
      ai_agent: aiNode ? { name: aiNode.name, type: aiNode.type } : null,
      chat_model: modelNode ? { name: modelNode.name, type: modelNode.type } : null,
      model_connection_ready: modelConnected,
    },
    live_probe: {
      status: probeAgent.status || "missing",
      trace_id: probeAgent.trace_id || "",
      execution_url: probeAgent.evidence?.n8n_execution_url || "",
      ai_agent_node: probeAgent.ai_agent?.node || "",
    },
    next_actions: blockers,
  };
}

function buildArtifact() {
  const runtime = readJson(runtimePath, {});
  const probe = readJson(probePath, {});
  const adapter = readJson(adapterPath, {});
  const adapterReady = adapter.summary?.production_adapter_ready === true;
  const agentRows = agents.map((agent) => buildAgent(agent, runtime, probe, adapterReady));
  const blueprintReady = agentRows.filter((agent) => agent.gates.ai_agent_blueprint_ready).length;
  const liveClaimed = agentRows.filter((agent) => agent.gates.live_probe_claims_ai_agent).length;
  const traceReady = agentRows.filter((agent) => agent.gates.live_trace_recorded).length;
  const manualRequired = agentRows.filter((agent) => agent.gates.manual_live_workflow_verification_required).length;
  const productionReady = manualRequired === 0;
  return {
    schema_version: "0.1.0",
    generated_at: new Date().toISOString(),
    status: productionReady ? "ai_agents_production_verified" : "ai_agent_blueprints_ready_live_verification_required",
    boundary: "Public-safe readiness artifact. It checks repo workflow implementation blueprints and public probe evidence, but does not expose secrets or call n8n.",
    summary: {
      agent_count: agentRows.length,
      ai_agent_blueprint_ready_count: blueprintReady,
      live_probe_claims_ai_agent_count: liveClaimed,
      live_trace_recorded_count: traceReady,
      manual_live_workflow_verification_required_count: manualRequired,
      production_ai_logic_verified: productionReady,
    },
    interpretation: "A workflow can be reachable and contract-tested while still behaving as a staging responder. Production trust requires verified AI Agent nodes wired before the response normalizer in live n8n.",
    agents: agentRows,
    next_actions: [
      "Open each live n8n workflow and confirm the AI Agent node is on the active path between webhook and response normalizer.",
      "Confirm the AI Agent uses the intended model credential and system instructions.",
      "Confirm the response normalizer includes AI output, approval gates, and trace id in the public contract envelope.",
      "Run no-write live probes and record execution evidence after AI Agent node verification.",
      "Only after verification, mark the workflow as AI logic active in the production cockpit evidence."
    ],
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifact = buildArtifact();
  const next = `${JSON.stringify(artifact, null, 2)}\n`;
  if (args.check) {
    if (!fs.existsSync(args.output)) throw new Error(`${rel(args.output)} is missing`);
    const current = readJson(args.output);
    if (current.status !== artifact.status) throw new Error(`${rel(args.output)} status is out of date`);
    if (current.summary?.agent_count !== artifact.summary.agent_count) throw new Error(`${rel(args.output)} agent count is out of date`);
    if (current.summary?.ai_agent_blueprint_ready_count !== artifact.summary.ai_agent_blueprint_ready_count) {
      throw new Error(`${rel(args.output)} AI blueprint count is out of date`);
    }
  } else {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, next, "utf8");
  }
  console.log(`n8n AI-agent readiness ${args.check ? "checked" : "written"}: ${rel(args.output)}`);
}

main();
