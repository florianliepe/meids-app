const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(root, "frontend", "api.js"), "utf8");
const app = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");
const backend = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8");

const checks = [
  [api.includes("requestError.status = response.status"), "frontend API errors retain the HTTP status"],
  [app.includes('status = Number(error.status || 0) === 403 ? "access_pending" : "unauthenticated"'), "403 maps to access_pending"],
  [app.includes("Signing in again will not change this state"), "access-pending UI prevents a misleading login retry"],
  [backend.includes("function jitAuthorizationEntitlements"), "backend derives explicit group or app-role entitlements"],
  [backend.includes("MEIDS_AUTHZ_USER_GROUP_ID"), "backend has a configured users-group boundary"],
  [backend.includes("MEIDS_AUTHZ_OWNER_GROUP_ID"), "backend has a configured owners-group boundary"],
  [backend.includes("await ensureJitAuthorizationMapping(pool, principal)"), "database mapping can be provisioned before authorization lookup"],
  [backend.includes('role === "user" ? "viewer" : role'), "default Me.IDs User app role maps to viewer"],
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, label] of checks) {
  process.stdout.write(`${passed ? "PASS" : "FAIL"} ${label}\n`);
}
if (failures.length) process.exitCode = 1;
