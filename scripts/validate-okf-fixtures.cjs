const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const contractRoot = path.join(root, "contracts", "okf");
const fixtureRoots = ["examples", "generated"].map((name) => path.join(contractRoot, name));
const reviewStates = new Set(["draft", "candidate", "pending-review", "approved", "needs-rework", "rejected", "retired"]);
const vectorTrustedStates = new Set(["approved"]);
const vectorReviewableStates = new Set(["approved", "pending-review", "candidate"]);
const sourceTypes = new Set(["upload", "transcript", "email_export", "calendar_export", "teams_export", "agent_output", "voice_capture"]);
const graphEdgeClasses = new Set(["explicit", "inferred", "candidate", "duplicate-candidate", "contradiction-candidate"]);
const graphRelations = new Set(["supports", "contradicts", "requires", "similar_to", "causes", "evidence_for", "uses_skill"]);

function fail(message) {
  throw new Error(message);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function listFiles(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, predicate);
    return predicate(full) ? [full] : [];
  });
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^["']|["']$/g, "");
}

function parseFlatYaml(text) {
  const data = {};
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (raw === "") {
      data[key] = data[key] ?? {};
    } else {
      data[key] = parseScalar(raw);
    }
  }
  return data;
}

function frontmatter(markdownFile) {
  const text = read(markdownFile);
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) fail(`${markdownFile}: YAML frontmatter missing`);
  return parseFlatYaml(match[1]);
}

function assertRequired(data, file, fields) {
  for (const field of fields) {
    if (data[field] === undefined || data[field] === "") fail(`${file}: ${field} missing`);
  }
}

function assertReviewState(data, file) {
  if (!reviewStates.has(data.review_state)) fail(`${file}: invalid review_state ${data.review_state}`);
}

function validateConcept(file) {
  const data = frontmatter(file);
  assertRequired(data, file, ["schema", "concept_id", "twin_id", "title", "type", "cluster", "review_state", "risk_class"]);
  if (data.schema !== "okf.concept.v1") fail(`${file}: schema must be okf.concept.v1`);
  assertReviewState(data, file);
  if (!/concepts[\\/][^\\/]+[\\/][^\\/]+[\\/]\d{4}-\d{2}-\d{2}-/.test(file)) {
    fail(`${file}: concept path must follow concepts/{twin_id}/{cluster}/{yyyy-mm-dd}-{slug}.md`);
  }
}

function validateEvidence(file) {
  const data = parseFlatYaml(read(file));
  assertRequired(data, file, ["schema", "evidence_id", "twin_id", "source_type", "review_state", "created_at"]);
  if (data.schema !== "okf.evidence.v1") fail(`${file}: schema must be okf.evidence.v1`);
  if (!sourceTypes.has(data.source_type)) fail(`${file}: invalid source_type ${data.source_type}`);
  assertReviewState(data, file);
}

function validateTranscript(file) {
  const data = frontmatter(file);
  assertRequired(data, file, ["schema", "transcript_id", "twin_id", "source_type", "transcription_provider", "review_state", "created_at"]);
  if (data.schema !== "okf.transcript.v1") fail(`${file}: schema must be okf.transcript.v1`);
  assertReviewState(data, file);
}

function validateGraphNode(file) {
  const data = parseFlatYaml(read(file));
  assertRequired(data, file, ["schema", "node_key", "twin_id", "label", "node_type", "review_state"]);
  if (data.schema !== "okf.graph_node.v1") fail(`${file}: schema must be okf.graph_node.v1`);
  assertReviewState(data, file);
}

function validateGraphEdge(file) {
  const data = parseFlatYaml(read(file));
  assertRequired(data, file, ["schema", "edge_key", "twin_id", "from", "to", "relation", "edge_class", "review_state", "confidence"]);
  if (data.schema !== "okf.graph_edge.v1") fail(`${file}: schema must be okf.graph_edge.v1`);
  if (!graphRelations.has(data.relation)) fail(`${file}: invalid relation ${data.relation}`);
  if (!graphEdgeClasses.has(data.edge_class)) fail(`${file}: invalid edge_class ${data.edge_class}`);
  assertReviewState(data, file);
  if (typeof data.confidence !== "number" || data.confidence < 0 || data.confidence > 1) {
    fail(`${file}: confidence must be a number between 0 and 1`);
  }
}

