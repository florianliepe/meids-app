[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$TenantId = '213a6ca3-4808-4047-8aca-814d2cde4474',
  [string]$ApplicationName = 'Me.IDs Production',
  [string]$ResourceGroup = 'rg-ai-intellectual-twin',
  [string]$StaticWebAppName = 'intellectual-twin',
  [string]$StaticWebAppHost = 'victorious-flower-0f10a8303.6.azurestaticapps.net',
  [switch]$ConfigureStaticWebApp
)

$ErrorActionPreference = 'Stop'

$employeeGroupId = '2ba08970-e4a4-4152-9985-1f8283ff7688'
$usersGroupId = '6d05aad5-e0ea-4bc5-84b0-003f43611079'
$ownersGroupId = '849d2888-ecd3-42e8-ad91-fd3178b83734'
$applicationOwnerIds = @(
  '4277841b-d713-47b6-8168-172ac3cde535',
  '5c3a147c-0a3b-4d85-bed9-d63653bb5d0d'
)

$roles = @(
  [ordered]@{
    allowedMemberTypes = @('User')
    description = 'Active Eraneos employees admitted through the governed workforce group.'
    displayName = 'Me.IDs Employee'
    id = '97dbd17a-e6a7-43b6-8dc7-40de6b3cbfde'
    isEnabled = $true
    value = 'MeIDs.Employee'
  },
  [ordered]@{
    allowedMemberTypes = @('User')
    description = 'Approved Me.IDs users, including accepted B2B guests.'
    displayName = 'Me.IDs User'
    id = '5747f70d-9763-4b6f-b695-314a2ced9872'
    isEnabled = $true
    value = 'MeIDs.User'
  },
  [ordered]@{
    allowedMemberTypes = @('User')
    description = 'Privileged Me.IDs application owners.'
    displayName = 'Me.IDs Owner'
    id = '29189dc9-8f5d-43ab-a26b-56b66dfd422c'
    isEnabled = $true
    value = 'MeIDs.Owner'
  }
)

function Invoke-GraphJson {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST', 'PATCH')][string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [object]$Body
  )

  $bodyFile = $null
  try {
    $arguments = @('rest', '--method', $Method, '--uri', $Uri, '--output', 'json')
    if ($null -ne $Body) {
      $bodyFile = Join-Path ([System.IO.Path]::GetTempPath()) "meids-graph-$([guid]::NewGuid()).json"
      [System.IO.File]::WriteAllText($bodyFile, ($Body | ConvertTo-Json -Depth 12 -Compress))
      $arguments += @('--headers', 'Content-Type=application/json', '--body', "@$bodyFile")
    }
    $output = & az @arguments
    if ($LASTEXITCODE -ne 0) { throw "Microsoft Graph request failed: $Method $Uri" }
    if ([string]::IsNullOrWhiteSpace(($output -join "`n"))) { return $null }
    return (($output -join "`n") | ConvertFrom-Json)
  } finally {
    if ($bodyFile -and (Test-Path -LiteralPath $bodyFile)) {
      Remove-Item -LiteralPath $bodyFile -Force
    }
  }
}

az account set --subscription '25c9ce59-90a1-4e8a-a2d4-1853a19bce22'
if ($LASTEXITCODE -ne 0) { throw 'Unable to select the Me.IDs Azure subscription.' }

$app = az ad app list --display-name $ApplicationName --query '[0]' -o json | ConvertFrom-Json
if (-not $app) {
  if (-not $PSCmdlet.ShouldProcess($ApplicationName, 'Create single-tenant application registration')) { return }
  $redirectUri = "https://$StaticWebAppHost/.auth/login/aad/callback"
  $app = az ad app create `
    --display-name $ApplicationName `
    --sign-in-audience AzureADMyOrg `
    --web-redirect-uris $redirectUri `
    -o json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $app.id -or -not $app.appId) {
    throw 'Application registration failed. Request the Entra Cloud Application Administrator role or ask an administrator to run this script.'
  }
}

Invoke-GraphJson -Method PATCH -Uri "https://graph.microsoft.com/v1.0/applications/$($app.id)" -Body ([ordered]@{
  appRoles = $roles
  groupMembershipClaims = 'SecurityGroup'
  web = [ordered]@{ redirectUris = @("https://$StaticWebAppHost/.auth/login/aad/callback") }
}) | Out-Null

$servicePrincipal = az ad sp show --id $app.appId -o json 2>$null | ConvertFrom-Json
if (-not $servicePrincipal) {
  $servicePrincipal = az ad sp create --id $app.appId -o json | ConvertFrom-Json
}
Invoke-GraphJson -Method PATCH -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$($servicePrincipal.id)" -Body @{ appRoleAssignmentRequired = $true } | Out-Null

$owners = Invoke-GraphJson -Method GET -Uri "https://graph.microsoft.com/v1.0/applications/$($app.id)/owners?`$select=id"
$existingOwnerIds = @($owners.value | ForEach-Object { $_.id })
foreach ($ownerId in $applicationOwnerIds) {
  if ($existingOwnerIds -contains $ownerId) { continue }
  Invoke-GraphJson -Method POST -Uri "https://graph.microsoft.com/v1.0/applications/$($app.id)/owners/`$ref" -Body @{
    '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$ownerId"
  } | Out-Null
}

$assignments = @(
  @{ groupId = $employeeGroupId; roleId = $roles[0].id },
  @{ groupId = $usersGroupId; roleId = $roles[1].id },
  @{ groupId = $ownersGroupId; roleId = $roles[2].id }
)
$currentAssignments = Invoke-GraphJson -Method GET -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$($servicePrincipal.id)/appRoleAssignedTo?`$select=principalId,appRoleId"
foreach ($assignment in $assignments) {
  $exists = @($currentAssignments.value | Where-Object {
    $_.principalId -eq $assignment.groupId -and $_.appRoleId -eq $assignment.roleId
  }).Count -gt 0
  if ($exists) { continue }
  Invoke-GraphJson -Method POST -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$($servicePrincipal.id)/appRoleAssignedTo" -Body @{
    principalId = $assignment.groupId
    resourceId = $servicePrincipal.id
    appRoleId = $assignment.roleId
  } | Out-Null
}

if ($ConfigureStaticWebApp) {
  $password = Invoke-GraphJson -Method POST -Uri "https://graph.microsoft.com/v1.0/applications/$($app.id)/addPassword" -Body @{
    passwordCredential = @{
      displayName = "Me.IDs Static Web App $(Get-Date -Format yyyy-MM-dd)"
      endDateTime = (Get-Date).ToUniversalTime().AddMonths(12).ToString('o')
    }
  }
  if (-not $password.secretText) { throw 'Microsoft Graph did not return a client secret.' }
  az staticwebapp appsettings set `
    --name $StaticWebAppName `
    --resource-group $ResourceGroup `
    --setting-names "AZURE_CLIENT_ID=$($app.appId)" "AZURE_CLIENT_SECRET=$($password.secretText)" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to write the Static Web App authentication settings.' }
}

[pscustomobject]@{
  status = 'configured'
  tenant_id = $TenantId
  application_name = $ApplicationName
  application_object_id = $app.id
  client_id = $app.appId
  service_principal_id = $servicePrincipal.id
  assignment_required = $true
  employee_group_id = $employeeGroupId
  guest_user_group_id = $usersGroupId
  owner_group_id = $ownersGroupId
  static_web_app_settings_configured = [bool]$ConfigureStaticWebApp
  next_step = 'Enable the custom single-tenant provider in staticwebapp.config.json, deploy, then run employee and B2B guest UAT.'
} | ConvertTo-Json
