const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const vectorRoots = [
  path.join(root, "contracts", "okf", "examples", "vector"),
  path.join(root, "contracts", "okf", "generated", "vector"),
];
const negativeVectorRoot = path.join(root, "contracts", "okf", "negative", "vector");

const allowedOperations = new Set(["upsert", "delete", "refresh_status"]);
const allowedPolicies = new Set(["approved_only", "selected_pending"]);
const trustedStates = new Set(["approved"]);
const reviewableStates = new Set(["approved", "pending-review", "candidate"]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function invalid(message) {
  throw new Error(message);
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
  if (typeof value !== "string" || !value.trim()) invalid(`${rel(file)}: ${field} must be a non-empty string`);
}

function validateDocument(document, index, request, file) {
  const prefix = `documents[${index}]`;
  for (const field of ["concept_id", "repo_path", "review_state", "metadata"]) {
    if (document[field] === undefined || document[field] === null) invalid(`${rel(file)}: ${prefix}.${field} missing`);
  }
  requireString(document.concept_id, `${prefix}.concept_id`, file);
  requireString(document.repo_path, `${prefix}.repo_path`, file);
  if (!reviewableStates.has(document.review_state)) {
    invalid(`${rel(file)}: invalid vector review_state ${document.review_state}`);
  }
  if (request.source_policy === "approved_only" && !trustedStates.has(document.review_state)) {
    invalid(`${rel(file)}: approved_only requests cannot include ${prefix}.review_state=${document.review_state}`);
  }
  if (request.operation === "upsert") {
    if (!("text" in document) && !("text_ref" in document)) invalid(`${rel(file)}: ${prefix} needs text or text_ref for upsert`);
    if (document.text !== undefined && typeof document.text !== "string") invalid(`${rel(file)}: ${prefix}.text must be a string`);
    if (document.text_ref !== undefined) requireString(document.text_ref, `${prefix}.text_ref`, file);
  }
  if (typeof document.metadata !== "object" || Array.isArray(document.metadata)) {
    invalid(`${rel(file)}: ${prefix}.metadata must be an object`);
  }
  for (const field of ["cluster", "type", "evidence_refs", "evidence_review_states"]) {
    if (document.metadata[field] === undefined) invalid(`${rel(file)}: ${prefix}.metadata.${field} missing`);
  }
  if (!Array.isArray(document.metadata.evidence_refs)) {
    invalid(`${rel(file)}: ${prefix}.metadata.evidence_refs must be an array`);
  }
  if (!Array.isArray(document.metadata.evidence_review_states)) {
    invalid(`${rel(file)}: ${prefix}.metadata.evidence_review_states must be an array`);
  }
  if (document.metadata.evidence_review_states.length !== document.metadata.evidence_refs.length) {
    invalid(`${rel(file)}: ${prefix}.metadata.evidence_review_states must align one-to-one with evidence_refs`);
  }
  for (const [evidenceIndex, state] of document.metadata.evidence_review_states.entries()) {
    if (!reviewableStates.has(state)) {
      invalid(`${rel(file)}: invalid vector evidence review state ${state}`);
    }
    if (request.source_policy === "approved_only" && !trustedStates.has(state)) {
      invalid(`${rel(file)}: approved_only requests cannot include ${prefix}.metadata.evidence_review_states[${evidenceIndex}]=${state}`);
    }
  }
}

function validateRequestPayload(request, file) {
  for (const field of ["operation", "twin_id", "source_policy", "documents"]) {
    if (request[field] === undefined || request[field] === null) invalid(`${rel(file)}: ${field} missing`);
  }
  if (!allowedOperations.has(request.operation)) {
    invalid(`${rel(file)}: operation must be one of ${Array.from(allowedOperations).join(", ")}`);
  }
  requireString(request.twin_id, "twin_id", file);
  if (!allowedPolicies.has(request.source_policy)) {
    invalid(`${rel(file)}: source_policy must be approved_only or selected_pending`);
  }
  if (!Array.isArray(request.documents) || request.documents.length === 0) {
    invalid(`${rel(file)}: documents must be a non-empty array`);
  }
  request.documents.forEach((document, index) => validateDocument(document, index, request, file));
}

function validateRequest(file) {
  validateRequestPayload(JSON.parse(fs.readFileSync(file, "utf8")), file);
}

function validateNegativeFixture(file) {
  const fixture = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!fixture.expected_failure || typeof fixture.expected_failure !== "string") {
    fail(`${rel(file)}: expected_failure must be a non-empty string`);
  }
  if (!fixture.request || typeof fixture.request !== "object") {
    fail(`${rel(file)}: request must be an object`);
  }
  try {
    validateRequestPayload(fixture.request, file);
  } catch (error) {
    const message = String(error.message || "");
    if (!message.includes(fixture.expected_failure)) {
      fail(`${rel(file)}: expected failure "${fixture.expected_failure}" but got "${message}"`);
    }
    return;
  }
  fail(`${rel(file)}: negative fixture unexpectedly passed`);
}

const files = vectorRoots.flatMap(listJson);
if (!files.length) fail("No vector adapter fixtures found");
files.forEach(validateRequest);

const negativeFiles = listJson(negativeVectorRoot);
if (!negativeFiles.length) fail("No negative vector adapter fixtures found");
negativeFiles.forEach(validateNegativeFixture);

console.log(`Vector adapter validation passed: ${files.length} request fixtures, ${negativeFiles.length} negative fixtures`);
