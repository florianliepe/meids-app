targetScope = 'resourceGroup'

@description('Deployment environment label.')
@allowed([
  'uat'
  'prod'
])
param environment string

param location string = resourceGroup().location
param keyVaultLocation string = location
param tags object

param appServicePlanName string
param createAppServicePlan bool = true
param existingAppServicePlanResourceGroup string = resourceGroup().name
param appServicePlanSku object = {
  name: 'B1'
  tier: 'Basic'
  capacity: 1
}

param backendName string
param staticWebAppName string
param staticWebAppSku string = 'Standard'
param searchName string
param searchSku string = 'basic'
param searchReplicaCount int = 1
param searchPartitionCount int = 1
param searchSemanticTier string = 'free'
param disableSearchLocalAuth bool = false
@description('Disable public Search and Storage access. Requires private endpoints from production-data-plane.bicep before activation.')
param privateDataPlaneEnabled bool = false
param storageName string
param storageSku string = 'Standard_LRS'
param keyVaultName string
param logAnalyticsName string
param appInsightsName string

param approvedSearchIndex string = 'meids-okf-approved-v1'
param workingSearchIndex string = 'meids-okf-working-v1'
@description('Azure OpenAI resource endpoint used for production embeddings. Leave empty until an approved resource exists.')
param azureOpenAiEndpoint string = ''
@description('Azure OpenAI embedding deployment name. Leave empty until the model deployment exists.')
param azureOpenAiEmbeddingDeployment string = ''
@allowed([
  'api_key'
  'managed_identity'
])
param azureOpenAiAuthMode string = 'managed_identity'
param azureOpenAiEmbeddingDimensions int = 1536
@description('OpenAI-compatible Eraneos AI Gateway base URL.')
param eraneosAiGatewayBaseUrl string = 'https://ai-gateway.eraneos.com/v1'
@description('Key Vault secret containing the Eraneos AI Gateway key.')
param eraneosAiGatewayApiKeySecretName string = 'meids-eraneos-llm-gateway-api-key'
@description('Gateway model used for audio-input transcription. Leave empty to disable voice transcription.')
param eraneosAiGatewayTranscriptionModel string = ''
@description('Comma-separated fallback audio-input models used only when the primary returns an empty or content-filtered response.')
param eraneosAiGatewayTranscriptionFallbackModels string = ''
@allowed([
  'audio_transcriptions'
  'chat_completions_audio'
])
param eraneosAiGatewayTranscriptionMode string = 'chat_completions_audio'
@description('Maximum duration for one upstream audio transcription request. Long recordings run asynchronously, but the provider call remains bounded.')
@minValue(30000)
@maxValue(600000)
param transcriptionTimeoutMs int = 360000
param allowedFrontendOrigins string
param actorTwinWebhookUrl string
param knowledgeFabricWebhookUrl string
param agenticButlerWebhookUrl string
param n8nApiBaseUrl string
param containerStartupTimeLimitSeconds int = 600
param enableKeyVaultPurgeProtection bool = false
param allowStorageSharedKeyAccess bool = false
param enableKnowledgeAuthorization bool = false
param knowledgeAuthorizationSigningSecretName string = 'meids-auth-context-signing-key'
param deployDiagnostics bool = true
param searchRoleAssignmentName string = ''
param storageRoleAssignmentName string = ''
param vaultRoleAssignmentName string = ''
param backendDiagnosticSettingName string = ''
param searchDiagnosticSettingName string = ''
param storageDiagnosticSettingName string = ''
param vaultDiagnosticSettingName string = ''

var commonTags = union(tags, {
  application: 'meids'
  environment: environment
  'managed-by': 'bicep'
})

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  tags: union(commonTags, { component: 'observability' })
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  tags: union(commonTags, {
    component: 'observability'
    'hidden-link:${workspace.id}': 'Resource'
  })
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    RetentionInDays: 90
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource createdPlan 'Microsoft.Web/serverfarms@2023-12-01' = if (createAppServicePlan) {
  name: appServicePlanName
  location: location
  kind: 'linux'
  tags: union(commonTags, { component: 'compute' })
  sku: appServicePlanSku
  properties: {
    reserved: true
  }
}

resource existingPlan 'Microsoft.Web/serverfarms@2023-12-01' existing = if (!createAppServicePlan) {
  name: appServicePlanName
  scope: resourceGroup(existingAppServicePlanResourceGroup)
}

var appServicePlanId = createAppServicePlan ? createdPlan.id : existingPlan.id

