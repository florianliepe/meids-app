param(
  [Parameter(Mandatory = $true)][string]$AppName,
  [Parameter(Mandatory = $true)][string]$DatabaseHost,
  [Parameter(Mandatory = $true)][string]$AdminPrincipalName,
  [Parameter(Mandatory = $true)][string]$EntraObjectId,
  [Parameter(Mandatory = $true)][string]$UserEmail,
  [string]$DatabaseName = "meids_prod",
  [string]$TenantId = "eraneos",
  [string]$TenantName = "Eraneos",
  [string]$UserId = "florian",
  [string]$UserDisplayName = "Florian Liepe",
  [string]$TwinIds = "florian,lucas",
  [string]$ResourceGroup = "rg-ai-intellectual-twin"
)

$ErrorActionPreference = "Stop"
$tempFile = Join-Path $env:TEMP ("meids-identity-seed-" + [guid]::NewGuid().ToString("N") + ".json")
$temporarySettings = @(
  "POSTGRES_ADMIN_ACCESS_TOKEN", "POSTGRES_ADMIN_HOST", "POSTGRES_ADMIN_USER",
  "MEIDS_SEED_TENANT_ID", "MEIDS_SEED_TENANT_NAME", "MEIDS_SEED_USER_ID",
  "MEIDS_SEED_ENTRA_OBJECT_ID", "MEIDS_SEED_USER_EMAIL",
  "MEIDS_SEED_USER_DISPLAY_NAME", "MEIDS_SEED_TWIN_IDS"
)

try {
  $token = az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv
  if ($LASTEXITCODE -ne 0 -or -not $token) { throw "Could not acquire a PostgreSQL Entra access token." }
  $settings = @{
    POSTGRES_ADMIN_ACCESS_TOKEN = $token
    POSTGRES_ADMIN_HOST = $DatabaseHost
    POSTGRES_ADMIN_USER = $AdminPrincipalName
    DATABASE_NAME = $DatabaseName
    MEIDS_SEED_TENANT_ID = $TenantId
    MEIDS_SEED_TENANT_NAME = $TenantName
    MEIDS_SEED_USER_ID = $UserId
    MEIDS_SEED_ENTRA_OBJECT_ID = $EntraObjectId
    MEIDS_SEED_USER_EMAIL = $UserEmail
    MEIDS_SEED_USER_DISPLAY_NAME = $UserDisplayName
    MEIDS_SEED_TWIN_IDS = $TwinIds
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($tempFile, $settings, (New-Object Text.UTF8Encoding($false)))
  az webapp config appsettings set --resource-group $ResourceGroup --name $AppName --settings "@$tempFile" --output none
  if ($LASTEXITCODE -ne 0) { throw "Could not apply temporary identity seed settings." }
  az webapp restart --resource-group $ResourceGroup --name $AppName --output none
  Start-Sleep -Seconds 20

  $credentials = az webapp deployment list-publishing-credentials --resource-group $ResourceGroup --name $AppName -o json | ConvertFrom-Json
  $pair = "{0}:{1}" -f $credentials.publishingUserName, $credentials.publishingPassword
  $authorization = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
  function Invoke-KuduCommand {
    param([Parameter(Mandatory = $true)][string]$Command)
    $body = @{ command = $Command; dir = "/home/site/wwwroot" } | ConvertTo-Json
    $result = Invoke-RestMethod -Method Post -Uri "https://$AppName.scm.azurewebsites.net/api/command" `
      -Headers @{ Authorization = "Basic $authorization" } -ContentType "application/json" -Body $body -TimeoutSec 180
    Write-Output "KUDU_COMMAND=$Command"
    Write-Output $result.Output
    if ($result.Error) { Write-Output $result.Error }
    if ([int]$result.ExitCode -ne 0) { throw "Kudu command failed: $Command" }
  }
  Invoke-KuduCommand -Command "npm ci --omit=dev"
  Invoke-KuduCommand -Command "npm run db:seed:production-identity"
} finally {
  Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
  az webapp config appsettings delete --resource-group $ResourceGroup --name $AppName `
    --setting-names @temporarySettings --output none 2>$null
}

Write-Output "PRODUCTION_IDENTITY_SEEDED"
