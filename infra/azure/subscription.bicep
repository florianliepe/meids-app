targetScope = 'subscription'

param resourceGroupName string
param location string = 'westeurope'
param foundationParameters object

resource productionResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: foundationParameters.tags
}

module foundation 'main.bicep' = {
  name: 'meids-${foundationParameters.environment}-foundation'
  scope: productionResourceGroup
  params: {
    environment: foundationParameters.environment
    location: location
    keyVaultLocation: foundationParameters.keyVaultLocation
    tags: foundationParameters.tags
    appServicePlanName: foundationParameters.appServicePlanName
    createAppServicePlan: foundationParameters.createAppServicePlan
    appServicePlanSku: foundationParameters.appServicePlanSku
    backendName: foundationParameters.backendName
    staticWebAppName: foundationParameters.staticWebAppName
    staticWebAppSku: foundationParameters.staticWebAppSku
    searchName: foundationParameters.searchName
    searchSku: foundationParameters.searchSku
    searchReplicaCount: foundationParameters.searchReplicaCount
    searchPartitionCount: foundationParameters.searchPartitionCount
    searchSemanticTier: foundationParameters.searchSemanticTier
    disableSearchLocalAuth: foundationParameters.disableSearchLocalAuth
    privateDataPlaneEnabled: foundationParameters.privateDataPlaneEnabled
    storageName: foundationParameters.storageName
    storageSku: foundationParameters.storageSku
    keyVaultName: foundationParameters.keyVaultName
    logAnalyticsName: foundationParameters.logAnalyticsName
    appInsightsName: foundationParameters.appInsightsName
    approvedSearchIndex: foundationParameters.approvedSearchIndex
    workingSearchIndex: foundationParameters.workingSearchIndex
    azureOpenAiEndpoint: foundationParameters.?azureOpenAiEndpoint ?? ''
    azureOpenAiEmbeddingDeployment: foundationParameters.?azureOpenAiEmbeddingDeployment ?? ''
    azureOpenAiAuthMode: foundationParameters.?azureOpenAiAuthMode ?? 'managed_identity'
    azureOpenAiEmbeddingDimensions: foundationParameters.?azureOpenAiEmbeddingDimensions ?? 1536
    allowedFrontendOrigins: foundationParameters.allowedFrontendOrigins
    actorTwinWebhookUrl: foundationParameters.actorTwinWebhookUrl
    knowledgeFabricWebhookUrl: foundationParameters.knowledgeFabricWebhookUrl
    agenticButlerWebhookUrl: foundationParameters.agenticButlerWebhookUrl
    n8nApiBaseUrl: foundationParameters.n8nApiBaseUrl
    containerStartupTimeLimitSeconds: foundationParameters.containerStartupTimeLimitSeconds
    enableKeyVaultPurgeProtection: foundationParameters.enableKeyVaultPurgeProtection
    allowStorageSharedKeyAccess: foundationParameters.allowStorageSharedKeyAccess
    deployDiagnostics: foundationParameters.deployDiagnostics
    searchRoleAssignmentName: ''
    storageRoleAssignmentName: ''
    vaultRoleAssignmentName: ''
    backendDiagnosticSettingName: ''
    searchDiagnosticSettingName: ''
    storageDiagnosticSettingName: ''
    vaultDiagnosticSettingName: ''
  }
}

output resourceGroupId string = productionResourceGroup.id
output backendUrl string = foundation.outputs.backendUrl
output frontendUrl string = foundation.outputs.frontendUrl
