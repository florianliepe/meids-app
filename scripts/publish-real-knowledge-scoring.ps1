param(
  [string]$BackendUrl = $env:MEIDS_BACKEND_URL
)

$ErrorActionPreference = "Stop"

if (-not $BackendUrl) {
  Write-Error "MEIDS_BACKEND_URL or -BackendUrl is required."
}

$BackendUrl = $BackendUrl.TrimEnd("/")
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

Write-Output "Verifying backend: $BackendUrl"
$health = Invoke-RestMethod -Uri "$BackendUrl/api/health" -Method Get -TimeoutSec 30
$duplicateBody = @{
  candidate = @{
    title = "Real duplicate scoring publish probe"
    purpose = "Verify hosted backend duplicate-check endpoint before n8n publish."
    text = "No-write probe for Knowledge Fabric duplicate scoring."
  }
  twin_id = "florian"
  organization_id = "default"
  source_policy = "selected_pending"
} | ConvertTo-Json -Depth 20
$duplicate = Invoke-RestMethod `
  -Uri "$BackendUrl/api/knowledge/duplicate-check" `
  -Method Post `
  -ContentType "application/json" `
  -Body $duplicateBody `
  -TimeoutSec 60

$env:MEIDS_BACKEND_URL = $BackendUrl
npm run n8n:boundaries:apply -- --local-only

$base = [Environment]::GetEnvironmentVariable("N8N_API_BASE_URL", "User")
$key = [Environment]::GetEnvironmentVariable("N8N_API_KEY", "User")
if (-not $base -or -not $key) {
  Write-Error "N8N_API_BASE_URL and N8N_API_KEY must be persisted as user environment variables."
}
$base = $base.TrimEnd("/")
$headers = @{
  "X-N8N-API-KEY" = $key
  "Accept" = "application/json"
  "Content-Type" = "application/json"
}

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$out = Join-Path $Root "exports/n8n-live-backups/$stamp-real-knowledge-scoring"
New-Item -ItemType Directory -Force -Path $out | Out-Null

$items = @(
  @{
    id = if ([Environment]::GetEnvironmentVariable("N8N_LEARNING_AGENT_WORKFLOW_ID", "User")) { [Environment]::GetEnvironmentVariable("N8N_LEARNING_AGENT_WORKFLOW_ID", "User") } else { "zX0s3hOByJ4HWQye" }
    label = "learning-agent"
    local = "workflows/n8n/learning-agent.workflow.json"
  },
  @{
    id = if ([Environment]::GetEnvironmentVariable("N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID", "User")) { [Environment]::GetEnvironmentVariable("N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID", "User") } else { "oPs77Qzrg9Repzgp" }
    label = "knowledge-fabric"
    local = "workflows/n8n/knowledge-fabric-agent.workflow.json"
  }
)

$summary = @()
foreach ($item in $items) {
  $before = Invoke-RestMethod -Uri "$base/api/v1/workflows/$($item.id)" -Headers $headers -Method Get -TimeoutSec 30
  $before | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 -Path (Join-Path $out "$($item.label).live-before.json")

  $local = Get-Content -Raw -Path $item.local | ConvertFrom-Json
  $payload = [ordered]@{
    name = $before.name
    nodes = $local.nodes
    connections = $local.connections
    settings = $before.settings
    staticData = $before.staticData
  }
  $payload | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 -Path (Join-Path $out "$($item.label).update-payload.json")

  $updated = Invoke-RestMethod `
    -Uri "$base/api/v1/workflows/$($item.id)" `
    -Headers $headers `
    -Method Put `
    -Body ($payload | ConvertTo-Json -Depth 100) `
    -TimeoutSec 60
  $updated | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 -Path (Join-Path $out "$($item.label).live-after.json")
  $summary += [ordered]@{
    id = $item.id
    label = $item.label
    name = $updated.name
    active = $updated.active
  }
}

$workflow = Get-Content -Raw -Path "workflows/n8n/knowledge-fabric-agent.workflow.json" | ConvertFrom-Json
$scoreNode = $workflow.nodes | Where-Object { $_.name -eq "Score duplicate and merge evidence" } | Select-Object -First 1
if (-not $scoreNode -or $scoreNode.type -ne "n8n-nodes-base.httpRequest") {
  Write-Error "Knowledge Fabric scoring node is not HTTP-backed after publish."
}

$result = [ordered]@{
  status = "real_scoring_published"
  backend_url = $BackendUrl
  backend_health_status = $health.status
  backend_duplicate_provider = $duplicate.provider
  backend_duplicate_status = $duplicate.duplicate_check.status
  backup = (($out.Substring($Root.Path.Length + 1)) -replace "\\", "/")
  workflows = $summary
  scoring_node = [ordered]@{
    name = $scoreNode.name
    type = $scoreNode.type
    url = $scoreNode.parameters.url
  }
}

$result | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 -Path (Join-Path $out "summary.json")
$result | ConvertTo-Json -Depth 20
