targetScope = 'resourceGroup'

@description('Region for the production data plane.')
param location string = resourceGroup().location

@description('Existing Me.IDs backend App Service name.')
param backendName string

@description('Globally unique PostgreSQL Flexible Server name.')
param postgresServerName string

@description('Microsoft Entra object ID of the PostgreSQL administrator group.')
param entraAdminObjectId string

@description('Display name of the Microsoft Entra PostgreSQL administrator group.')
param entraAdminPrincipalName string

@allowed([
  'Group'
  'ServicePrincipal'
  'User'
])
param entraAdminPrincipalType string = 'Group'

param vnetName string = 'vnet-meids-prod-weu'
param appSubnetName string = 'snet-meids-app-integration'
param databaseSubnetName string = 'snet-meids-postgres'
param privateEndpointSubnetName string = 'snet-meids-private-endpoints'
param vnetAddressPrefix string = '10.42.0.0/16'
param appSubnetAddressPrefix string = '10.42.1.0/24'
param databaseSubnetAddressPrefix string = '10.42.2.0/24'
param privateEndpointSubnetAddressPrefix string = '10.42.3.0/24'
param privateDnsZoneName string = 'meids.private.postgres.database.azure.com'
param searchPrivateDnsZoneName string = 'privatelink.search.windows.net'
param blobPrivateDnsZoneName string = 'privatelink.blob.${environment().suffixes.storage}'
@description('Existing production Azure AI Search service name.')
param searchServiceName string
@description('Existing production Storage account name.')
param storageAccountName string
param databaseName string = 'meids_prod'
param postgresSkuName string = 'Standard_D2ds_v5'
param postgresStorageSizeGb int = 128
param backupRetentionDays int = 35
param enableGeoRedundantBackup bool = false
@description('Enable a synchronous standby in the primary availability zone when cross-zone capacity is unavailable.')
param enableSameZoneHa bool = false
@description('Enable a synchronous standby in a different availability zone. Takes precedence over same-zone HA.')
param enableZoneRedundantHa bool = false
param logAnalyticsName string = 'log-meids-prod-1853a19b'
@description('Existing action group receiving production backend alerts.')
param operationsActionGroupName string = 'ag-meids-uat-ops'
param deployBackendAlerts bool = true
param tags object = {
  application: 'meids'
  environment: 'prod'
  'managed-by': 'bicep'
  'data-classification': 'confidential'
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        vnetAddressPrefix
      ]
    }
    subnets: [
      {
        name: appSubnetName
        properties: {
          addressPrefix: appSubnetAddressPrefix
          delegations: [
            {
              name: 'web-app-delegation'
              properties: {
                serviceName: 'Microsoft.Web/serverFarms'
              }
            }
          ]
        }
      }
      {
        name: databaseSubnetName
        properties: {
          addressPrefix: databaseSubnetAddressPrefix
          delegations: [
            {
              name: 'postgres-delegation'
              properties: {
                serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
              }
            }
          ]
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
      {
        name: privateEndpointSubnetName
        properties: {
          addressPrefix: privateEndpointSubnetAddressPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource appSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = {
  parent: vnet
  name: appSubnetName
}

resource databaseSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = {
  parent: vnet
  name: databaseSubnetName
}

resource privateEndpointSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = {
  parent: vnet
  name: privateEndpointSubnetName
}

resource searchService 'Microsoft.Search/searchServices@2024-03-01-preview' existing = {
  name: searchServiceName
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource privateDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: privateDnsZoneName
  location: 'global'
  tags: tags
}

resource privateDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: privateDns
  name: '${vnetName}-link'
  location: 'global'
  tags: tags
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource searchPrivateDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: searchPrivateDnsZoneName
  location: 'global'
  tags: tags
}

resource searchPrivateDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: searchPrivateDns
  name: '${vnetName}-search-link'
  location: 'global'
  tags: tags
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource blobPrivateDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: blobPrivateDnsZoneName
  location: 'global'
  tags: tags
}

resource blobPrivateDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: blobPrivateDns
  name: '${vnetName}-blob-link'
  location: 'global'
  tags: tags
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource searchPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: 'pe-meids-search-prod'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'search-service'
        properties: {
          privateLinkServiceId: searchService.id
          groupIds: [
            'searchService'
          ]
        }
      }
    ]
  }
}

resource searchPrivateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: searchPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'search'
        properties: {
          privateDnsZoneId: searchPrivateDns.id
        }
      }
    ]
  }
}

