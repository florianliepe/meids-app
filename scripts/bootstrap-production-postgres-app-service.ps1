param(
  [Parameter(Mandatory = $true)]
  [string]$AppName,

  [Parameter(Mandatory = $true)]
  [string]$DatabaseHost,

  [Parameter(Mandatory = $true)]
  [string]$AdminPrincipalName,

  [Parameter(Mandatory = $true)]
  [string]$RuntimePrincipalName,

  [Parameter(Mandatory = $true)]
  [string]$RuntimePrincipalObjectId,

  [string]$DatabaseName = "meids_prod",
  [string]$ResourceGroup = "rg-ai-intellectual-twin"
)

$ErrorActionPreference = "Stop"
$tempFile = Join-Path $env:TEMP ("meids-pg-bootstrap-" + [guid]::NewGuid().ToString("N") + ".json")

try {
  $token = az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv
  if ($LASTEXITCODE -ne 0 -or -not $token) {
    throw "Could not acquire a PostgreSQL Entra access token."
  }

  $settingsJson = @{
    POSTGRES_ADMIN_HOST = $DatabaseHost
    POSTGRES_ADMIN_USER = $AdminPrincipalName
    POSTGRES_ADMIN_ACCESS_TOKEN = $token
    POSTGRES_RUNTIME_PRINCIPAL_NAME = $RuntimePrincipalName
    POSTGRES_RUNTIME_PRINCIPAL_OBJECT_ID = $RuntimePrincipalObjectId
    DATABASE_NAME = $DatabaseName
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($tempFile, $settingsJson, (New-Object Text.UTF8Encoding($false)))

  az webapp config appsettings set `
    --resource-group $ResourceGroup `
    --name $AppName `
    --settings "@$tempFile" `
    --output none
  if ($LASTEXITCODE -ne 0) { throw "Could not apply temporary bootstrap settings." }

  az webapp restart --resource-group $ResourceGroup --name $AppName --output none
  if ($LASTEXITCODE -ne 0) { throw "Could not restart App Service for bootstrap." }
  Start-Sleep -Seconds 20

  $credentials = az webapp deployment list-publishing-credentials `
    --resource-group $ResourceGroup `
    --name $AppName `
    --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "Could not acquire Kudu publishing credentials." }

  $pair = "{0}:{1}" -f $credentials.publishingUserName, $credentials.publishingPassword
  $authorization = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
  $headers = @{ Authorization = "Basic $authorization" }
  function Invoke-KuduCommand {
    param([Parameter(Mandatory = $true)][string]$Command)
    $body = @{
      command = $Command
      dir = "/home/site/wwwroot"
    } | ConvertTo-Json
    $result = Invoke-RestMethod `
      -Method Post `
      -Uri "https://$AppName.scm.azurewebsites.net/api/command" `
      -Headers $headers `
      -ContentType "application/json" `
      -Body $body `
      -TimeoutSec 180
    Write-Output "KUDU_COMMAND=$Command"
    Write-Output "KUDU_EXIT=$($result.ExitCode)"
    Write-Output $result.Output
    if ($result.Error) { Write-Output $result.Error }
    if ([int]$result.ExitCode -ne 0) { throw "Kudu command failed: $Command" }
  }

  Invoke-KuduCommand -Command "npm ci --omit=dev --loglevel=info"
  Invoke-KuduCommand -Command "npm run db:bootstrap:production"
  Write-Output "BOOTSTRAP_VERIFIED"
} finally {
  Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
  az webapp config appsettings delete `
    --resource-group $ResourceGroup `
    --name $AppName `
    --setting-names POSTGRES_ADMIN_ACCESS_TOKEN POSTGRES_ADMIN_HOST POSTGRES_ADMIN_USER POSTGRES_RUNTIME_PRINCIPAL_NAME POSTGRES_RUNTIME_PRINCIPAL_OBJECT_ID `
    --output none 2>$null
  Write-Output "TEMP_TOKEN_SETTING_REMOVED"
}
