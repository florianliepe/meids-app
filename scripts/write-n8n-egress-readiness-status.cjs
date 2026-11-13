const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { evaluateN8nEgressReadiness } = require("./lib/n8n-egress-verdict.cjs");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, "frontend", "assets", "n8n-egress-readiness-status.json");
const resourceGroup = process.env.MEIDS_AZURE_RESOURCE_GROUP || "rg-ai-intellectual-twin";
const appService = process.env.MEIDS_AZURE_APP_SERVICE || "meids-prod-backend-1853a19b";
const appInsightsAppId = process.env.MEIDS_APP_INSIGHTS_APP_ID || "b6d06202-72f1-4208-adb5-91f0a26f9eb0";
const minimumHours = Math.max(1, Number(process.env.MEIDS_N8N_EGRESS_MIN_HOURS || 168));
const queryOffset = process.env.MEIDS_N8N_EGRESS_QUERY_OFFSET || "30d";
const observationStartedAt = process.env.MEIDS_N8N_EGRESS_OBSERVATION_STARTED_AT || "2026-11-13T09:04:54.654Z";
const n8nWorkflowName = /(actor twin|knowledge fabric|knowledge retrieval interviewer|agentic butler|skill orchestrator|task agent|critical faculty|learning agent|voice answer|graph curator|queue background work|me\.?ids)/i;
const expectedWorkflowIds = new Set([
  "6zW7jA7bIIcbmIO3", "7Ci86PxXipwvYpKv", "8ER9laJuKS6UrQJF", "dUkrCHpkLmqmFc7I", "eKI3qM7nyCNn9r1q",
  "elbiGicaFmQQW4w8", "KZOqZRUAnVfFEAYJ", "MH1nWMs8IFyNKN1E", "mv6AbIxxvV0Sa5OO", "oPs77Qzrg9Repzgp", "tK8c6ZN89IpMRulz",
  "tPUShq92L9tv6Q3f", "tYLkSrYZcf5Jn18n", "vOZUMWGpZ9xGYHDI", "YXcl8Wb68Oup3Z8n", "zX0s3hOByJ4HWQye",
]);

function runAz(args) {
  const windowsPython = process.platform === "win32"
    ? [process.env.ProgramFiles, "Microsoft SDKs", "Azure", "CLI2", "python.exe"].filter(Boolean).join(path.sep)
    : null;
  const executable = windowsPython && fs.existsSync(windowsPython) ? windowsPython : "az";
  const cliArgs = executable === windowsPython ? ["-IBm", "azure.cli", ...args] : args;
  const result = spawnSync(executable, cliArgs, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    const message = String(result.error?.message || result.stderr || result.stdout || "Azure CLI failed").trim().split(/\r?\n/).slice(-1)[0];
    throw new Error(message || "Azure CLI failed");
  }
  return JSON.parse(result.stdout || "null");
}

function discoverN8nHosts(settings) {
  const hosts = new Set();
  const candidates = (Array.isArray(settings) ? settings : [])
    .filter((item) => /n8n/i.test(String(item?.name || "")))
    .map((item) => String(item?.value || "").trim())
    .filter(Boolean);
  for (const value of candidates) {
    try {
      const host = new URL(value).hostname.toLowerCase();
      if (host) hosts.add(host);
    } catch {
      const host = value.match(/[a-z0-9.-]+\.azurewebsites\.net/i)?.[0]?.toLowerCase();
      if (host) hosts.add(host);
    }
  }
  if (!hosts.size) throw new Error("No retained n8n rollback host was found in App Service settings.");
  return [...hosts].sort();
}

function escapeKusto(value) {
  return String(value).replaceAll("'", "''");
}

function firstRow(result) {
  const table = result?.tables?.[0];
  const row = table?.rows?.[0];
  if (!table || !row) throw new Error("Application Insights returned no dependency telemetry row.");
  return Object.fromEntries(table.columns.map((column, index) => [column.name, row[index]]));
}

function durationHours(start, end) {
  const value = (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000;
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : 0;
}

async function n8nJson(endpoint) {
  const baseUrl = String(process.env.N8N_API_BASE_URL || "").trim().replace(/\/+$/, "");
  const apiKey = String(process.env.N8N_API_KEY || "").trim();
  if (!baseUrl || !apiKey) return null;
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: { Accept: "application/json", "X-N8N-API-KEY": apiKey },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`n8n inventory returned HTTP ${response.status}`);
  return response.json();
}

async function n8nPages(endpoint) {
  const rows = [];
  let cursor = "";
  do {
    const separator = endpoint.includes("?") ? "&" : "?";
    const page = await n8nJson(`${endpoint}${cursor ? `${separator}cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!page) return null;
    rows.push(...(page.data || []));
    cursor = String(page.nextCursor || "");
  } while (cursor);
  return rows;
}

