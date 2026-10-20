[CmdletBinding()]
param(
  [string] $SubscriptionId = '25c9ce59-90a1-4e8a-a2d4-1853a19bce22',
  [string] $ResourceGroup = 'rg-ai-intellectual-twin',
  [string] $BackendAppName = 'meids-prod-backend-1853a19b',
  [string] $StorageAccountName = 'stmeidsprod1853a19b',
  [string] $SearchServiceName = 'srch-meids-prod-1853a19b',
  [string] $LegacySearchServiceName = 'srch-intellectual-twin',
  [string] $PostgresServerName = 'psql-meids-prod-1853a19b',
  [string] $GitHubRepository = 'florianliepe/meids-app',
  [string] $OutputPath = '',
  [switch] $Strict
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-AzJson {
  param([Parameter(Mandatory = $true)][string[]] $Arguments)
  $raw = & az @Arguments --output json
  if ($LASTEXITCODE -ne 0) { throw "Azure CLI failed: az $($Arguments -join ' ')" }
  if ([string]::IsNullOrWhiteSpace(($raw -join "`n"))) { return $null }
  return ($raw -join "`n") | ConvertFrom-Json
}

function New-Gate {
  param(
    [Parameter(Mandatory = $true)][string] $Name,
    [Parameter(Mandatory = $true)][ValidateSet('pass', 'blocked', 'human_required', 'unknown')][string] $State,
    [Parameter(Mandatory = $true)][string] $Evidence
  )
  return [ordered]@{ name = $Name; state = $State; evidence = $Evidence }
}

az account set --subscription $SubscriptionId
if ($LASTEXITCODE -ne 0) { throw 'Unable to select the Azure subscription.' }

$backend = Invoke-AzJson @('webapp', 'show', '--resource-group', $ResourceGroup, '--name', $BackendAppName, '--query', '{state:state,host:defaultHostName,httpsOnly:httpsOnly,identity:identity.principalId}')
$settings = Invoke-AzJson @('webapp', 'config', 'appsettings', 'list', '--resource-group', $ResourceGroup, '--name', $BackendAppName, '--query', "[?starts_with(name, 'AZURE_OPENAI_')].{name:name,configured:length(value) > ``0``}")
$storage = Invoke-AzJson @('storage', 'account', 'show', '--resource-group', $ResourceGroup, '--name', $StorageAccountName, '--query', '{publicNetworkAccess:publicNetworkAccess,defaultAction:networkRuleSet.defaultAction,allowSharedKeyAccess:allowSharedKeyAccess}')
$search = Invoke-AzJson @('search', 'service', 'show', '--resource-group', $ResourceGroup, '--name', $SearchServiceName, '--query', '{status:status,provisioningState:provisioningState,publicNetworkAccess:publicNetworkAccess,disableLocalAuth:disableLocalAuth}')
$legacySearch = Invoke-AzJson @('search', 'service', 'show', '--resource-group', $ResourceGroup, '--name', $LegacySearchServiceName, '--query', '{status:status,provisioningState:provisioningState,publicNetworkAccess:publicNetworkAccess}')
$postgres = Invoke-AzJson @('postgres', 'flexible-server', 'show', '--resource-group', $ResourceGroup, '--name', $PostgresServerName, '--query', '{state:state,publicNetworkAccess:network.publicNetworkAccess,haMode:highAvailability.mode,standbyZone:highAvailability.standbyAvailabilityZone,backupRetentionDays:backup.backupRetentionDays,geoRedundantBackup:backup.geoRedundantBackup}')
$openAiAccounts = Invoke-AzJson @('cognitiveservices', 'account', 'list', '--query', "[?kind=='OpenAI' || kind=='AIServices'].{name:name,kind:kind,location:location,resourceGroup:resourceGroup}")

$settingMap = @{}
foreach ($setting in @($settings)) { $settingMap[$setting.name] = [bool]$setting.configured }
$embeddingEndpointConfigured = [bool]$settingMap['AZURE_OPENAI_ENDPOINT']
$embeddingDeploymentConfigured = [bool]$settingMap['AZURE_OPENAI_EMBEDDING_DEPLOYMENT']
$embeddingAuthConfigured = [bool]$settingMap['AZURE_OPENAI_AUTH_MODE']
$embeddingDimensionsConfigured = [bool]$settingMap['AZURE_OPENAI_EMBEDDING_DIMENSIONS']
$embeddingReady = $embeddingEndpointConfigured -and $embeddingDeploymentConfigured -and $embeddingAuthConfigured -and $embeddingDimensionsConfigured

$gates = @(
  New-Gate 'Backend App Service' $(if ($backend.state -eq 'Running' -and $backend.httpsOnly) { 'pass' } else { 'blocked' }) "state=$($backend.state); httpsOnly=$($backend.httpsOnly); managedIdentity=$(-not [string]::IsNullOrWhiteSpace($backend.identity))"
  New-Gate 'Production Storage private boundary' $(if ($storage.publicNetworkAccess -eq 'Disabled' -and $storage.defaultAction -eq 'Deny' -and $storage.allowSharedKeyAccess -eq $false) { 'pass' } else { 'blocked' }) "publicNetworkAccess=$($storage.publicNetworkAccess); defaultAction=$($storage.defaultAction); sharedKey=$($storage.allowSharedKeyAccess)"
  New-Gate 'Production Search private boundary' $(if ($search.publicNetworkAccess -eq 'Disabled' -and $search.status -eq 'running' -and $search.provisioningState -eq 'succeeded') { 'pass' } else { 'blocked' }) "status=$($search.status); provisioning=$($search.provisioningState); publicNetworkAccess=$($search.publicNetworkAccess); localAuthDisabled=$($search.disableLocalAuth)"
  New-Gate 'Legacy Search public closure' $(if ($legacySearch.publicNetworkAccess -eq 'Disabled') { 'pass' } else { 'blocked' }) "publicNetworkAccess=$($legacySearch.publicNetworkAccess)"
  New-Gate 'PostgreSQL service' $(if ($postgres.state -eq 'Ready' -and $postgres.publicNetworkAccess -eq 'Disabled' -and $postgres.haMode -eq 'SameZone' -and $postgres.backupRetentionDays -eq 35 -and $postgres.geoRedundantBackup -eq 'Enabled') { 'pass' } else { 'blocked' }) "state=$($postgres.state); publicNetworkAccess=$($postgres.publicNetworkAccess); ha=$($postgres.haMode); standbyZone=$($postgres.standbyZone); retentionDays=$($postgres.backupRetentionDays); geoBackup=$($postgres.geoRedundantBackup)"
  New-Gate 'Zone-redundant PostgreSQL HA' 'human_required' 'West Europe currently reports ZoneRedundantHa unavailable; risk-owner sign-off is required for SameZone launch.'
  New-Gate 'Production semantic embeddings' $(if ($embeddingReady -and @($openAiAccounts).Count -gt 0) { 'pass' } else { 'human_required' }) "azureOpenAiAccounts=$(@($openAiAccounts).Count); endpointConfigured=$embeddingEndpointConfigured; deploymentConfigured=$embeddingDeploymentConfigured; authModeConfigured=$embeddingAuthConfigured; dimensionsConfigured=$embeddingDimensionsConfigured"
)

$n8n = @()
if (-not [string]::IsNullOrWhiteSpace($env:N8N_API_KEY) -and -not [string]::IsNullOrWhiteSpace($env:N8N_API_BASE_URL)) {
  $base = $env:N8N_API_BASE_URL.TrimEnd('/')
  if ($base -notmatch '/api/v1$') { $base = "$base/api/v1" }
  $headers = @{ 'X-N8N-API-KEY' = $env:N8N_API_KEY }
  $workflowIds = @(
    [ordered]@{ role = 'actor_twin'; id = $env:N8N_ACTOR_TWIN_WORKFLOW_ID },
    [ordered]@{ role = 'knowledge_fabric'; id = $env:N8N_KNOWLEDGE_FABRIC_WORKFLOW_ID },
    [ordered]@{ role = 'agentic_butler'; id = $env:N8N_AGENTIC_BUTLER_WORKFLOW_ID }
  )
  foreach ($workflow in $workflowIds) {
    $item = Invoke-RestMethod -Uri "$base/workflows/$($workflow.id)" -Headers $headers -Method Get -TimeoutSec 30
    $n8n += [ordered]@{ role = $workflow.role; id = $item.id; name = $item.name; active = [bool]$item.active; updatedAt = $item.updatedAt; nodes = @($item.nodes).Count }
  }
  $allActive = @($n8n | Where-Object { -not $_.active }).Count -eq 0
  $gates += New-Gate 'Published n8n primary workflows' $(if ($allActive) { 'pass' } else { 'blocked' }) "active=$(@($n8n | Where-Object active).Count)/$($n8n.Count)"
} else {
  $gates += New-Gate 'Published n8n primary workflows' 'unknown' 'N8N_API_KEY or N8N_API_BASE_URL is unavailable to this process.'
}

$runs = @()
if (Get-Command gh -ErrorAction SilentlyContinue) {
  $rawRuns = gh run list --repo $GitHubRepository --branch main --limit 20 --json databaseId,workflowName,status,conclusion,headSha,url,createdAt
  if ($LASTEXITCODE -eq 0) {
    $allRuns = $rawRuns | ConvertFrom-Json
    foreach ($workflowName in @('Deploy Me.IDs backend to Azure App Service', 'Deploy Me.IDs frontend to Azure Static Web Apps', 'Deploy MeIDs frontend to GitHub Pages')) {
      $latest = @($allRuns | Where-Object workflowName -eq $workflowName | Select-Object -First 1)
      if ($latest.Count -gt 0) { $runs += $latest[0] }
    }
    $deploymentsPass = $runs.Count -eq 3 -and @($runs | Where-Object conclusion -ne 'success').Count -eq 0
    $gates += New-Gate 'GitHub deployment workflows' $(if ($deploymentsPass) { 'pass' } else { 'blocked' }) "successful=$(@($runs | Where-Object conclusion -eq 'success').Count)/3"
  }
}

$gates += New-Gate 'Authenticated Knowledge Fabric chat UAT' 'human_required' 'Requires approval to create one persisted review_needed test concept.'
$gates += New-Gate 'Agentic Butler credential and skill UAT' 'human_required' 'Rotate the expired n8n LLM gateway credential, then test normal and new-skill routes.'
$gates += New-Gate 'Knowledge retention governance' 'human_required' 'Legal/Records, Security, and the data owner must approve the retention template.'

$summary = [ordered]@{
  pass = @($gates | Where-Object state -eq 'pass').Count
  blocked = @($gates | Where-Object state -eq 'blocked').Count
  human_required = @($gates | Where-Object state -eq 'human_required').Count
  unknown = @($gates | Where-Object state -eq 'unknown').Count
}
$report = [ordered]@{
  schema = 'meids.public-launch-readiness.v1'
  generated_at = (Get-Date).ToUniversalTime().ToString('o')
  subscription_id = $SubscriptionId
  resource_group = $ResourceGroup
  summary = $summary
  gates = $gates
  n8n_workflows = $n8n
  deployment_runs = $runs
}
$json = $report | ConvertTo-Json -Depth 12

if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
  $parent = Split-Path -Parent $OutputPath
  if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  [System.IO.File]::WriteAllText((Join-Path (Get-Location) $OutputPath), "$json`n", [System.Text.UTF8Encoding]::new($false))
}
$json

if ($Strict -and ($summary.blocked -gt 0 -or $summary.human_required -gt 0 -or $summary.unknown -gt 0)) { exit 2 }
