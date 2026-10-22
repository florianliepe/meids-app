param(
  [Parameter(Mandatory = $true)]
  [string]$AppName,

  [Parameter(Mandatory = $true)]
  [string]$DatabaseHost,

  [Parameter(Mandatory = $true)]
  [string]$DatabaseUser,

  [string]$DatabaseName = "meids_prod",
  [string]$KeyVaultName = "kv-meids-prod-1853a19b",
  [string]$ResourceGroup = "rg-ai-intellectual-twin"
)

$ErrorActionPreference = "Stop"
$tempFile = Join-Path $env:TEMP ("meids-runtime-settings-" + [guid]::NewGuid().ToString("N") + ".json")

try {
  $settingsJson = @{
    POSTGRES_AUTH_MODE = "managed_identity"
    DATABASE_HOST = $DatabaseHost
    DATABASE_PORT = "5432"
    DATABASE_NAME = $DatabaseName
    DATABASE_USER = $DatabaseUser
    DATABASE_SSL = "true"
    MEIDS_STORAGE_MODE = "postgres"
    MEIDS_DATABASE_SCHEMA_MANAGED = "true"
    MEIDS_AUTHZ_DATABASE_ENABLED = "true"
    MEIDS_AUTHZ_JIT_ENABLED = "true"
    MEIDS_AUTH_ALLOWED_IDPS = "eraneos,aad"
    MEIDS_ENTRA_TENANT_ID = "213a6ca3-4808-4047-8aca-814d2cde4474"
    MEIDS_AUTHZ_OWNER_USER_IDS = "4277841b-d713-47b6-8168-172ac3cde535,5c3a147c-0a3b-4d85-bed9-d63653bb5d0d"
    MEIDS_AUTHZ_USER_GROUP_ID = "6d05aad5-e0ea-4bc5-84b0-003f43611079"
    MEIDS_AUTHZ_OWNER_GROUP_ID = "849d2888-ecd3-42e8-ad91-fd3178b83734"
    MEIDS_ENFORCE_KNOWLEDGE_AUTH = "true"
    MEIDS_AUTH_CONTEXT_SIGNING_KEY = "@Microsoft.KeyVault(VaultName=$KeyVaultName;SecretName=meids-auth-context-signing-key)"
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($tempFile, $settingsJson, (New-Object Text.UTF8Encoding($false)))

  az webapp config appsettings set `
    --resource-group $ResourceGroup `
    --name $AppName `
    --settings "@$tempFile" `
    --output none
  if ($LASTEXITCODE -ne 0) { throw "Could not configure production backend settings." }

  az webapp config appsettings delete `
    --resource-group $ResourceGroup `
    --name $AppName `
    --setting-names POSTGRES_ADMIN_HOST POSTGRES_ADMIN_USER POSTGRES_RUNTIME_PRINCIPAL_NAME POSTGRES_RUNTIME_PRINCIPAL_OBJECT_ID `
    --output none
  if ($LASTEXITCODE -ne 0) { throw "Could not remove bootstrap-only settings." }

  az webapp restart --resource-group $ResourceGroup --name $AppName --output none
  if ($LASTEXITCODE -ne 0) { throw "Could not restart the backend." }
} finally {
  Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
}

Write-Output "PRODUCTION_BACKEND_CONFIGURED"
