const fs = require("node:fs");
const path = require("node:path");
const { qualityAssessment, REVIEW_FROM_UI } = require("../backend/workspaceApi");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "contracts", "backend", "launch-critical-api.json"), "utf8"));
const source = ["backend/server.js", "backend/workspaceApi.js"]
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");

const missing = manifest.routes.filter((route) => {
  const [method, pathname] = route.split(" ");
  return !source.includes(`\"${method} ${pathname}\"`)
    && !(source.includes(`req.method === \"${method}\"`) && source.includes(`url.pathname === \"${pathname}\"`))
    && !(pathname === "/api/agents/actor-twin/chat" && source.includes("PATH_TO_AGENT[url.pathname]"));
});

if (missing.length) {
  process.stderr.write(`Missing launch-critical backend routes:\n${missing.map((item) => `- ${item}`).join("\n")}\n`);
  process.exit(1);
}

const incomplete = qualityAssessment({ transcript: "We do a process for invoices.", replies: [] });
if (incomplete.ready || !incomplete.next_question) throw new Error("Circular interview must ask a follow-up for incomplete knowledge.");
const complete = qualityAssessment({
  transcript: "The topic is invoice approval. We need it because financial control prevents duplicate payment. First the requester submits evidence, then the responsible finance owner checks it and the controller approves. The result is an auditable payment decision.",
  replies: ["The finance owner is responsible and the requester is informed."],
});
if (!complete.ready || complete.eligibility_score < 70) throw new Error("Complete circular interview sample must pass the quality gate.");
if (REVIEW_FROM_UI["pending-review"] !== "review_needed" || REVIEW_FROM_UI["needs-rework"] !== "updated") {
  throw new Error("Frontend and database review states are not mapped correctly.");
}
if (!source.includes("routing_policy: \"call_n8n_workflow_tool_first\"")) {
  throw new Error("Interactive skill execution must preserve the Call n8n Workflow Tool hierarchy policy.");
}

process.stdout.write(`Launch-critical API contract valid: ${manifest.routes.length} routes.\n`);
