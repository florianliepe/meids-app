[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$SubscriptionId = '25c9ce59-90a1-4e8a-a2d4-1853a19bce22',
  [string]$ResourceGroup = 'rg-ai-intellectual-twin',
  [string]$StaticWebAppName = 'intellectual-twin',
  [string]$KeyVaultName = 'kv-meids-prod-1853a19b',
  [string]$ClientIdSecretName = 'Client-Entra-ID',
  [string]$ClientSecretSecretName = 'Entra-Client-ID-Sectret-Value',
  [string]$TenantIdSecretName = 'tenant-ID',
  [string]$ProductionHost = 'victorious-flower-0f10a8303.6.azurestaticapps.net',
  [string]$ProviderName = 'eraneos'
)

$ErrorActionPreference = 'Stop'

az account set --subscription $SubscriptionId
if ($LASTEXITCODE -ne 0) { throw 'Unable to select the Me.IDs Azure subscription.' }

$tenantId = az keyvault secret show --vault-name $KeyVaultName --name $TenantIdSecretName --query value -o tsv
$clientId = az keyvault secret show --vault-name $KeyVaultName --name $ClientIdSecretName --query value -o tsv
if ($LASTEXITCODE -ne 0 -or -not $tenantId -or -not $clientId) {
  throw 'Unable to read the Entra tenant or client ID from Key Vault.'
}

$staticWebAppId = az staticwebapp show --name $StaticWebAppName --resource-group $ResourceGroup --query id -o tsv
$identityPatch = Join-Path $PSScriptRoot '..\infra\azure\swa-system-identity.patch.json'
$identity = az rest `
  --method PATCH `
  --url "https://management.azure.com$($staticWebAppId)?api-version=2023-12-01" `
  --headers 'Content-Type=application/json' `
  --body "@$identityPatch" `
  --query identity `
  -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $identity.principalId) {
  throw 'Unable to enable the Static Web App system-assigned identity.'
}

$vaultId = az keyvault show --name $KeyVaultName --query id -o tsv
$roleAssignment = az role assignment list `
  --assignee-object-id $identity.principalId `
  --scope $vaultId `
  --role 'Key Vault Secrets User' `
  --query '[0].id' -o tsv
if (-not $roleAssignment -and $PSCmdlet.ShouldProcess($StaticWebAppName, "Grant Key Vault Secrets User on $KeyVaultName")) {
  az role assignment create `
    --assignee-object-id $identity.principalId `
    --assignee-principal-type ServicePrincipal `
    --scope $vaultId `
    --role 'Key Vault Secrets User' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to grant Key Vault Secrets User to the Static Web App identity.' }
}

$appSettingsBody = Join-Path $PSScriptRoot '..\infra\azure\swa-entra-keyvault-appsettings.json'
if ($PSCmdlet.ShouldProcess($StaticWebAppName, 'Configure Entra application settings as Key Vault references')) {
  az rest `
    --method PUT `
    --url "https://management.azure.com$($staticWebAppId)/config/appsettings?api-version=2023-12-01" `
    --headers 'Content-Type=application/json' `
    --body "@$appSettingsBody" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to configure Static Web App application settings.' }
}

$app = az ad app show --id $clientId -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $app.id) { throw 'The Key Vault client ID does not resolve to an Entra app registration.' }
$requiredRedirects = @(
  "https://$ProductionHost/.auth/login/$ProviderName/callback"
)
$missingRedirects = @($requiredRedirects | Where-Object { $_ -notin @($app.web.redirectUris) })
$redirects = @($app.web.redirectUris) + $missingRedirects | Sort-Object -Unique
if ($missingRedirects.Count -gt 0 -and $PSCmdlet.ShouldProcess($app.displayName, 'Add Azure Static Web Apps authentication callback URIs')) {
  az ad app update --id $clientId --web-redirect-uris $redirects
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to update redirect URIs. An owner of the Entra app registration must add the aad callback URIs.'
  }
}

[pscustomobject]@{
  status = 'configured'
  static_web_app = $StaticWebAppName
  managed_identity_principal_id = $identity.principalId
  key_vault = $KeyVaultName
  tenant_id_matches_subscription = ($tenantId -eq (az account show --query tenantId -o tsv))
  client_id = $clientId
  redirect_uris = $requiredRedirects
  future_custom_domain_callback = "https://intellectual-twin.eraneos.com/.auth/login/$ProviderName/callback"
  secret_values_emitted = $false
} | ConvertTo-Json -Depth 4
