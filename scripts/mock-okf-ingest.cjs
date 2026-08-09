const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const inputPath = path.join(root, "contracts", "okf", "ingest", "sample-ingest-request.json");
const outputRoot = path.join(root, "contracts", "okf", "generated");
const generatedAt = "2026-08-09T12:00:00Z";

function slugify(value) {
  return String(value || "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "untitled";
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function write(file, content) {
  ensureDir(file);
  fs.writeFileSync(file, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function yamlList(values, indent = 2) {
  return values.map((value) => `${" ".repeat(indent)}- ${value}`).join("\n");
}

function fail(message) {
  throw new Error(message);
}

function validateInput(input) {
  const required = ["schema", "request_id", "twin_id", "source_type", "cluster", "concept_type", "title", "claim", "raw_text", "review_state", "risk_class", "graph"];
  for (const field of required) {
    if (input[field] === undefined || input[field] === "") fail(`ingest request missing ${field}`);
  }
  if (input.schema !== "okf.ingest_request.v1") fail("ingest request schema must be okf.ingest_request.v1");
  if (!["draft", "candidate", "pending-review"].includes(input.review_state)) {
    fail("ingest request review_state must be draft, candidate, or pending-review");
  }
}

function buildOutputs(input) {
  const date = generatedAt.slice(0, 10);
  const titleSlug = slugify(input.title);
  const conceptId = `cpt_${input.request_id}`;
  const evidenceId = `ev_${input.request_id}`;
  const transcriptId = `tr_${input.request_id}`;
  const edgeId = `edge_${input.request_id}`;
  const traceId = `trace_${input.request_id}`;
  const sourceHash = `sha256:${hash(input.raw_text)}`;
  const excerptHash = `sha256:${hash(input.claim)}`;

  const evidenceRepoPath = `evidence/${input.twin_id}/${input.source_type}s/${date}-${titleSlug}.txt`;
  const evidenceManifestRef = `evidence/${input.twin_id}/${input.source_type}s/${date}-${titleSlug}.yaml`;
  const transcriptRef = `transcripts/${input.twin_id}/${date}-${titleSlug}.md`;
  const conceptRef = `concepts/${input.twin_id}/${input.cluster}/${date}-${titleSlug}.md`;
  const edgeRef = `graph/edges/${edgeId}.yaml`;

  return {
    conceptPath: path.join(outputRoot, conceptRef),
    concept: `---\nschema: okf.concept.v1\nconcept_id: ${conceptId}\ntwin_id: ${input.twin_id}\ntitle: ${input.title}\ntype: ${input.concept_type}\ncluster: ${input.cluster}\ntags:\n${yamlList(input.application_cues || [])}\nreview_state: ${input.review_state}\nrisk_class: ${input.risk_class}\nsource_refs:\n  - ${evidenceManifestRef}\n  - ${transcriptRef}\ngraph_refs:\n  nodes:\n    - node:${input.graph.from}\n    - node:${input.graph.to}\n  edges:\n    - edge:${edgeId}\nvector_policy:\n  index: selected_pending\n  embedding_status: queued\nprovenance:\n  created_by: knowledge_fabric_agent\n  created_at: "${generatedAt}"\n  source_hash: ${sourceHash}\n  extraction_method: ${input.source_type}_to_okf\nreview:\n  required: true\n  reviewer: null\n  reviewed_at: null\n  note: null\naudit:\n  last_action: create\n  crud_log_ref: audit/${input.twin_id}/crud-log.jsonl\n---\n\n## Claim\n${input.claim}\n\n## Context\n${input.context || "No additional context provided."}\n\n## Evidence\n- \`${evidenceManifestRef}#source-claim\`\n\n## Boundaries\n${(input.boundaries || []).map((item) => `- ${item}`).join("\n")}\n\n## Application Cues\n${(input.application_cues || []).map((item) => `- ${item}`).join("\n")}\n`,
    evidencePath: path.join(outputRoot, evidenceManifestRef),
    evidence: `schema: okf.evidence.v1\nevidence_id: ${evidenceId}\ntwin_id: ${input.twin_id}\nsource_type: ${input.source_type}\nstorage:\n  repo_path: ${evidenceRepoPath}\n  mime_type: text/plain\n  sha256: ${sourceHash}\nanchors:\n  - anchor_id: source-claim\n    label: ${input.source_label || input.title}\n    excerpt_hash: ${excerptHash}\nprivacy:\n  pii_present: unknown\n  sensitivity: internal\n  retention: review_required\ncreated_at: "${generatedAt}"\n`,
    transcriptPath: path.join(outputRoot, transcriptRef),
    transcript: `---\nschema: okf.transcript.v1\ntranscript_id: ${transcriptId}\ntwin_id: ${input.twin_id}\nsource_type: voice_capture\ntranscription_provider: manual\nreview_state: draft\nlinked_concepts:\n  - ${conceptId}\nevidence_ref: ${evidenceManifestRef}\ncreated_at: "${generatedAt}"\n---\n\n${input.raw_text}\n`,
    nodeFromPath: path.join(outputRoot, "graph", "nodes", `${slugify(input.graph.from)}.yaml`),
    nodeFrom: `schema: okf.graph_node.v1\nnode_key: ${input.graph.from}\ntwin_id: ${input.twin_id}\nlabel: ${input.graph.from.split("/").pop().replace(/-/g, " ")}\nnode_type: concept\nreview_state: ${input.review_state === "pending-review" ? "candidate" : input.review_state}\nconcept_refs:\n  - ${conceptRef}\n`,
    nodeToPath: path.join(outputRoot, "graph", "nodes", `${slugify(input.graph.to)}.yaml`),
    nodeTo: `schema: okf.graph_node.v1\nnode_key: ${input.graph.to}\ntwin_id: ${input.twin_id}\nlabel: ${input.graph.to.split("/").pop().replace(/-/g, " ")}\nnode_type: concept\nreview_state: candidate\nconcept_refs:\n  - ${conceptRef}\n`,
    edgePath: path.join(outputRoot, edgeRef),
    edge: `schema: okf.graph_edge.v1\nedge_key: ${edgeId}\ntwin_id: ${input.twin_id}\nfrom: ${input.graph.from}\nto: ${input.graph.to}\nrelation: ${input.graph.relation}\nedge_class: ${input.graph.edge_class}\nreview_state: candidate\nconfidence: ${input.graph.confidence}\nevidence_refs:\n  - ${evidenceManifestRef}#source-claim\npromotion:\n  proposed_by: graph_curator\n  proposed_at: "${generatedAt}"\n  decision: pending\n`,
    auditPath: path.join(outputRoot, "audit", input.twin_id, "crud-log.jsonl"),
    audit: [
      { schema: "okf.audit_event.v1", event_id: `aud_${input.request_id}_001`, twin_id: input.twin_id, operation: "create", target_type: "evidence", target_ref: evidenceManifestRef, actor: "knowledge_fabric_agent", timestamp: generatedAt, trace_id: traceId },
      { schema: "okf.audit_event.v1", event_id: `aud_${input.request_id}_002`, twin_id: input.twin_id, operation: "create", target_type: "concept", target_ref: conceptRef, actor: "knowledge_fabric_agent", timestamp: generatedAt, trace_id: traceId },
      { schema: "okf.audit_event.v1", event_id: `aud_${input.request_id}_003`, twin_id: input.twin_id, operation: "propose_edge", target_type: "graph_edge", target_ref: edgeRef, actor: "graph_curator", timestamp: generatedAt, trace_id: traceId },
    ].map((event) => JSON.stringify(event)).join("\n"),
    vectorPath: path.join(outputRoot, "vector", `${input.request_id}-upsert-request.json`),
    vector: JSON.stringify({
      operation: "upsert",
      twin_id: input.twin_id,
      source_policy: "selected_pending",
      documents: [
        {
          concept_id: conceptId,
          repo_path: conceptRef,
          review_state: input.review_state,
          text: input.claim,
          metadata: {
            cluster: input.cluster,
            type: input.concept_type,
            evidence_refs: [`${evidenceManifestRef}#source-claim`],
          },
        },
      ],
    }, null, 2),
  };
}

const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
validateInput(input);
const outputs = buildOutputs(input);
fs.rmSync(outputRoot, { recursive: true, force: true });
write(path.join(outputRoot, "README.md"), `# Generated OKF Ingest Output\n\nGenerated from \`contracts/okf/ingest/sample-ingest-request.json\`.\n\nDo not store private source text here in the public app repo. This fixture is synthetic.\n`);
for (const [key, value] of Object.entries(outputs)) {
  if (!key.endsWith("Path")) continue;
  const contentKey = key.slice(0, -"Path".length);
  write(value, outputs[contentKey]);
}

console.log(`OKF ingest mock generated ${Object.keys(outputs).filter((key) => key.endsWith("Path")).length} files in ${path.relative(root, outputRoot)}`);