async function inspectN8nWorkflowActivity() {
  const inventory = await n8nPages("/api/v1/workflows?limit=250");
  if (!inventory) return { checked: false, inventory_complete: false, matched_workflows: null, matched_active_workflows: null, missing_expected_workflows: null, workflows_with_activity: null, latest_execution_at: null };
  const workflows = inventory.filter((workflow) => expectedWorkflowIds.has(String(workflow.id)) || n8nWorkflowName.test(String(workflow.name || "")));
  const inventoryIds = new Set(inventory.map((workflow) => String(workflow.id)));
  const missingExpected = [...expectedWorkflowIds].filter((id) => !inventoryIds.has(id));
  const latest = await Promise.all(workflows.map(async (workflow) => {
    const result = await n8nJson(`/api/v1/executions?workflowId=${encodeURIComponent(workflow.id)}&limit=1`);
    return { workflow, started_at: result?.data?.[0]?.startedAt || null };
  }));
  const afterCutover = latest.filter((item) => item.started_at && new Date(item.started_at) >= new Date(observationStartedAt));
  const retentionUnknown = latest.filter((item) => !item.started_at && new Date(item.workflow.createdAt || 0) < new Date(observationStartedAt));
  const preCutoverHistory = latest.filter((item) => item.started_at && new Date(item.started_at) < new Date(observationStartedAt));
  const retentionCoversStart = preCutoverHistory.length > 0;
  return {
    checked: true,
    inventory_complete: missingExpected.length === 0 && retentionCoversStart,
    matched_workflows: workflows.length,
    matched_active_workflows: workflows.filter((workflow) => workflow.active === true).length,
    missing_expected_workflows: missingExpected.length,
    retention_unknown_workflows: retentionUnknown.length,
    execution_retention_covers_start: retentionCoversStart,
    workflows_with_pre_cutover_retention: preCutoverHistory.length,
    workflows_with_activity: afterCutover.length,
    latest_execution_at: afterCutover.map((item) => item.started_at).sort().at(-1) || null,
  };
}

function appSetting(settings, name) {
  return String((settings || []).find((item) => item?.name === name)?.value || "").trim().toLowerCase();
}

function browserBoundaryClean(hosts) {
  const files = [
    path.join(root, "frontend", "runtime-config.js"),
    path.join(root, "frontend", "assets", "agent-runtime-config.json"),
  ];
  return files.every((file) => {
    const text = fs.readFileSync(file, "utf8").toLowerCase();
    return hosts.every((host) => !text.includes(host));
  });
}