resource blobPrivateEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: 'pe-meids-blob-prod'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnet.id
    }
    privateLinkServiceConnections: [
      {
        name: 'blob-service'
        properties: {
          privateLinkServiceId: storageAccount.id
          groupIds: [
            'blob'
          ]
        }
      }
    ]
  }
}

resource blobPrivateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: blobPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'blob'
        properties: {
          privateDnsZoneId: blobPrivateDns.id
        }
      }
    ]
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresServerName
  location: location
  tags: tags
  sku: {
    name: postgresSkuName
    tier: 'GeneralPurpose'
  }
  properties: {
    version: '16'
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: tenant().tenantId
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: enableGeoRedundantBackup ? 'Enabled' : 'Disabled'
    }
    highAvailability: {
      mode: enableZoneRedundantHa ? 'ZoneRedundant' : (enableSameZoneHa ? 'SameZone' : 'Disabled')
    }
    network: {
      delegatedSubnetResourceId: databaseSubnet.id
      privateDnsZoneArmResourceId: privateDns.id
      publicNetworkAccess: 'Disabled'
    }
    storage: {
      autoGrow: 'Enabled'
      storageSizeGB: postgresStorageSizeGb
    }
  }
  dependsOn: [
    privateDnsLink
  ]
}

resource postgresAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: postgres
  name: entraAdminObjectId
  properties: {
    principalName: entraAdminPrincipalName
    principalType: entraAdminPrincipalType
    tenantId: tenant().tenantId
  }
}

resource postgresExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'azure.extensions'
  properties: {
    value: 'pgcrypto'
    source: 'user-override'
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource backend 'Microsoft.Web/sites@2023-12-01' existing = {
  name: backendName
}

resource operationsActionGroup 'Microsoft.Insights/actionGroups@2023-01-01' existing = {
  name: operationsActionGroupName
}

resource backendHttp5xxAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (deployBackendAlerts) {
  name: 'alert-meids-prod-backend-http5xx'
  location: 'global'
  tags: tags
  properties: {
    description: 'Me.IDs production backend returned more than five HTTP 5xx responses within five minutes.'
    severity: 2
    enabled: true
    scopes: [backend.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'Http5xxThreshold'
          metricNamespace: 'Microsoft.Web/sites'
          metricName: 'Http5xx'
          operator: 'GreaterThan'
          threshold: 5
          timeAggregation: 'Total'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [{ actionGroupId: operationsActionGroup.id }]
  }
}

resource backendLatencyAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (deployBackendAlerts) {
  name: 'alert-meids-prod-backend-latency'
  location: 'global'
  tags: tags
  properties: {
    description: 'Me.IDs production backend average response time exceeded five seconds.'
    severity: 3
    enabled: true
    scopes: [backend.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'AverageResponseTimeThreshold'
          metricNamespace: 'Microsoft.Web/sites'
          metricName: 'AverageResponseTime'
          operator: 'GreaterThan'
          threshold: 5
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [{ actionGroupId: operationsActionGroup.id }]
  }
}

resource backendHealthAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (deployBackendAlerts) {
  name: 'alert-meids-prod-backend-health'
  location: 'global'
  tags: tags
  properties: {
    description: 'Me.IDs production backend health-check status is unhealthy.'
    severity: 1
    enabled: true
    scopes: [backend.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'HealthCheckStatusThreshold'
          metricNamespace: 'Microsoft.Web/sites'
          metricName: 'HealthCheckStatus'
          operator: 'LessThan'
          threshold: 1
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [{ actionGroupId: operationsActionGroup.id }]
  }
}

resource backendVnetIntegration 'Microsoft.Web/sites/networkConfig@2023-12-01' = {
  parent: backend
  name: 'virtualNetwork'
  properties: {
    subnetResourceId: appSubnet.id
    swiftSupported: true
  }
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsName
}

resource postgresDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: '${postgresServerName}-diagnostics'
  scope: postgres
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

output databaseHost string = postgres.properties.fullyQualifiedDomainName
output databaseName string = database.name
output appIntegrationSubnetId string = appSubnet.id
output databaseSubnetId string = databaseSubnet.id
output privateEndpointSubnetId string = privateEndpointSubnet.id
output searchPrivateEndpointId string = searchPrivateEndpoint.id
output blobPrivateEndpointId string = blobPrivateEndpoint.id
