const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function argValue(name, fallback = "") {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function main() {
  const backendUrl = String(argValue("--backend-url", process.env.MEIDS_BACKEND_URL || "http://127.0.0.1:8080")).replace(/\/+$/, "");
  const fixturePath = path.resolve(root, argValue("--fixture", "contracts/okf/examples/vector/approved-only-upsert-request.json"));
  const dryRun = process.argv.includes("--dry-run");
  if (!fs.existsSync(fixturePath)) fail(`Fixture not found: ${path.relative(root, fixturePath)}`);
  const request = readJson(fixturePath);
  let response;
  try {
    response = await fetch(`${backendUrl}/api/vector-index/rebuild`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, dry_run: dryRun }),
    });
  } catch (error) {
    console.log(JSON.stringify({
      status: "blocked",
      reason: "backend_unavailable",
      backend_url: backendUrl,
      fixture: path.relative(root, fixturePath).replaceAll("\\", "/"),
      dry_run: dryRun,
      detail: error.message || String(error),
    }, null, 2));
    process.exit(2);
  }
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    console.log(JSON.stringify({
      status: "blocked",
      backend_url: backendUrl,
      fixture: path.relative(root, fixturePath).replaceAll("\\", "/"),
      response_status: response.status,
      response: data,
    }, null, 2));
    process.exit(response.status >= 500 ? 2 : 1);
  }
  console.log(JSON.stringify({
    status: data.status || "completed",
    backend_url: backendUrl,
    fixture: path.relative(root, fixturePath).replaceAll("\\", "/"),
    dry_run: dryRun,
    response: data,
  }, null, 2));
}

main().catch((error) => fail(error.message || String(error)));