async function main() {
  const settings = runAz(["webapp", "config", "appsettings", "list", "--resource-group", resourceGroup, "--name", appService, "--output", "json"]);
  const appServiceState = runAz(["webapp", "show", "--resource-group", resourceGroup, "--name", appService, "--query", "{state:state,workers:siteConfig.numberOfWorkers}", "--output", "json"]);
  const n8nHosts = discoverN8nHosts(settings);
  const n8nPredicate = n8nHosts.map((host) => `(target_l contains '${escapeKusto(host)}' or data_l contains '${escapeKusto(host)}')`).join(" or ");
  const unknownHttpPredicate = "type_l == 'http' and not(target_l contains 'search.windows.net' or target_l contains 'openai.azure.com' or target_l contains 'blob.core.windows.net' or target_l contains 'login.microsoftonline.com' or target_l contains 'graph.microsoft.com' or target_l startswith '169.254.')";
  const query = `dependencies
| where timestamp >= datetime('${escapeKusto(observationStartedAt)}')
| extend target_l=tolower(tostring(target)), data_l=tolower(tostring(data)), type_l=tolower(tostring(type))
| summarize coverage_start=min(timestamp), coverage_end=max(timestamp), total_dependencies=count(), sampled_dependencies=countif(toint(itemCount) > 1), hour_buckets=dcount(bin(timestamp, 1h)), role_instances=dcount(cloud_RoleInstance), http_dependencies=countif(type_l == 'http'), unknown_http_dependencies=countif(${unknownHttpPredicate}), n8n_calls=countif(${n8nPredicate}), n8n_failures=countif((${n8nPredicate}) and success == false), postgres_calls=countif(type_l contains 'postgres' or target_l contains 'postgres'), search_calls=countif(target_l contains 'search.windows.net' or type_l contains 'azure ai search')`;
  const telemetry = firstRow(runAz(["monitor", "app-insights", "query", "--app", appInsightsAppId, "--offset", queryOffset, "--analytics-query", query, "--output", "json"]));
  const workflowActivity = await inspectN8nWorkflowActivity();
  const coverageHours = durationHours(observationStartedAt, telemetry.coverage_end);
  const coverageStartDelayHours = durationHours(observationStartedAt, telemetry.coverage_start);
  const ingestionLagHours = durationHours(telemetry.coverage_end, new Date().toISOString());
  const requiredHourBuckets = Math.floor(coverageHours) + 1;
  const hourBucketsComplete = Number(telemetry.hour_buckets || 0) >= requiredHourBuckets;
  const positiveControls = Number(telemetry.postgres_calls || 0) + Number(telemetry.search_calls || 0);
  const enoughCoverage = coverageHours >= minimumHours;
  const runtimeBoundary = {
    azure_native: appSetting(settings, "MEIDS_AGENT_RUNTIME") === "azure_native",
    shadow_disabled: appSetting(settings, "MEIDS_AGENT_SHADOW") === "disabled",
    fallback_disabled: appSetting(settings, "MEIDS_AGENT_AZURE_FALLBACK_TO_N8N") === "false",
  };
  const runtimeBoundaryHealthy = Object.values(runtimeBoundary).every(Boolean);
  const browserClean = browserBoundaryClean(n8nHosts);
  const configuredWorkers = Math.max(1, Number(appServiceState?.workers || 1));
  const verdict = evaluateN8nEgressReadiness({
    coverageHours,
    minimumHours,
    coverageStartDelayHours,
    ingestionLagHours,
    hourBuckets: Number(telemetry.hour_buckets || 0),
    requiredHourBuckets,
    httpDependencies: Number(telemetry.http_dependencies || 0),
    searchCalls: Number(telemetry.search_calls || 0),
    positiveControls,
    roleInstances: Number(telemetry.role_instances || 0),
    configuredWorkers,
    sampledDependencies: Number(telemetry.sampled_dependencies || 0),
    unknownHttpDependencies: Number(telemetry.unknown_http_dependencies || 0),
    workflowChecked: workflowActivity.checked,
    workflowInventoryComplete: workflowActivity.inventory_complete,
    runtimeBoundaryHealthy,
    browserClean,
    n8nCalls: Number(telemetry.n8n_calls || 0),
    n8nWorkflowExecutions: Number(workflowActivity.workflows_with_activity || 0),
  });
  const status = verdict.status;
  const sensorHealthy = !verdict.evidence_issues.some((issue) => [
    "coverage_started_late", "telemetry_stale", "hourly_coverage_gap", "missing_http_positive_control",
    "worker_instance_coverage_gap", "dependency_sampling_detected", "unknown_http_target_detected",
  ].includes(issue));
  const zeroN8n = verdict.zero_n8n_observed;
  const generatedAt = new Date();
  const artifact = {
    schema_version: "1.0.0",
    contract: "meids.n8n-egress-readiness.v1",
    generated_at: generatedAt.toISOString(),
    valid_until: new Date(generatedAt.getTime() + 2 * 3_600_000).toISOString(),
    status,
    evidence_issues: verdict.evidence_issues,
    required_observation_hours: minimumHours,
    observed_coverage_hours: coverageHours,
    observation_started_at: observationStartedAt,
    coverage: {
      query_status: "complete",
      start: telemetry.coverage_start || null,
      end: telemetry.coverage_end || null,
      query_offset: queryOffset,
      start_delay_hours: coverageStartDelayHours,
      ingestion_lag_hours: ingestionLagHours,
      observed_hour_buckets: Number(telemetry.hour_buckets || 0),
      required_hour_buckets: requiredHourBuckets,
      role_instances: Number(telemetry.role_instances || 0),
      configured_workers: configuredWorkers,
      sampled_dependencies: Number(telemetry.sampled_dependencies || 0),
    },
    target: { hosts: n8nHosts, calls: Number(telemetry.n8n_calls || 0), failures: Number(telemetry.n8n_failures || 0) },
    sensor_positive_control: {
      healthy: sensorHealthy,
      total_dependencies: Number(telemetry.total_dependencies || 0),
      http_dependencies: Number(telemetry.http_dependencies || 0),
      unknown_http_dependencies: Number(telemetry.unknown_http_dependencies || 0),
      postgres_calls: Number(telemetry.postgres_calls || 0),
      azure_search_calls: Number(telemetry.search_calls || 0),
    },
    n8n_workflow_activity_sensor: workflowActivity,
    runtime_boundary: runtimeBoundary,
    browser_endpoint_contract: { clean: browserClean },
    gates: {
      observation_window_complete: enoughCoverage,
      dependency_sensor_healthy: sensorHealthy,
      dependency_sampling_disabled: Number(telemetry.sampled_dependencies || 0) === 0,
      hourly_coverage_complete: hourBucketsComplete,
      zero_n8n_egress_observed: zeroN8n,
      n8n_workflow_inventory_checked: workflowActivity.checked,
      n8n_workflow_inventory_complete: workflowActivity.inventory_complete,
      runtime_boundary_healthy: runtimeBoundaryHealthy,
      browser_endpoint_contract_clean: browserClean,
    },
    boundary: "Public-safe dependency-telemetry evidence. It contains no credentials, request bodies, identity tokens, prompts, or private knowledge.",
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ status, observed_coverage_hours: coverageHours, required_observation_hours: minimumHours, n8n_calls: artifact.target.calls, n8n_workflows_with_activity: workflowActivity.workflows_with_activity, positive_control_calls: positiveControls, output: path.relative(root, outputPath).replaceAll("\\", "/") }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", error: error.message }, null, 2));
  process.exitCode = 1;
});
