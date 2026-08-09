const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const promotionDir = path.join(root, "contracts", "okf", "promotions");
const generatedEdgeDir = path.join(root, "contracts", "okf", "generated", "graph", "edges");
const exampleEdgeDir = path.join(root, "contracts", "okf", "examples", "graph", "edges");

const transitionRules = {
  approve: { to_review_state: "approved", allowed_edge_classes: ["explicit", "inferred"] },
  reject: { to_review_state: "rejected", allowed_edge_classes: ["candidate", "duplicate-candidate", "contradiction-candidate"] },
  "needs-rework": { to_review_state: "needs-rework", allowed_edge_classes: ["candidate", "duplicate-candidate", "contradiction-candidate"] },
};

function fail(message) {
  throw new Error(message);
}

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(dir, file));
}

function listYaml(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".yaml"))
    .map((file) => path.join(dir, file));
}

function parseFlatYaml(file) {
  const data = {};
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    data[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return data;
}

function required(data, file, fields) {
  for (const field of fields) {
    if (data[field] === undefined || data[field] === "") fail(`${file}: ${field} missing`);
  }
}

const edges = new Map([...listYaml(exampleEdgeDir), ...listYaml(generatedEdgeDir)].map((file) => {
  const edge = parseFlatYaml(file);
  return [edge.edge_key, edge];
}));

if (!edges.size) fail("No graph edge fixtures found");

const files = listJson(promotionDir);
if (!files.length) fail("No graph promotion fixtures found");

for (const file of files) {
  const promotion = JSON.parse(fs.readFileSync(file, "utf8"));
  required(promotion, file, [
    "schema",
    "promotion_id",
    "edge_key",
    "twin_id",
    "from_state",
    "decision",
    "to_review_state",
    "to_edge_class",
    "reviewer",
    "reviewed_at",
    "rationale",
    "effects",
  ]);
  if (promotion.schema !== "okf.graph_promotion.v1") fail(`${file}: schema must be okf.graph_promotion.v1`);
  const rule = transitionRules[promotion.decision];
  if (!rule) fail(`${file}: invalid decision ${promotion.decision}`);
  if (promotion.from_state !== "candidate") fail(`${file}: graph promotion must start from candidate`);
  if (promotion.to_review_state !== rule.to_review_state) {
    fail(`${file}: ${promotion.decision} must transition to ${rule.to_review_state}`);
  }
  if (!rule.allowed_edge_classes.includes(promotion.to_edge_class)) {
    fail(`${file}: invalid to_edge_class ${promotion.to_edge_class} for ${promotion.decision}`);
  }
  const edge = edges.get(promotion.edge_key);
  if (!edge) fail(`${file}: edge_key ${promotion.edge_key} does not match a fixture edge`);
  if (edge.review_state !== promotion.from_state) {
    fail(`${file}: edge ${promotion.edge_key} review_state ${edge.review_state} does not match promotion from_state ${promotion.from_state}`);
  }
  if (!promotion.effects.audit_operation) fail(`${file}: effects.audit_operation missing`);
  if (!promotion.effects.retrieval_use) fail(`${file}: effects.retrieval_use missing`);
}

console.log(`Graph promotion validation passed: ${files.length} promotion fixtures against ${edges.size} edge fixtures`);
