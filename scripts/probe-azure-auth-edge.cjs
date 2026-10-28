const fs = require("node:fs");
const path = require("node:path");

const baseUrl = String(process.env.MEIDS_BACKEND_URL || "https://meids-prod-backend-1853a19b.azurewebsites.net")
  .replace(/\/$/, "");
const outputPath = path.resolve(__dirname, "..", "docs", "uat", "azure-auth-edge-probe.json");

async function probe(label, headers = {}) {
  const response = await fetch(`${baseUrl}/api/session`, {
    headers,
    redirect: "manual",
  });
  return {
    label,
    status: response.status,
    location: response.headers.get("location") || "",
    passed: response.status === 401 || response.status === 302,
  };
}

async function main() {
  const forgedPrincipal = Buffer.from(JSON.stringify({
    auth_typ: "aad",
    claims: [{ typ: "name", val: "synthetic-forgery-probe" }],
  })).toString("base64");
  const scenarios = [
    await probe("anonymous"),
    await probe("forged_x_ms_client_principal", { "x-ms-client-principal": forgedPrincipal }),
  ];
  const evidence = {
    generated_at: new Date().toISOString(),
    target: `${baseUrl}/api/session`,
    status: scenarios.every((scenario) => scenario.passed) ? "passed" : "failed",
    expectation: "Azure App Service authentication rejects unauthenticated and forged-principal requests before application authorization.",
    scenarios,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (evidence.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