resource search 'Microsoft.Search/searchServices@2024-03-01-preview' = {
  name: searchName
  location: location
  tags: union(commonTags, {
    component: 'knowledge-vector-index'
    'data-classification': 'confidential'
  })
  sku: {
    name: searchSku
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    authOptions: disableSearchLocalAuth ? null : {
      aadOrApiKey: {
        aadAuthFailureMode: 'http401WithBearerChallenge'
      }
    }
    disableLocalAuth: disableSearchLocalAuth
    hostingMode: 'default'
    networkRuleSet: {
      bypass: 'None'
      ipRules: []
    }
    partitionCount: searchPartitionCount
    publicNetworkAccess: privateDataPlaneEnabled ? 'Disabled' : 'Enabled'
    replicaCount: searchReplicaCount
    semanticSearch: searchSemanticTier
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: union(commonTags, {
    component: 'knowledge-artifacts'
    'data-classification': 'confidential'
  })
  kind: 'StorageV2'
  sku: {
    name: storageSku
  }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: allowStorageSharedKeyAccess
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: privateDataPlaneEnabled ? 'Disabled' : 'Enabled'
    networkAcls: {
      bypass: 'None'
      defaultAction: privateDataPlaneEnabled ? 'Deny' : 'Allow'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 14
    }
    deleteRetentionPolicy: {
      enabled: true
      days: 14
      allowPermanentDelete: false
    }
    isVersioningEnabled: true
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: keyVaultLocation
  tags: union(commonTags, {
    component: 'secrets'
    'data-classification': 'confidential'
  })
  properties: {
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enablePurgeProtection: enableKeyVaultPurgeProtection
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'None'
      defaultAction: 'Allow'
    }
    sku: {
      family: 'A'
      name: 'standard'
    }
  }
}

resource backend 'Microsoft.Web/sites@2023-12-01' = {
  name: backendName
  location: location
  kind: 'app,linux'
  tags: union(commonTags, {
    component: 'backend'
    'data-classification': 'confidential'
    'hidden-link: /app-insights-resource-id': insights.id
  })
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    clientAffinityEnabled: false
    httpsOnly: true
    serverFarmId: appServicePlanId
    siteConfig: {
      alwaysOn: true
      appCommandLine: 'npm start'
      ftpsState: 'Disabled'
      healthCheckPath: '/api/health'
      http20Enabled: true
      linuxFxVersion: 'NODE|22-lts'
      minTlsVersion: '1.2'
    }
  }
}

resource backendAppSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: backend
  name: 'appsettings'
  properties: {
    NODE_ENV: 'production'
    PORT: '8080'
    ALLOWED_FRONTEND_ORIGINS: allowedFrontendOrigins
    APPLICATIONINSIGHTS_CONNECTION_STRING: insights.properties.ConnectionString
    ApplicationInsightsAgent_EXTENSION_VERSION: '~3'
    AZURE_KEY_VAULT_URI: vault.properties.vaultUri
    AZURE_SEARCH_AUTH_MODE: 'managed_identity'
    AZURE_SEARCH_ENDPOINT: 'https://${search.name}.search.windows.net'
    AZURE_SEARCH_APPROVED_INDEX: approvedSearchIndex
    AZURE_SEARCH_WORKING_INDEX: workingSearchIndex
    AZURE_SEARCH_API_VERSION: '2025-09-01'
    AZURE_SEARCH_REQUEST_TIMEOUT_MS: '10000'
    AZURE_SEARCH_STARTUP_PROBE: 'false'
    AZURE_OPENAI_ENDPOINT: azureOpenAiEndpoint
    AZURE_OPENAI_AUTH_MODE: azureOpenAiAuthMode
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT: azureOpenAiEmbeddingDeployment
    AZURE_OPENAI_EMBEDDING_DIMENSIONS: string(azureOpenAiEmbeddingDimensions)
    AZURE_OPENAI_API_VERSION: '2024-02-01'
    ERANEOS_AI_GATEWAY_BASE_URL: eraneosAiGatewayBaseUrl
    ERANEOS_AI_GATEWAY_API_KEY: empty(eraneosAiGatewayApiKeySecretName) ? '' : '@Microsoft.KeyVault(VaultName=${vault.name};SecretName=${eraneosAiGatewayApiKeySecretName})'
    ERANEOS_AI_GATEWAY_TRANSCRIPTION_MODEL: eraneosAiGatewayTranscriptionModel
    ERANEOS_AI_GATEWAY_TRANSCRIPTION_FALLBACK_MODELS: eraneosAiGatewayTranscriptionFallbackModels
    ERANEOS_AI_GATEWAY_TRANSCRIPTION_MODE: eraneosAiGatewayTranscriptionMode
    TRANSCRIPTION_TIMEOUT_MS: string(transcriptionTimeoutMs)
    MEIDS_ALLOW_DETERMINISTIC_VECTORS: environment == 'uat' ? 'true' : 'false'
    MEIDS_ENFORCE_KNOWLEDGE_AUTH: string(enableKnowledgeAuthorization)
    MEIDS_AUTH_CONTEXT_SIGNING_KEY: enableKnowledgeAuthorization ? '@Microsoft.KeyVault(VaultName=${vault.name};SecretName=${knowledgeAuthorizationSigningSecretName})' : ''
    MEIDS_RUNTIME_JOB_WORKER_ENABLED: 'true'
    MEIDS_RUNTIME_JOB_BATCH_SIZE: '4'
    MEIDS_RUNTIME_JOB_INTERVAL_MS: '5000'
    MEIDS_RUNTIME_JOB_LEASE_SECONDS: '420'
    N8N_ACTOR_TWIN_WEBHOOK_URL: actorTwinWebhookUrl
    N8N_KNOWLEDGE_FABRIC_WEBHOOK_URL: knowledgeFabricWebhookUrl
    N8N_AGENTIC_BUTLER_WEBHOOK_URL: agenticButlerWebhookUrl
    N8N_API_BASE_URL: n8nApiBaseUrl
    WEBSITE_HEALTHCHECK_MAXPINGFAILURES: '5'
    WEBSITES_CONTAINER_START_TIME_LIMIT: string(containerStartupTimeLimitSeconds)
  }
}