function validateAudit(file) {
  const lines = read(file).split(/\r?\n/).filter(Boolean);
  if (!lines.length) fail(`${file}: audit log is empty`);
  for (const [index, line] of lines.entries()) {
    const event = JSON.parse(line);
    assertRequired(event, `${file}:${index + 1}`, ["schema", "event_id", "twin_id", "operation", "target_type", "target_ref", "actor", "timestamp", "trace_id"]);
    if (event.schema !== "okf.audit_event.v1") fail(`${file}:${index + 1}: schema must be okf.audit_event.v1`);
  }
}

function validateVectorRequest(file) {
  const data = JSON.parse(read(file));
  assertRequired(data, file, ["operation", "twin_id", "source_policy", "documents"]);
  if (!["upsert", "delete", "refresh_status"].includes(data.operation)) fail(`${file}: invalid operation ${data.operation}`);
  if (!["approved_only", "selected_pending"].includes(data.source_policy)) fail(`${file}: invalid source_policy ${data.source_policy}`);
  if (!Array.isArray(data.documents)) fail(`${file}: documents must be an array`);
  for (const [index, doc] of data.documents.entries()) {
    assertRequired(doc, `${file}:documents[${index}]`, ["concept_id", "repo_path", "review_state", "text", "metadata"]);
    if (!vectorReviewableStates.has(doc.review_state)) fail(`${file}:documents[${index}]: invalid vector review_state ${doc.review_state}`);
    if (data.source_policy === "approved_only" && !vectorTrustedStates.has(doc.review_state)) {
      fail(`${file}:documents[${index}]: approved_only cannot include document review_state ${doc.review_state}`);
    }
    if (!Array.isArray(doc.metadata.evidence_refs)) fail(`${file}:documents[${index}]: metadata.evidence_refs must be an array`);
    if (!Array.isArray(doc.metadata.evidence_review_states)) fail(`${file}:documents[${index}]: metadata.evidence_review_states must be an array`);
    if (doc.metadata.evidence_review_states.length !== doc.metadata.evidence_refs.length) {
      fail(`${file}:documents[${index}]: metadata.evidence_review_states must align one-to-one with evidence_refs`);
    }
    for (const evidenceState of doc.metadata.evidence_review_states) {
      if (!vectorReviewableStates.has(evidenceState)) fail(`${file}:documents[${index}]: invalid vector evidence review state ${evidenceState}`);
      if (data.source_policy === "approved_only" && !vectorTrustedStates.has(evidenceState)) {
        fail(`${file}:documents[${index}]: approved_only cannot include evidence review_state ${evidenceState}`);
      }
    }
  }
}

let total = 0;
let groupCount = 0;
for (const fixtureRoot of fixtureRoots) {
  if (!fs.existsSync(fixtureRoot)) continue;
  const checks = [
    ["concept", listFiles(path.join(fixtureRoot, "concepts"), (file) => file.endsWith(".md")), validateConcept],
    ["evidence", listFiles(path.join(fixtureRoot, "evidence"), (file) => file.endsWith(".yaml")), validateEvidence],
    ["transcript", listFiles(path.join(fixtureRoot, "transcripts"), (file) => file.endsWith(".md")), validateTranscript],
    ["graph node", listFiles(path.join(fixtureRoot, "graph", "nodes"), (file) => file.endsWith(".yaml")), validateGraphNode],
    ["graph edge", listFiles(path.join(fixtureRoot, "graph", "edges"), (file) => file.endsWith(".yaml")), validateGraphEdge],
    ["audit", listFiles(path.join(fixtureRoot, "audit"), (file) => file.endsWith(".jsonl")), validateAudit],
    ["vector request", listFiles(path.join(fixtureRoot, "vector"), (file) => file.endsWith(".json")), validateVectorRequest],
  ];

  for (const [label, files, validate] of checks) {
    if (!files.length) fail(`Missing OKF ${label} fixture in ${path.relative(root, fixtureRoot)}`);
    for (const file of files) validate(file);
    total += files.length;
    groupCount += 1;
  }
}

console.log(`OKF fixture validation passed: ${total} files across ${groupCount} fixture groups`);
