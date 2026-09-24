param(
  [Parameter(Mandatory = $true)]
  [string]$AppName,

  [string]$ResourceGroup = "rg-ai-intellectual-twin",
  [string]$Subscription = "25c9ce59-90a1-4e8a-a2d4-1853a19bce22",
  [string]$Location = "westeurope",
  [string]$PlanName = "asp-meids-backend",
  [string]$Sku = "B1",
  [string]$Runtime = "NODE|22-lts",
  [string]$HealthUrl = "",
  [switch]$CreateIfMissing,
  [switch]$ApplySecretSettings
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required. Install Azure CLI or use the GitHub Actions App Service deployment workflow."
  }
}

function Resolve-AzCommand {
  $command = Get-Command "az" -ErrorAction SilentlyContinue
  if ($command) {
    return @{
      executable = $command.Source
      prefix = @()
    }
  }

  $bundledPython = "C:\Program Files\Microsoft SDKs\Azure\CLI2\python.exe"
  if (Test-Path $bundledPython) {
    return @{
      executable = $bundledPython
      prefix = @("-m", "azure.cli")
    }
  }

  $standardWindowsPath = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
  if (Test-Path $standardWindowsPath) {
    return @{
      executable = $standardWindowsPath
      prefix = @()
    }
  }

  throw "az is required. Install Azure CLI or use the GitHub Actions App Service deployment workflow."
}

$AzCommand = Resolve-AzCommand

