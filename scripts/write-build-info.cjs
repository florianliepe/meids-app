const fs = require("node:fs");
const path = require("node:path");
const { createBuildInfo } = require("../backend/buildInfo");
const root = path.resolve(__dirname, "..");
const component = process.argv[2];
if (component !== "backend") throw new Error("Usage: node scripts/write-build-info.cjs backend");
const output = path.join(root, "backend", "build-info.json");
fs.writeFileSync(output, `${JSON.stringify(createBuildInfo(component), null, 2)}\n`, "utf8");
console.log("Backend build identity written (no environment secrets included).");
