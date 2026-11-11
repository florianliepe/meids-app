#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const apply = process.argv.includes("--apply");
const baseUrl = String(process.env.N8N_API_BASE_URL || "").replace(/\/+$/, "");
const apiKey = String(process.env.N8N_API_KEY || "");
if (!baseUrl || !apiKey) throw new Error("N8N_API_BASE_URL and N8N_API_KEY are required.");

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-N8N-API-KEY": apiKey, ...(options.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method || "GET"} ${pathname} failed ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

function productionName(name) {
  return String(name || "")
    .replace(/\bstaging\b/gi, "Production")
    .replace(/\s+-\s+Production\s+Production\b/gi, " - Production");
}

function updatePayload(workflow, name) {
  return {
    name,
    nodes: workflow.nodes || [],
    connections: workflow.connections || {},
    settings: workflow.settings || {},
    staticData: workflow.staticData || null,
  };
}

(async () => {
  const listed = await request("/api/v1/workflows?active=true&limit=250");
  const candidates = (listed.data || []).filter((workflow) => /\bstaging\b/i.test(workflow.name || ""));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(root, "exports", "n8n-live-backups", `${stamp}-production-label-cleanup`);
  const changes = [];
  for (const summary of candidates) {
    const workflow = await request(`/api/v1/workflows/${encodeURIComponent(summary.id)}`);
    const nextName = productionName(workflow.name);
    changes.push({ id: workflow.id, from: workflow.name, to: nextName, active: workflow.active === true });
    if (!apply) continue;
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, `${workflow.id}.json`), `${JSON.stringify(workflow, null, 2)}\n`);
    await request(`/api/v1/workflows/${encodeURIComponent(workflow.id)}`, {
      method: "PUT",
      body: JSON.stringify(updatePayload(workflow, nextName)),
    });
  }
  console.log(JSON.stringify({ status: apply ? "applied" : "planned", active_only: true, changes, backup: apply ? path.relative(root, backupDir).replaceAll("\\", "/") : null }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
