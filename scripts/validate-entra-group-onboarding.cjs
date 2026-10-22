const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(root, "frontend", "api.js"), "utf8");
const app = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");
const backend = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8");
const applicationRoleMigration = fs.readFileSync(
  path.join(root, "backend", "migrations", "008_application_authorization_roles.sql"),
  "utf8",
);

const checks = [
  [api.includes("requestError.status = response.status"), "frontend API errors retain the HTTP status"],
  [app.includes('status = Number(error.status || 0) === 403 ? "access_pending" : "unauthenticated"'), "403 maps to access_pending"],
  [app.includes("Signing in again will not change this state"), "access-pending UI prevents a misleading login retry"],
  [app.includes('return state.authSession?.status === "authenticated"'), "workspace authorization distinguishes authenticated users from access-pending identities"],
  [app.includes('return canEnterWorkspace() || (viewId === "twins" && canCreateTwin())'), "authenticated users without twins can reach first-twin onboarding"],
  [app.includes('document.body.classList.toggle("auth-blocked", enabled && !authenticated)'), "first-time authenticated users are not pointer-blocked"],
  [/postJson\("\/api\/twins"[\s\S]{0,500}await loadAuthSession\(\);[\s\S]{0,100}applyAuthState\(\);/.test(app), "first twin creation refreshes authorization before workspace activation"],
  [backend.includes("function trustedApplicationPrincipal"), "trusted Entra application authentication admits baseline users"],
  [backend.includes("MEIDS_AUTH_ALLOWED_IDPS"), "JIT admission is restricted to configured identity providers"],
  [backend.includes("MEIDS_ENTRA_TENANT_ID"), "JIT admission validates the Entra tenant when the claim is available"],
  [backend.includes("MEIDS_AUTHZ_USER_GROUP_ID"), "backend has a configured users-group boundary"],
  [backend.includes("MEIDS_AUTHZ_OWNER_GROUP_ID"), "backend has a configured owners-group boundary"],
  [backend.includes("MEIDS_AUTHZ_OWNER_USER_IDS"), "bootstrap owners use immutable Entra object IDs"],
  [backend.includes("await ensureJitAuthorizationMapping(pool, principal)"), "database mapping can be provisioned before authorization lookup"],
  [backend.includes('["user", "employee"].includes(role) ? "viewer" : role'), "Me.IDs User and Employee app roles map to viewer"],
  [backend.includes("identity.user_application_role"), "global application roles are read independently from twin access"],
  [applicationRoleMigration.includes("role IN ('user', 'editor', 'admin', 'owner')"), "application role schema uses the approved role set"],
  [backend.includes("Only an owner can grant or revoke the owner role."), "owner escalation is owner-only"],
  [backend.includes("The final application owner cannot be removed."), "the final owner is protected"],
  [backend.includes('? (mapping.allowed_twin_ids || [])'), "mapped users without twins do not inherit an environment fallback twin"],
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, label] of checks) {
  process.stdout.write(`${passed ? "PASS" : "FAIL"} ${label}\n`);
}
if (failures.length) process.exitCode = 1;
