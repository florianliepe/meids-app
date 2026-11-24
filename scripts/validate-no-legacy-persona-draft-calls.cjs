const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "frontend", "index.html"), "utf8");

const forbidden = [
  "/api/persona/drafts",
  "/api/persona/draft",
  "/api/persona/promote",
  "/api/agents/persona-modeler/run",
  "/api/agents/persona-quality/run",
];

const failures = forbidden.filter((endpoint) => app.includes(endpoint));
if (failures.length) {
  throw new Error(`Legacy persona endpoints remain in the frontend: ${failures.join(", ")}`);
}

for (const control of ["personaDraftSelect", "runPersonaModelerBtn", "runPersonaQualityBtn"]) {
  if (html.includes(control)) throw new Error(`Legacy persona control remains: ${control}`);
}

console.log("Legacy persona draft calls are absent from the frontend.");
