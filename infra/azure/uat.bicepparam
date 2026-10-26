using './main.bicep'

param environment = 'uat'
param location = 'westeurope'
param keyVaultLocation = 'germanywestcentral'
param tags = {
  owner: 'florian'
  'data-classification': 'confidential'
}
param appServicePlanName = 'asp-erax-reference'
param createAppServicePlan = false
param existingAppServicePlanResourceGroup = 'rg-ai-intellectual-twin'
param backendName = 'meids-backend-1853a19b'
param staticWebAppName = 'intellectual-twin'
param searchName = 'srch-intellectual-twin'
param disableSearchLocalAuth = false
param storageName = 'steraxknowledge1853a19b'
param keyVaultName = 'Intellectual-twin-vault'
param logAnalyticsName = 'log-meids-uat-weu'
param appInsightsName = 'appi-meids-uat-weu'
param allowStorageSharedKeyAccess = true
param enableKeyVaultPurgeProtection = false
param eraneosAiGatewayTranscriptionModel = 'gemini-3.5-flash'
param eraneosAiGatewayTranscriptionFallbackModels = 'gemini-3.8-flash'
param eraneosAiGatewayTranscriptionMode = 'chat_completions_audio'
param allowedFrontendOrigins = 'https://florianliepe.github.io,https://victorious-flower-0f10a8303.6.azurestaticapps.net,https://intellectual-twin.eraneos.com'
param actorTwinWebhookUrl = 'https://eraneos-agentic-platform.azurewebsites.net/webhook/b4afb251-2ad1-43da-9d7c-6f6473fbd3db/chat'
param knowledgeFabricWebhookUrl = 'https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/knowledge-fabric/ingest'
param agenticButlerWebhookUrl = 'https://eraneos-agentic-platform.azurewebsites.net/webhook/meids/agentic-butler/run'
param n8nApiBaseUrl = 'https://eraneos-agentic-platform.azurewebsites.net'
param containerStartupTimeLimitSeconds = 600
param searchRoleAssignmentName = '298ca831-6090-4f6f-8617-cafcf9dc8a73'
param storageRoleAssignmentName = '922e535b-611e-4918-bddf-bc857486c7a7'
param vaultRoleAssignmentName = 'c1530df6-3da7-4c5d-a8d1-9f0c5c87c78f'
param backendDiagnosticSettingName = 'diag-meids-backend-uat'
param searchDiagnosticSettingName = 'diag-meids-search-uat'
param storageDiagnosticSettingName = 'diag-meids-blob-uat'
param vaultDiagnosticSettingName = 'diag-meids-vault-uat'
