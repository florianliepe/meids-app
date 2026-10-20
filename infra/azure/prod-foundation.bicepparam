using './main.bicep'

param environment = 'prod'
param location = 'westeurope'
param keyVaultLocation = 'westeurope'
param tags = {
  owner: 'florian'
  'data-classification': 'confidential'
  workload: 'intellectual-twin'
}
param appServicePlanName = 'asp-meids-prod-weu'
param createAppServicePlan = true
param appServicePlanSku = {
  name: 'P1v3'
  tier: 'PremiumV3'
  capacity: 1
}
param backendName = 'meids-prod-backend-1853a19b'
param staticWebAppName = 'meids-prod-frontend-1853a19b'
param staticWebAppSku = 'Standard'
param searchName = 'srch-meids-prod-1853a19b'
param searchSku = 'basic'
param searchReplicaCount = 1
param searchPartitionCount = 1
param searchSemanticTier = 'free'
param disableSearchLocalAuth = true
param privateDataPlaneEnabled = true
param storageName = 'stmeidsprod1853a19b'
param storageSku = 'Standard_GRS'
param keyVaultName = 'kv-meids-prod-1853a19b'
param logAnalyticsName = 'log-meids-prod-weu'
param appInsightsName = 'appi-meids-prod-weu'
param approvedSearchIndex = 'meids-okf-approved-v1'
param workingSearchIndex = 'meids-okf-working-v1'
param allowedFrontendOrigins = 'https://intellectual-twin.eraneos.com'
param actorTwinWebhookUrl = 'https://eraneos-agentic-platform.azurewebsites.net/webhook/b4afb251-2ad1-43da-9d7c-6f6473fbd3db/chat'
param knowledgeFabricWebhookUrl = 'https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/knowledge-fabric/ingest'
param agenticButlerWebhookUrl = 'https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/agentic-butler/run'
param n8nApiBaseUrl = 'https://eraneos-agentic-platform.azurewebsites.net'
param containerStartupTimeLimitSeconds = 300
param enableKeyVaultPurgeProtection = true
param allowStorageSharedKeyAccess = false
param deployDiagnostics = true