resource frontend 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: location
  tags: union(commonTags, { component: 'frontend' })
  sku: {
    name: staticWebAppSku
    tier: staticWebAppSku
  }
  properties: {}
}

var searchIndexDataContributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '8ebe5a00-799e-43f5-93ac-243d3dce84a7')
var storageBlobDataContributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var keyVaultSecretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var effectiveSearchRoleAssignmentName = empty(searchRoleAssignmentName) ? guid(search.id, backend.id, searchIndexDataContributorRoleId) : searchRoleAssignmentName
var effectiveStorageRoleAssignmentName = empty(storageRoleAssignmentName) ? guid(storage.id, backend.id, storageBlobDataContributorRoleId) : storageRoleAssignmentName
var effectiveVaultRoleAssignmentName = empty(vaultRoleAssignmentName) ? guid(vault.id, backend.id, keyVaultSecretsUserRoleId) : vaultRoleAssignmentName

resource backendSearchRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: effectiveSearchRoleAssignmentName
  scope: search
  properties: {
    principalId: backend.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: searchIndexDataContributorRoleId
  }
}

resource backendStorageRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: effectiveStorageRoleAssignmentName
  scope: storage
  properties: {
    principalId: backend.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageBlobDataContributorRoleId
  }
}

resource backendVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: effectiveVaultRoleAssignmentName
  scope: vault
  properties: {
    principalId: backend.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

resource backendDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = if (deployDiagnostics) {
  name: empty(backendDiagnosticSettingName) ? '${backendName}-diagnostics' : backendDiagnosticSettingName
  scope: backend
  properties: {
    workspaceId: workspace.id
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

resource searchDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = if (deployDiagnostics) {
  name: empty(searchDiagnosticSettingName) ? '${searchName}-diagnostics' : searchDiagnosticSettingName
  scope: search
  properties: {
    workspaceId: workspace.id
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

resource vaultDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = if (deployDiagnostics) {
  name: empty(vaultDiagnosticSettingName) ? '${keyVaultName}-diagnostics' : vaultDiagnosticSettingName
  scope: vault
  properties: {
    workspaceId: workspace.id
    logs: [
      {
        categoryGroup: 'audit'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

resource storageDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = if (deployDiagnostics) {
  name: empty(storageDiagnosticSettingName) ? '${storageName}-blob-diagnostics' : storageDiagnosticSettingName
  scope: blobService
  properties: {
    workspaceId: workspace.id
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

output backendPrincipalId string = backend.identity.principalId
output backendUrl string = 'https://${backend.properties.defaultHostName}'
output frontendUrl string = 'https://${frontend.properties.defaultHostname}'
output keyVaultUri string = vault.properties.vaultUri
output searchEndpoint string = 'https://${search.name}.search.windows.net'
output storageAccountName string = storage.name
