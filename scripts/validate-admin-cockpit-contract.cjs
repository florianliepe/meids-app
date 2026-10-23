const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const failures = [];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const requireText = (file, text, needle) => {
  if (!text.includes(needle)) failures.push(`${file} missing ${needle}`);
};

const backend = read("backend/server.js");
const migration = read("backend/migrations/014_admin_cockpit_read_policies.sql");
const main = read("frontend/index.html");
const app = read("frontend/app.js");
const admin = read("frontend/admin/admin.js");
const adminHtml = read("frontend/admin/index.html");
const swa = JSON.parse(read("frontend/staticwebapp.config.json"));

[
  "/api/admin/overview",
  "/api/admin/users",
  "/api/admin/users/roles",
  "/api/admin/audit",
  "can_access_admin_cockpit",
  "owner role is governed in Microsoft Entra",
  "Only an owner can grant or revoke the admin role",
].forEach((needle) => requireText("backend/server.js", backend, needle));

[
  "app_security.is_application_manager()",
  "concept_admin_read",
  "learning_admin_read",
  "audit_event_admin_read",
].forEach((needle) => requireText("backend/migrations/014_admin_cockpit_read_policies.sql", migration, needle));

requireText("frontend/index.html", main, 'id="adminCockpitBtn"');
requireText("frontend/index.html", main, 'id="landingAdminCockpitBtn"');
requireText("frontend/app.js", app, "canAccessAdminCockpit");
requireText("frontend/admin/index.html", adminHtml, "Users &amp; access");
requireText("frontend/admin/index.html", adminHtml, "Platform health");
requireText("frontend/admin/admin.js", admin, "hasAdminAccess");
requireText("frontend/admin/admin.js", admin, "/api/admin/overview");
requireText("frontend/admin/admin.js", admin, "/api/admin/users/roles");

const adminRoute = (swa.routes || []).find((route) => route.route === "/admin*");
if (!adminRoute || !Array.isArray(adminRoute.allowedRoles) || !adminRoute.allowedRoles.includes("authenticated")) {
  failures.push("frontend/staticwebapp.config.json must protect /admin* with authenticated role");
}

if (failures.length) {
  console.error(JSON.stringify({ status: "failed", failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  status: "passed",
  checks: [
    "server_side_admin_authorization",
    "entra_owned_owner_role",
    "tenant_scoped_admin_read_policies",
    "separate_admin_frontend",
    "authenticated_static_route",
  ],
}, null, 2));
