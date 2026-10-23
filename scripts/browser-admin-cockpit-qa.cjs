const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(process.argv[2] || "dist-admin-uat");
const outDir = path.resolve(process.argv[3] || path.join("docs", "visual-qa", "admin-cockpit-mvp"));
const port = Number(process.env.MEIDS_ADMIN_QA_PORT || 8796);
const host = "127.0.0.1";

function type(file) {
  return { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" }[path.extname(file)] || "application/octet-stream";
}

function server() {
  const instance = http.createServer((request, response) => {
    let requested = decodeURIComponent(String(request.url || "/").split("?")[0]);
    if (requested.endsWith("/")) requested += "index.html";
    const file = path.resolve(root, `.${requested}`);
    if (!file.startsWith(root)) { response.writeHead(403); response.end("forbidden"); return; }
    fs.readFile(file, (error, body) => {
      if (error) { response.writeHead(404); response.end("not found"); return; }
      response.writeHead(200, { "Content-Type": type(file) });
      response.end(body);
    });
  });
  return new Promise((resolve) => instance.listen(port, host, () => resolve(instance)));
}

const session = {
  status: "authenticated",
  user: { id: "entra-qa-owner", email: "florian.liepe@eraneos.com", name: "Florian Liepe" },
  tenant: { id: "eraneos", name: "Eraneos" },
  roles: ["user", "owner"],
  permissions: { can_access_admin_cockpit: true, can_manage_users: true, can_manage_admins: true },
};

const users = {
  role_policy: { assignable_roles: ["user", "editor", "admin"], owner_role_source: "microsoft_entra", owner_role_mutable: false },
  users: [
    { user_id: "entra-florian", display_name: "Florian Liepe", email: "florian.liepe@eraneos.com", identity_type: "employee", status: "active", authorization_status: "provisioned", roles: ["user", "owner"], twin_count: 2, last_seen_at: "2026-10-23T09:31:00Z", twins: [{ twin_id: "florian", display_name: "Florian", access_role: "owner" }, { twin_id: "lucas", display_name: "Lucas", access_role: "owner" }] },
    { user_id: "entra-adem", display_name: "Adem Korkutan", email: "adem.korkutan@eraneos.com", identity_type: "employee", status: "active", authorization_status: "provisioned", roles: ["user", "owner"], twin_count: 1, last_seen_at: "2026-10-23T08:15:00Z", twins: [{ twin_id: "adem", display_name: "Adem", access_role: "owner" }] },
    { user_id: "entra-daniel", display_name: "Daniel Zimmer", email: "daniel.zimmer@eraneos.com", identity_type: "employee", status: "active", authorization_status: "onboarding", roles: ["user"], twin_count: 0, last_seen_at: "2026-10-22T13:05:00Z", twins: [] },
    { user_id: "entra-guest", display_name: "External Reviewer", email: "reviewer@example.org", identity_type: "guest", status: "active", authorization_status: "provisioned", roles: ["user", "editor"], twin_count: 1, last_seen_at: "2026-10-21T16:42:00Z", twins: [{ twin_id: "review", display_name: "Review Twin", access_role: "reviewer" }] },
  ],
};

const overview = {
  status: "ok",
  generated_at: "2026-10-23T10:00:00Z",
  metrics: {
    users: { total: 4, active: 4, active_30d: 4 },
    twins: { total: 4, active: 4, draft: 0, archived: 0 },
    knowledge: { total: 38, review_needed: 6, approved: 29, rejected: 3 },
    learning: { total: 9, review_needed: 2 },
    outbox: { pending: 1, failed: 0, oldest_pending_seconds: 42 },
    traces: { total: 174, last_24h: 21, failed_24h: 1, agents_24h: 5 },
    approvals: { pending: 2 },
  },
  health: {
    status: "ok",
    storage: { mode: "postgres", database_status: "ready" },
    vector_search: { status: "ready" },
    n8n_admin: { status: "ready" },
    voice_transcription: { status: "configured", model: "gpt-4o-mini-transcribe" },
    agents: { actor_twin: { configured: true }, knowledge_fabric_agent: { configured: true }, agentic_butler: { configured: true } },
  },
  usage_coverage: { level: "partial", note: "Embedded n8n chat token totals require normalized post-turn telemetry and are not inferred from prompt content." },
};

const audit = { events: [
  { event_id: "1", created_at: "2026-10-23T09:42:00Z", action: "application_roles_updated", resource_type: "app_user", resource_id: "entra-guest", actor_user_id: "entra-florian", details: { before: ["user"], after: ["user", "editor"] } },
  { event_id: "2", created_at: "2026-10-23T08:20:00Z", action: "knowledge_rejected", resource_type: "concept", resource_id: "concept-uat", actor_user_id: "entra-florian", details: { review_state: "rejected", twin_id: "florian" } },
] };

async function run() {
  const playwright = require("playwright");
  fs.mkdirSync(outDir, { recursive: true });
  const web = await server();
  const browser = await playwright.chromium.launch({ headless: true });
  const cases = [
    { name: "admin-cockpit-desktop", width: 1440, height: 1000 },
    { name: "admin-cockpit-mobile", width: 390, height: 844 },
  ];
  const results = [];
  try {
    for (const test of cases) {
      const page = await browser.newPage({ viewport: { width: test.width, height: test.height } });
      await page.route("**/api/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
      await page.route("**/api/admin/overview", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(overview) }));
      await page.route("**/api/admin/users", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(users) }));
      await page.route("**/api/admin/audit?limit=100", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(audit) }));
      await page.goto(`http://${host}:${port}/admin/`, { waitUntil: "networkidle" });
      await page.waitForSelector("#adminContent:not([hidden])");
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        metrics: document.querySelectorAll(".metric").length,
        health: document.querySelectorAll(".health-item").length,
      }));
      const failures = [];
      if (dimensions.scrollWidth > dimensions.viewport + 2) failures.push(`horizontal overflow ${dimensions.scrollWidth}/${dimensions.viewport}`);
      if (dimensions.metrics !== 6) failures.push(`expected 6 metrics, found ${dimensions.metrics}`);
      if (dimensions.health !== 8) failures.push(`expected 8 health items, found ${dimensions.health}`);
      await page.locator('[data-section="users"]').click();
      if (await page.locator("#usersBody tr").count() !== 4) failures.push("user table did not render four users");
      const screenshot = path.join(outDir, `${test.name}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      results.push({ ...test, status: failures.length ? "failed" : "passed", failures, dimensions, screenshot });
      await page.close();
    }
  } finally {
    await browser.close();
    web.close();
  }
  const report = { generated_at: new Date().toISOString(), passed: results.every((item) => item.status === "passed"), cases: results };
  fs.writeFileSync(path.join(outDir, "admin-cockpit-qa.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) throw new Error(results.flatMap((item) => item.failures).join("; "));
  console.log(`Admin Cockpit browser QA passed: ${results.length} cases`);
}

run().catch((error) => { console.error(error); process.exit(1); });
