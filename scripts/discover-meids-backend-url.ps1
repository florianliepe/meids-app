param(
  [string[]]$Candidates = @(
    "https://meids-backend.azurewebsites.net",
    "https://meids-app-backend.azurewebsites.net",
    "https://meids-backend-proxy.azurewebsites.net",
    "https://meids-agent-backend.azurewebsites.net",
    "https://meids-public-app-backend.azurewebsites.net",
    "https://intellectual-twin-backend.azurewebsites.net",
    "https://ai-intellectual-twin-backend.azurewebsites.net",
    "https://eraneos-meids-backend.azurewebsites.net",
    "https://eraneos-intellectual-twin-backend.azurewebsites.net"
  )
)

$ErrorActionPreference = "Stop"

function Test-Endpoint {
  param(
    [string]$Url,
    [string]$Method = "GET",
    [object]$Body = $null
  )

  try {
    $params = @{
      Uri = $Url
      Method = $Method
      TimeoutSec = 15
      Headers = @{ Accept = "application/json" }
    }
    if ($null -ne $Body) {
      $params.Body = ($Body | ConvertTo-Json -Depth 10)
      $params.ContentType = "application/json"
    }
    $result = Invoke-RestMethod @params
    return @{
      ok = $true
      result = $result
    }
  } catch {
    $statusCode = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }
    return @{
      ok = $false
      statusCode = $statusCode
      error = $_.Exception.Message
    }
  }
}

$results = @()

foreach ($candidate in $Candidates) {
  $base = $candidate.TrimEnd("/")
  $health = Test-Endpoint -Url "$base/api/health"
  $duplicate = $null

  if ($health.ok) {
    $duplicate = Test-Endpoint `
      -Url "$base/api/knowledge/duplicate-check" `
      -Method "POST" `
      -Body @{
        topic = "Discovery smoke test"
        purpose = "Verify Me.IDs backend duplicate scoring endpoint."
        text = "Discovery smoke test for the hosted Me.IDs backend."
      }
  }

  $results += [pscustomobject]@{
    candidate = $base
    health_ok = [bool]$health.ok
    health_status_code = $health.statusCode
    duplicate_ok = [bool]($duplicate -and $duplicate.ok)
    duplicate_status_code = if ($duplicate) { $duplicate.statusCode } else { $null }
    duplicate_status = if ($duplicate -and $duplicate.result.duplicate_check) { $duplicate.result.duplicate_check.status } else { $null }
    error = if ($health.ok) { if ($duplicate -and -not $duplicate.ok) { $duplicate.error } else { $null } } else { $health.error }
  }
}

$match = $results | Where-Object { $_.health_ok -and $_.duplicate_ok } | Select-Object -First 1

if ($match) {
  $env:MEIDS_BACKEND_URL = $match.candidate
  [Environment]::SetEnvironmentVariable("MEIDS_BACKEND_URL", $match.candidate, "User")
  @{
    status = "found"
    meids_backend_url = $match.candidate
    note = "MEIDS_BACKEND_URL was set for the current process and persisted to the Windows user environment."
    results = $results
  } | ConvertTo-Json -Depth 10
  exit 0
}

@{
  status = "not_found"
  message = "No candidate exposed both /api/health and /api/knowledge/duplicate-check."
  next_action = "Identify or deploy the backend App Service, then set MEIDS_BACKEND_URL manually."
  results = $results
} | ConvertTo-Json -Depth 10

exit 2
