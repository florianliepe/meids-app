(function initAdminCockpit() {
  const api = window.IntellectualTwinApi;
  const state = { session: null, overview: null, users: [], audit: [], rolePolicy: {} };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[char]);
  }

  function number(value) {
    return new Intl.NumberFormat("en").format(Number(value || 0));
  }

  function time(value) {
    if (!value) return "-";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function showToast(message, error = false) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.toggle("error", error);
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 4200);
  }

  function hasAdminAccess(session) {
    const roles = new Set((session?.roles || []).map((role) => String(role).toLowerCase()));
    return Boolean(session?.permissions?.can_access_admin_cockpit || roles.has("admin") || roles.has("owner"));
  }

  function renderGate(title, copy, action = "") {
    const gate = $("#accessGate");
    gate.innerHTML = `<p class="eyebrow">Admin Cockpit</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(copy)}</p>${action}`;
    gate.hidden = false;
    $("#adminContent").hidden = true;
  }

  async function loadSession() {
    try {
      state.session = await api.getJson("/api/session");
    } catch (error) {
      if (Number(error.status) === 401) {
        renderGate("Sign in required", "Use your Microsoft identity before opening platform administration.", '<a class="button" href="../login">Sign in with Microsoft</a>');
      } else {
        renderGate("Administration unavailable", error.message || "The session could not be verified.", '<a class="button secondary" href="../">Back to workspace</a>');
      }
      return false;
    }
    $("#sessionLabel").textContent = state.session.user?.email || state.session.user?.name || "Authenticated";
    if (!hasAdminAccess(state.session)) {
      renderGate("Access restricted", "Platform administration requires the Me.IDs admin or owner role. Your workspace access remains unchanged.", '<a class="button secondary" href="../">Back to workspace</a>');
      return false;
    }
    return true;
  }

  async function loadData() {
    const [overview, users, audit] = await Promise.all([
      api.getJson("/api/admin/overview"),
      api.getJson("/api/admin/users"),
      api.getJson("/api/admin/audit?limit=100"),
    ]);
    state.overview = overview;
    state.users = users.users || [];
    state.rolePolicy = users.role_policy || {};
    state.audit = audit.events || [];
  }

  function renderMetrics() {
    const metrics = state.overview?.metrics || {};
    const items = [
      [metrics.users?.active, "active users"],
      [metrics.twins?.active, "active twins"],
      [metrics.knowledge?.review_needed, "knowledge reviews"],
      [metrics.learning?.review_needed, "learning reviews"],
      [metrics.traces?.last_24h, "agent traces / 24h"],
      [metrics.approvals?.pending, "approval gates"],
    ];
    $("#metricStrip").innerHTML = items.map(([value, label]) => `<article class="metric"><strong>${number(value)}</strong><span>${escapeHtml(label)}</span></article>`).join("");
  }

  function statusItem(label, status, detail) {
    const normalized = String(status || "unknown").toLowerCase();
    const className = ["ok", "ready", "configured", "active"].includes(normalized)
      ? "ready"
      : ["blocked", "error", "failed", "degraded"].includes(normalized) ? "blocked" : "attention";
    return `<article class="health-item ${className}"><header><h3>${escapeHtml(label)}</h3><i class="status-dot" aria-hidden="true"></i></header><strong>${escapeHtml(status || "unknown")}</strong><p>${escapeHtml(detail || "No detail reported")}</p></article>`;
  }

  function renderHealth() {
    const health = state.overview?.health || {};
    const agents = health.agents || {};
    const configuredAgents = Object.values(agents).filter((agent) => agent.configured).length;
    $("#healthGrid").innerHTML = [
      statusItem("Backend", health.status, "Application service readiness"),
      statusItem("PostgreSQL", health.storage?.database_status || health.storage?.mode, "Managed-identity data plane"),
      statusItem("Azure AI Search", health.vector_search?.status, health.vector_search?.reason || "Knowledge retrieval index"),
      statusItem("n8n administration", health.n8n_admin?.status, "Read-only workflow inventory boundary"),
      statusItem("Voice gateway", health.voice_transcription?.status, health.voice_transcription?.model || "Transcription provider"),
      statusItem("Agent routes", configuredAgents === Object.keys(agents).length ? "ready" : "attention", `${configuredAgents}/${Object.keys(agents).length} backend routes configured`),
      statusItem("Outbox", Number(state.overview?.metrics?.outbox?.failed || 0) ? "degraded" : "ready", `${number(state.overview?.metrics?.outbox?.pending)} pending, ${number(state.overview?.metrics?.outbox?.failed)} failed`),
      statusItem("Authorization", "ready", "Entra admission with PostgreSQL application roles"),
    ].join("");
  }

  function renderAttentionQueue() {
    const metrics = state.overview?.metrics || {};
    const items = [
      [metrics.knowledge?.review_needed, "Knowledge concepts need review"],
      [metrics.learning?.review_needed, "Learning increments need review"],
      [metrics.outbox?.failed, "Outbox events failed"],
      [metrics.approvals?.pending, "Agent actions await approval"],
      [state.users.filter((user) => user.authorization_status === "onboarding").length, "Users need a first twin or assignment"],
    ].filter(([value]) => Number(value || 0) > 0);
    $("#attentionQueue").innerHTML = items.length
      ? items.map(([value, label]) => `<div class="stack-item"><strong>${escapeHtml(label)}</strong><span>${number(value)}</span></div>`).join("")
      : '<div class="stack-item"><strong>No immediate action</strong><span>current snapshot</span></div>';
  }

  function roleControls(user) {
    const roles = new Set(user.roles || []);
    const assignable = new Set(state.rolePolicy.assignable_roles || []);
    const owner = roles.has("owner") ? '<span class="role-token owner">Owner · Entra</span>' : "";
    const editor = `<label><input type="checkbox" data-role="editor" ${roles.has("editor") ? "checked" : ""} ${assignable.has("editor") ? "" : "disabled"}/> Editor</label>`;
    const admin = `<label><input type="checkbox" data-role="admin" ${roles.has("admin") ? "checked" : ""} ${assignable.has("admin") ? "" : "disabled"}/> Admin</label>`;
    return `<div class="role-controls">${owner}${editor}${admin}</div>`;
  }

  function renderUsers() {
    const query = String($("#userSearch").value || "").trim().toLowerCase();
    const users = state.users.filter((user) => `${user.display_name} ${user.email}`.toLowerCase().includes(query));
    $("#usersBody").innerHTML = users.length ? users.map((user) => {
      const twins = Array.isArray(user.twins) ? user.twins : [];
      const twinSummary = twins.length
        ? twins.map((twin) => `${twin.display_name || twin.twin_id} (${twin.access_role})`).join(", ")
        : "No twin assigned";
      return `<tr data-user-id="${escapeHtml(user.user_id)}">
        <td data-label="User"><div class="user-cell"><strong>${escapeHtml(user.display_name || user.email)}</strong><small>${escapeHtml(user.email)} · ${escapeHtml(user.identity_type)}</small></div></td>
        <td data-label="Status"><span class="state-token ${escapeHtml(user.authorization_status)}">${escapeHtml(user.authorization_status)}</span></td>
        <td data-label="Twins"><strong>${number(user.twin_count)}</strong><br/><small>${escapeHtml(twinSummary)}</small></td>
        <td data-label="Application roles">${roleControls(user)}</td>
        <td data-label="Last access"><small>${escapeHtml(time(user.last_seen_at))}</small></td>
        <td class="row-action"><button class="save-roles secondary" type="button" data-save-roles>Save roles</button></td>
      </tr>`;
    }).join("") : '<tr><td class="empty" colspan="6">No users match this filter.</td></tr>';
  }

  function renderGovernance() {
    const metrics = state.overview?.metrics || {};
    const items = [
      [metrics.knowledge?.review_needed, "Knowledge review needed", "New and updated OKF concepts"],
      [metrics.knowledge?.approved, "Approved knowledge", "Available for trusted retrieval"],
      [metrics.learning?.review_needed, "Learning review needed", "Post-turn learning increments"],
      [metrics.outbox?.pending, "Index operations pending", `Oldest ${number(metrics.outbox?.oldest_pending_seconds)} seconds`],
      [metrics.outbox?.failed, "Index operations failed", "Requires operator inspection"],
      [metrics.knowledge?.rejected, "Rejected concepts", "Retained as governed audit evidence"],
    ];
    $("#governanceGrid").innerHTML = items.map(([value, label, detail]) => `<article class="governance-item"><h3>${escapeHtml(label)}</h3><strong>${number(value)}</strong><p>${escapeHtml(detail)}</p></article>`).join("");
  }

  function renderOperations() {
    const traces = state.overview?.metrics?.traces || {};
    const items = [
      [traces.last_24h, "Runs in 24 hours", "Backend-recorded agent traces"],
      [traces.failed_24h, "Failed runs", "Failed or error trace state"],
      [traces.agents_24h, "Active agents", "Distinct agents observed"],
      [state.overview?.metrics?.approvals?.pending, "Approval gates", "Human decision required"],
    ];
    $("#operationsGrid").innerHTML = items.map(([value, label, detail]) => `<article class="operation-item"><h3>${escapeHtml(label)}</h3><strong>${number(value)}</strong><p>${escapeHtml(detail)}</p></article>`).join("");
    $("#usageCoverage").textContent = state.overview?.usage_coverage?.note || "Usage telemetry coverage is not reported.";
  }

  function safeContext(details) {
    if (!details || typeof details !== "object") return "-";
    const allowed = ["before", "after", "twin_id", "active_twin_id", "review_state", "owner_source"];
    const visible = Object.fromEntries(Object.entries(details).filter(([key]) => allowed.includes(key)));
    return Object.keys(visible).length ? JSON.stringify(visible) : "Recorded";
  }

  function renderAudit() {
    $("#auditBody").innerHTML = state.audit.length ? state.audit.map((event) => `<tr>
      <td><small>${escapeHtml(time(event.created_at))}</small></td>
      <td><strong>${escapeHtml(event.action)}</strong></td>
      <td>${escapeHtml(event.resource_type)}<br/><small>${escapeHtml(event.resource_id)}</small></td>
      <td><small>${escapeHtml(event.actor_user_id || "system")}</small></td>
      <td><small>${escapeHtml(safeContext(event.details))}</small></td>
    </tr>`).join("") : '<tr><td class="empty" colspan="5">No audit events are visible for this tenant.</td></tr>';
  }

  function renderAll() {
    $("#snapshotTime").textContent = time(state.overview?.generated_at);
    renderMetrics();
    renderHealth();
    renderAttentionQueue();
    renderUsers();
    renderGovernance();
    renderOperations();
    renderAudit();
  }

  async function saveRoles(row) {
    const userId = row.dataset.userId;
    const user = state.users.find((item) => item.user_id === userId);
    if (!user) return;
    const roles = ["user"];
    row.querySelectorAll("[data-role]").forEach((input) => { if (input.checked) roles.push(input.dataset.role); });
    const button = row.querySelector("[data-save-roles]");
    button.disabled = true;
    try {
      const result = await api.postJson("/api/admin/users/roles", { user_id: userId, roles });
      user.roles = result.roles || roles;
      showToast(`Roles updated for ${user.display_name || user.email}.`);
      await refresh();
    } catch (error) {
      showToast(error.message || "Role update failed.", true);
    } finally {
      button.disabled = false;
    }
  }

  function bind() {
    $("#refreshBtn").addEventListener("click", refresh);
    $("#userSearch").addEventListener("input", renderUsers);
    $("#usersBody").addEventListener("click", (event) => {
      const button = event.target.closest("[data-save-roles]");
      if (button) void saveRoles(button.closest("tr"));
    });
    $$("[data-section]").forEach((button) => button.addEventListener("click", () => {
      $$("[data-section]").forEach((item) => item.classList.toggle("active", item === button));
      $$(".admin-section").forEach((section) => section.classList.toggle("active", section.id === button.dataset.section));
    }));
  }

  async function refresh() {
    $("#refreshBtn").disabled = true;
    try {
      await loadData();
      renderAll();
    } catch (error) {
      showToast(error.message || "Admin data could not be refreshed.", true);
    } finally {
      $("#refreshBtn").disabled = false;
    }
  }

  async function start() {
    bind();
    if (!await loadSession()) return;
    try {
      await loadData();
      renderAll();
      $("#accessGate").hidden = true;
      $("#adminContent").hidden = false;
    } catch (error) {
      renderGate("Administration unavailable", error.message || "Admin data could not be loaded.", '<a class="button secondary" href="../">Back to workspace</a>');
    }
  }

  void start();
})();