function Run-Az {
  param([string[]]$Arguments)
  $safeArguments = if ($AzCommand.executable -like "*.cmd") {
    $Arguments | ForEach-Object { $_ -replace "\|", "^|" }
  } else {
    $Arguments
  }
  & $AzCommand.executable @($AzCommand.prefix + $safeArguments)
  if ($LASTEXITCODE -ne 0) {
    throw "az $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

Require-Command "npm"

Run-Az @("account", "set", "--subscription", $Subscription)

$appExists = $true
try {
  Run-Az @("webapp", "show", "--resource-group", $ResourceGroup, "--name", $AppName, "--query", "defaultHostName", "-o", "tsv")
} catch {
  $appExists = $false
}

if (-not $appExists) {
  if (-not $CreateIfMissing) {
    throw "App Service '$AppName' was not found in '$ResourceGroup'. Re-run with -CreateIfMissing to create it."
  }

  $planExists = $true
  try {
    Run-Az @("appservice", "plan", "show", "--resource-group", $ResourceGroup, "--name", $PlanName, "--query", "name", "-o", "tsv")
  } catch {
    $planExists = $false
  }

  if (-not $planExists) {
    Run-Az @("appservice", "plan", "create", "--resource-group", $ResourceGroup, "--name", $PlanName, "--location", $Location, "--sku", $Sku, "--is-linux")
  }

  Run-Az @("webapp", "create", "--resource-group", $ResourceGroup, "--plan", $PlanName, "--name", $AppName, "--runtime", $Runtime)
}

Run-Az @("webapp", "config", "set", "--resource-group", $ResourceGroup, "--name", $AppName, "--startup-file", "npm start")

$settings = @(
  "NODE_ENV=production",
  "PORT=8080",
  "ALLOWED_FRONTEND_ORIGINS=https://florianliepe.github.io,https://victorious-flower-0f10a8303.6.azurestaticapps.net,https://intellectual-twin.eraneos.com",
  "N8N_ACTOR_TWIN_WEBHOOK_URL=https://eraneos-agentic-platform.azurewebsites.net/webhook/b4afb251-2ad1-43da-9d7c-6f6473fbd3db/chat",
  "N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL=https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/knowledge-fabric/ingest",
  "N8N_AGENTIC_BUTLER_WEBHOOK_URL=https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/agentic-butler/run",
  "N8N_API_BASE_URL=https://eraneos-agentic-platform.azurewebsites.net",
  "AZURE_SEARCH_APPROVED_INDEX=meids-okf-approved-v1",
  "AZURE_SEARCH_WORKING_INDEX=meids-okf-working-v1",
  "AZURE_SEARCH_API_VERSION=2025-09-01",
  "AZURE_OPENAI_API_VERSION=2024-02-01",
  "AZURE_OPENAI_EMBEDDING_DIMENSIONS=1536"
)

if ($ApplySecretSettings) {
  $existingSettingsJson = & $AzCommand.executable @($AzCommand.prefix + @(
    "webapp", "config", "appsettings", "list", "--resource-group", $ResourceGroup,
    "--name", $AppName, "--output", "json"
  ))
  if ($LASTEXITCODE -ne 0) {
    throw "Could not read existing App Service settings before applying secret settings."
  }
  $existingSettings = $existingSettingsJson | ConvertFrom-Json
  $secretEnvNames = @(
    "N8N_API_KEY",
    "N8N_WEBHOOK_AUTH_TOKEN",
    "MEIDS_STORAGE_MODE",
    "DATABASE_URL",
    "DATABASE_SSL",
    "AZURE_SEARCH_ENDPOINT",
    "AZURE_SEARCH_API_KEY",
    "AZURE_OPENAI_ENDPOINT",
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_EMBEDDING_DEPLOYMENT",
    "MEIDS_ALLOW_DETERMINISTIC_VECTORS",
    "ERANEOS_AI_GATEWAY_BASE_URL",
    "ERANEOS_AI_GATEWAY_API_KEY",
    "ERANEOS_AI_GATEWAY_TRANSCRIPTION_MODEL",
    "OPENAI_API_KEY"
  )

  foreach ($name in $secretEnvNames) {
    $existing = $existingSettings | Where-Object { $_.name -eq $name } | Select-Object -First 1
    if ($existing.value -like "@Microsoft.KeyVault(*)") {
      Write-Host "Preserving Key Vault reference for $name"
      continue
    }
    $value = [Environment]::GetEnvironmentVariable($name, "Process")
    if ($value) {
      $settings += "$name=$value"
    }
  }
}

$appSettingArgs = @("webapp", "config", "appsettings", "set", "--resource-group", $ResourceGroup, "--name", $AppName, "--settings") + $settings
& $AzCommand.executable @($AzCommand.prefix + $appSettingArgs + @("--query", "[].name", "--output", "tsv"))
if ($LASTEXITCODE -ne 0) {
  throw "Could not update App Service settings."
}

npm ci --omit=dev
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

$packageDir = Join-Path $PWD "deploy-package"
$zipPath = Join-Path $PWD "meids-backend.zip"
Remove-Item -Recurse -Force $packageDir -ErrorAction SilentlyContinue
Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $packageDir | Out-Null
Copy-Item -Recurse -Path "backend" -Destination $packageDir
Copy-Item -Path "package.json", "package-lock.json" -Destination $packageDir
Push-Location $packageDir
npm ci --omit=dev
if ($LASTEXITCODE -ne 0) { throw "deploy package npm ci failed" }
Compress-Archive -Path "*" -DestinationPath $zipPath -Force
Pop-Location

Run-Az @("webapp", "deploy", "--resource-group", $ResourceGroup, "--name", $AppName, "--src-path", $zipPath, "--type", "zip")

$backendUrl = "https://$AppName.azurewebsites.net"
$healthEndpoint = if ($HealthUrl) { $HealthUrl } else { "$backendUrl/api/health" }
$health = Invoke-RestMethod -Uri $healthEndpoint -Method Get -TimeoutSec 60

@{
  status = "deployed"
  meids_backend_url = $backendUrl
  health_url = $healthEndpoint
  health = $health
  next_command = "`$env:MEIDS_BACKEND_URL=`"$backendUrl`"; npm run n8n:scoring:publish-real"
} | ConvertTo-Json -Depth 12
