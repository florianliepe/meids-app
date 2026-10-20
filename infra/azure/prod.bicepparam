using './subscription.bicep'

param resourceGroupName = 'rg-ai-intellectual-twin-prod'
param location = 'westeurope'
param foundationParameters = {
  environment: 'prod'
  keyVaultLocation: 'westeurope'
  tags: {
    owner: 'florian'
    'data-classification': 'confidential'
    workload: 'intellectual-twin'
  }
  appServicePlanName: 'asp-meids-prod-weu'
  createAppServicePlan: true
  appServicePlanSku: {
    name: 'P1v3'
    tier: 'PremiumV3'
    capacity: 1
  }
  backendName: 'meids-prod-backend-1853a19b'
  staticWebAppName: 'meids-prod-frontend-1853a19b'
  staticWebAppSku: 'Standard'
  searchName: 'srch-meids-prod-1853a19b'
  searchSku: 'basic'
  searchReplicaCount: 1
  searchPartitionCount: 1
  searchSemanticTier: 'free'
  disableSearchLocalAuth: true
  privateDataPlaneEnabled: true
  storageName: 'stmeidsprod1853a19b'
  storageSku: 'Standard_GRS'
  keyVaultName: 'kv-meids-prod-1853a19b'
  logAnalyticsName: 'log-meids-prod-weu'
  appInsightsName: 'appi-meids-prod-weu'
  approvedSearchIndex: 'meids-okf-approved-v1'
  workingSearchIndex: 'meids-okf-working-v1'
  allowedFrontendOrigins: 'https://intellectual-twin.eraneos.com'
  actorTwinWebhookUrl: 'https://eraneos-agentic-platform.azurewebsites.net/webhook/b4afb251-2ad1-43da-9d7c-6f6473fbd3db/chat'
  knowledgeFabricWebhookUrl: 'https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/knowledge-fabric/ingest'
  agenticButlerWebhookUrl: 'https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/agentic-butler/run'
  n8nApiBaseUrl: 'https://eraneos-agentic-platform.azurewebsites.net'
  containerStartupTimeLimitSeconds: 300
  enableKeyVaultPurgeProtection: true
  allowStorageSharedKeyAccess: false
  deployDiagnostics: true
}
