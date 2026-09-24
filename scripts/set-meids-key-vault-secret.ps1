param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[a-zA-Z0-9-]+$")]
  [string]$SecretName,

  [string]$VaultName = "Intellectual-twin-vault",
  [string]$Subscription = "25c9ce59-90a1-4e8a-a2d4-1853a19bce22",
  [string]$Environment = "prod",
  [string]$Purpose = "meids-runtime"
)

$ErrorActionPreference = "Stop"

function Resolve-AzCommand {
  $command = Get-Command "az" -ErrorAction SilentlyContinue
  if ($command) {
    return @{ executable = $command.Source; prefix = @() }
  }

  $bundledPython = "C:\Program Files\Microsoft SDKs\Azure\CLI2\python.exe"
  if (Test-Path $bundledPython) {
    return @{ executable = $bundledPython; prefix = @("-m", "azure.cli") }
  }

  throw "Azure CLI is required."
}

$azCommand = Resolve-AzCommand
& $azCommand.executable @($azCommand.prefix + @("account", "set", "--subscription", $Subscription))
if ($LASTEXITCODE -ne 0) { throw "Could not select Azure subscription." }

$tokenJson = & $azCommand.executable @($azCommand.prefix + @(
  "account", "get-access-token", "--resource", "https://vault.azure.net", "--output", "json"
))
if ($LASTEXITCODE -ne 0) { throw "Could not obtain a Key Vault access token." }
$accessToken = ($tokenJson | ConvertFrom-Json).accessToken

$secret = Read-Host "Enter the value for '$SecretName'" -AsSecureString
if ($secret.Length -eq 0) { throw "Secret value must not be empty." }

$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $plainValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $request = @{
    value = $plainValue
    contentType = "text/plain"
    attributes = @{ enabled = $true }
    tags = @{
      application = "meids"
      environment = $Environment
      purpose = $Purpose
      managedBy = "manual-rotation-runbook"
    }
  } | ConvertTo-Json -Depth 5

  $vaultHost = "$($VaultName.ToLowerInvariant()).vault.azure.net"
  $uri = "https://$vaultHost/secrets/$SecretName`?api-version=7.4"
  $result = Invoke-RestMethod -Method Put -Uri $uri -Headers @{
    Authorization = "Bearer $accessToken"
  } -Body $request -ContentType "application/json"

  [pscustomobject]@{
    status = "stored"
    vault = $VaultName
    secret = $SecretName
    version = ($result.id -split "/")[-1]
    enabled = $result.attributes.enabled
  } | ConvertTo-Json
}
finally {
  if ($plainValue) { $plainValue = $null }
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

