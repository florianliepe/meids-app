#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const match = process.argv.find((item) => item.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : "";
}

function fail(message, details = {}) {
  console.error(JSON.stringify({ status: "blocked", message, ...details }, null, 2));
  process.exit(1);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { response, data, text };
}

async function verifyBackend(backendUrl) {
  const base = backendUrl.replace(/\/+$/, "");
  const health = await requestJson(`${base}/api/health`, { method: "GET" });
  if (!health.response.ok) {
    fail("Hosted backend health check failed.", {
      backend_url: base,
      endpoint: "/api/health",
      http_status: health.response.status,
      body: health.text.slice(0, 800),
    });
  }
  const duplicate = await requestJson(`${base}/api/knowledge/duplicate-check`, {
    method: "POST",
    body: JSON.stringify({
      candidate: {
        title: "Real duplicate scoring publish probe",
        purpose: "Verify hosted backend duplicate-check endpoint before n8n publish.",
        text: "No-write probe for Knowledge Fabric duplicate scoring.",
      },
      twin_id: "florian",
      organization_id: "default",
      source_policy: "selected_pending",
    }),
  });
  if (!duplicate.response.ok) {
    fail("Hosted backend duplicate-check endpoint failed.", {
      backend_url: base,
      endpoint: "/api/knowledge/duplicate-check",
      http_status: duplicate.response.status,
      body: duplicate.text.slice(0, 800),
    });
  }
  return {
    health: health.data,
    duplicate_check: duplicate.data.duplicate_check || {},
    duplicate_provider: duplicate.data.provider || "",
  };
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    shell: process.platform === "win32",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed.`, {
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  return result.stdout.trim();
}

function nodeByName(workflow, name) {
  return (workflow.nodes || []).find((node) => node.name === name);
}

async function main() {
  const backendUrl = (argValue("--backend-url") || env("MEIDS_BACKEND_URL") || env("AGENT_BACKEND_BASE_URL") || env("GH_PAGES_API_BASE_URL")).replace(/\/+$/, "");
  if (!backendUrl) {
    fail("MEIDS_BACKEND_URL is required for real duplicate scoring publish.", {
      required: [
        "Deploy or identify hosted backend URL.",
        "Set MEIDS_BACKEND_URL=https://<backend-app>.azurewebsites.net",
        "Rerun npm run n8n:scoring:publish-real",
      ],
    });
  }
  const verified = await verifyBackend(backendUrl);
  const output = run("npm", ["run", "n8n:boundaries:apply"], { MEIDS_BACKEND_URL: backendUrl });
  const workflowPath = path.join(root, "workflows", "n8n", "knowledge-fabric-agent.workflow.json");
  const workflow = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
  const scoreNode = nodeByName(workflow, "Score duplicate and merge evidence");
  if (scoreNode?.type !== "n8n-nodes-base.httpRequest") {
    fail("Knowledge Fabric scoring node is not HTTP-backed after publish.", {
      node_type: scoreNode?.type || "missing",
    });
  }
  if (scoreNode.parameters?.url !== `${backendUrl}/api/knowledge/duplicate-check`) {
    fail("Knowledge Fabric scoring node does not point to the verified backend URL.", {
      expected: `${backendUrl}/api/knowledge/duplicate-check`,
      actual: scoreNode.parameters?.url || "",
    });
  }
  console.log(JSON.stringify({
    status: "real_scoring_published",
    backend_url: backendUrl,
    backend_duplicate_provider: verified.duplicate_provider || "not_reported",
    backend_duplicate_status: verified.duplicate_check.status || "not_reported",
    n8n_publish: output ? JSON.parse(output.match(/\{[\s\S]*\}$/)?.[0] || "{}") : {},
    workflow: "workflows/n8n/knowledge-fabric-agent.workflow.json",
    scoring_node: {
      name: scoreNode.name,
      type: scoreNode.type,
      url: scoreNode.parameters.url,
    },
  }, null, 2));
}

main().catch((error) => fail(error.message || "Real scoring publish failed."));
