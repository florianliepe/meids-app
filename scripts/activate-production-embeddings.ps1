[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [Parameter(Mandatory = $true)]
  [string] $AzureOpenAiResourceGroup,

  [Parameter(Mandatory = $true)]
  [string] $AzureOpenAiAccountName,

  [Parameter(Mandatory = $true)]
  [string] $EmbeddingDeploymentName,

  [string] $BackendResourceGroup = 'rg-ai-intellectual-twin',
  [string] $BackendAppName = 'meids-prod-backend-1853a19b',
  [string] $SubscriptionId = '25c9ce59-90a1-4e8a-a2d4-1853a19bce22',
  [int] $EmbeddingDimensions = 1536,
  [switch] $Apply
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($EmbeddingDimensions -ne 1536) {
  throw 'The current Azure AI Search indexes require exactly 1536 dimensions.'
}

az account set --subscription $SubscriptionId
if ($LASTEXITCODE -ne 0) { throw 'Unable to select the Azure subscription.' }

$account = az cognitiveservices account show `
  --resource-group $AzureOpenAiResourceGroup `
  --name $AzureOpenAiAccountName `
  --query '{id:id,endpoint:properties.endpoint,kind:kind}' `
  --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $account.id -or -not $account.endpoint) {
  throw 'The Azure OpenAI account could not be resolved.'
}
if ($account.kind -notin @('OpenAI', 'AIServices')) {
  throw "Expected an OpenAI or AIServices account, found '$($account.kind)'."
}

$deployment = az cognitiveservices account deployment show `
  --resource-group $AzureOpenAiResourceGroup `
  --name $AzureOpenAiAccountName `
  --deployment-name $EmbeddingDeploymentName `
  --query '{name:name,model:properties.model.name,version:properties.model.version,state:properties.provisioningState}' `
  --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $deployment.name) {
  throw 'The embedding deployment could not be resolved.'
}
if ($deployment.model -ne 'text-embedding-3-small') {
  throw "Expected text-embedding-3-small, found '$($deployment.model)'."
}
if ($deployment.state -ne 'Succeeded') {
  throw "Embedding deployment provisioning state is '$($deployment.state)', not 'Succeeded'."
}

$principalId = az webapp identity show `
  --resource-group $BackendResourceGroup `
  --name $BackendAppName `
  --query principalId `
  --output tsv
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($principalId)) {
  throw 'The backend managed identity could not be resolved.'
}

$plan = [ordered]@{
  subscription_id = $SubscriptionId
  azure_openai_account = $account.id
  deployment = $deployment.name
  model = $deployment.model
  model_version = $deployment.version
  backend_app = $BackendAppName
  backend_principal_id = $principalId.Trim()
  role = 'Cognitive Services OpenAI User'
  authentication_mode = 'managed_identity'
  dimensions = $EmbeddingDimensions
  apply_requested = [bool]$Apply
}
$plan | ConvertTo-Json -Depth 4

if (-not $Apply) {
  Write-Host 'Validation passed. Re-run with -Apply to change Azure state.'
  exit 0
}

$target = "$BackendAppName -> $($account.id)/deployments/$EmbeddingDeploymentName"
if (-not $PSCmdlet.ShouldProcess($target, 'Enable managed-identity production embeddings')) {
  exit 0
}

az role assignment create `
  --assignee-object-id $principalId.Trim() `
  --assignee-principal-type ServicePrincipal `
  --role 'Cognitive Services OpenAI User' `
  --scope $account.id `
  --output none
if ($LASTEXITCODE -ne 0) { throw 'Unable to assign the Azure OpenAI data-plane role.' }

# Production embeddings must not silently fall back to a stored API key.
az webapp config appsettings delete `
  --resource-group $BackendResourceGroup `
  --name $BackendAppName `
  --setting-names AZURE_OPENAI_API_KEY `
  --output none 2>$null

az webapp config appsettings set `
  --resource-group $BackendResourceGroup `
  --name $BackendAppName `
  --settings `
    "AZURE_OPENAI_ENDPOINT=$($account.endpoint.TrimEnd('/'))" `
    "AZURE_OPENAI_EMBEDDING_DEPLOYMENT=$EmbeddingDeploymentName" `
    'AZURE_OPENAI_AUTH_MODE=managed_identity' `
    "AZURE_OPENAI_EMBEDDING_DIMENSIONS=$EmbeddingDimensions" `
  --output none
if ($LASTEXITCODE -ne 0) { throw 'Unable to configure the backend embedding settings.' }

az webapp restart --resource-group $BackendResourceGroup --name $BackendAppName
if ($LASTEXITCODE -ne 0) { throw 'Unable to restart the backend App Service.' }

$roleCount = az role assignment list `
  --assignee-object-id $principalId.Trim() `
  --scope $account.id `
  --query "[?roleDefinitionName=='Cognitive Services OpenAI User'] | length(@)" `
  --output tsv
$settings = az webapp config appsettings list `
  --resource-group $BackendResourceGroup `
  --name $BackendAppName `
  --query "[?starts_with(name, 'AZURE_OPENAI_')].{name:name,value:value}" `
  --output json | ConvertFrom-Json

if ([int]$roleCount -lt 1) { throw 'The managed-identity role assignment was not found after activation.' }
if ($settings.name -contains 'AZURE_OPENAI_API_KEY') { throw 'AZURE_OPENAI_API_KEY is still present after managed-identity activation.' }

[ordered]@{
  status = 'configured'
  role_assignment_count = [int]$roleCount
  settings = @($settings | ForEach-Object {
    [ordered]@{ name = $_.name; configured = -not [string]::IsNullOrWhiteSpace($_.value) }
  })
  next_action = 'Run an authenticated semantic ingest probe and a complete PostgreSQL-to-Search rebuild.'
} | ConvertTo-Json -Depth 5
