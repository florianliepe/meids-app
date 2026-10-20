using './production-data-plane.bicep'

param location = 'westeurope'
param backendName = 'meids-prod-backend-1853a19b'
param postgresServerName = 'psql-meids-prod-1853a19b'
param entraAdminObjectId = 'a85b18b9-428a-4169-91e9-c7b1cc0d159e'
param entraAdminPrincipalName = 'Me.IDs Production PostgreSQL Administrators'
param entraAdminPrincipalType = 'Group'
param vnetName = 'vnet-meids-prod-weu'
param vnetAddressPrefix = '10.42.0.0/16'
param appSubnetAddressPrefix = '10.42.1.0/24'
param databaseSubnetAddressPrefix = '10.42.2.0/24'
param privateEndpointSubnetAddressPrefix = '10.42.3.0/24'
param privateDnsZoneName = 'meids.private.postgres.database.azure.com'
param searchServiceName = 'srch-meids-prod-1853a19b'
param storageAccountName = 'stmeidsprod1853a19b'
param databaseName = 'meids_prod'
param postgresSkuName = 'Standard_D2ds_v5'
param postgresStorageSizeGb = 128
param backupRetentionDays = 35
// New HA deployments are currently blocked by the PostgreSQL service in West Europe.
// Retain geo-backup at creation and enable zone HA when regional capacity reopens.
// West Europe reported no alternate-zone capacity for this server placement on
// 2026-10-14. Keep synchronous same-zone HA until a controlled promotion to
// zone-redundant HA succeeds.
param enableSameZoneHa = true
param enableZoneRedundantHa = false
param enableGeoRedundantBackup = true
param logAnalyticsName = 'log-meids-prod-weu'
param tags = {
  application: 'meids'
  environment: 'prod'
  workload: 'intellectual-twin'
  owner: 'florian'
  'managed-by': 'bicep'
  'data-classification': 'confidential'
}
