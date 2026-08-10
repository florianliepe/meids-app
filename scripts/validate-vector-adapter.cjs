const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const vectorRoots = [
  path.join(root, "contracts", "okf", "examples", "vector"),
  path.join(root, "contracts", "okf", "generated", "vector"),
];

const allowedOperations = new Set(["upsert", "delete", "refresh_status"]);
const allowedPolicies = new Set(["approved_only", "selected_pending"]);
const trustedStates = new Set(["approved"]);
const reviewableStates = new Set(["approved", "pending-review", "candidate"]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJson(full);
    return entry.isFile() && entry.name.endsWith(".json") ? [full] : [];
  });
}

function rel(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function requireString(value, field, file) {
  if (typeof value !== "string" || !value.trim()) fail(`${rel(file)}: ${field} must be a non-empty string`);
}

function validateDocument(document, index, request, file) {
  const prefix = `documents[${index}]`;
  for (const field of ["concept_id", "repo_path", "review_state", "metadata"]) {
    if (document[field] === undefined || document[field] === null) fail(`${rel(file)}: ${prefix}.${field} missing`);
  }
  requireString(document.concept_id, `${prefix}.concept_id`, file);
  requireString(document.repo_path, `${prefix}.repo_path`, file);
  if (!reviewableStates.has(document.review_state)) {
    fail(`${rel(file)}: ${prefix}.review_state must be one of ${Array.from(reviewableStates).join(", ")}`);
  }
  if (request.source_policy === "approved_only" && !trustedStates.has(document.review_state)) {
    fail(`${rel(file)}: approved_only requests cannot include ${prefix}.review_state=${document.review_state}`);
  }
  if (request.operation === "upsert") {
    if (!("text" in document) && !("text_ref" in document)) fail(`${rel(file)}: ${prefix} needs text or text_ref for upsert`);
    if (document.text !== undefined && typeof document.text !== "string") fail(`${rel(file)}: ${prefix}.text must be a string`);
    if (document.text_ref !== undefined) requireString(document.text_ref, `${prefix}.text_ref`, file);
  }
  if (typeof document.metadata !== "object" || Array.isArray(document.metadata)) {
    fail(`${rel(file)}: ${prefix}.metadata must be an object`);
  }
  for (const field of ["cluster", "type", "evidence_refs", "evidence_review_states"]) {
    if (document.metadata[field] === undefined) fail(`${rel(file)}: ${prefix}.metadata.${field} missing`);
  }
  if (!Array.isArray(document.metadata.evidence_refs)) {
    fail(`${rel(file)}: ${prefix}.metadata.evidence_refs must be an array`);
  }
  if (!Array.isArray(document.metadata.evidence_review_states)) {
    fail(`${rel(file)}: ${prefix}.metadata.evidence_review_states must be an array`);
  }
  if (document.metadata.evidence_review_states.length !== document.metadata.evidence_refs.length) {
    fail(`${rel(file)}: ${prefix}.metadata.evidence_review_states must align one-to-one with evidence_refs`);
  }
  for (const [evidenceIndex, state] of document.metadata.evidence_review_states.entries()) {
    if (!reviewableStates.has(state)) {
      fail(`${rel(file)}: ${prefix}.metadata.evidence_review_states[${evidenceIndex}] must be one of ${Array.from(reviewableStates).join(", ")}`);
    }
    if (request.source_policy === "approved_only" && !trustedStates.has(state)) {
      fail(`${rel(file)}: approved_only requests cannot include ${prefix}.metadata.evidence_review_states[${evidenceIndex}]=${state}`);
    }
  }
}

function validateRequest(file) {
  const request = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const field of ["operation", "twin_id", "source_policy", "documents"]) {
    if (request[field] === undefined || request[field] === null) fail(`${rel(file)}: ${field} missing`);
  }
  if (!allowedOperations.has(request.operation)) {
    fail(`${rel(file)}: operation must be one of ${Array.from(allowedOperations).join(", ")}`);
  }
  requireString(request.twin_id, "twin_id", file);
  if (!allowedPolicies.has(request.source_policy)) {
    fail(`${rel(file)}: source_policy must be approved_only or selected_pending`);
  }
  if (!Array.isArray(request.documents) || request.documents.length === 0) {
    fail(`${rel(file)}: documents must be a non-empty array`);
  }
  request.documents.forEach((document, index) => validateDocument(document, index, request, file));
}

const files = vectorRoots.flatMap(listJson);
if (!files.length) fail("No vector adapter fixtures found");
files.forEach(validateRequest);

console.log(`Vector adapter validation passed: ${files.length} request fixtures`);
