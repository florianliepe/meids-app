targetScope = 'resourceGroup'

@description('Existing production storage account name.')
param storageAccountName string

@description('Tags applied to the managed containers.')
param tags object = {
  application: 'meids'
  environment: 'prod'
  'managed-by': 'bicep'
  'data-classification': 'confidential'
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: storage
  name: 'default'
}

resource knowledgeSources 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'knowledge-sources'
  properties: { publicAccess: 'None' }
}

resource okfWorking 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'okf-working'
  properties: { publicAccess: 'None' }
}

resource okfApproved 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'okf-approved'
  properties: { publicAccess: 'None' }
}

resource learningArtifacts 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'learning-artifacts'
  properties: { publicAccess: 'None' }
}

resource quarantine 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'quarantine'
  properties: { publicAccess: 'None' }
}

resource exports 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'exports'
  properties: { publicAccess: 'None' }
}

resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'expire-disposable-artifacts'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['quarantine/', 'exports/']
            }
            actions: {
              baseBlob: {
                delete: { daysAfterModificationGreaterThan: 90 }
              }
              snapshot: {
                delete: { daysAfterCreationGreaterThan: 90 }
              }
              version: {
                delete: { daysAfterCreationGreaterThan: 90 }
              }
            }
          }
        }
        {
          name: 'expire-quarantine-early'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['quarantine/']
            }
            actions: {
              baseBlob: {
                delete: { daysAfterModificationGreaterThan: 30 }
              }
            }
          }
        }
        {
          name: 'expire-noncurrent-knowledge-versions'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['knowledge-sources/', 'okf-working/', 'learning-artifacts/']
            }
            actions: {
              version: {
                delete: { daysAfterCreationGreaterThan: 90 }
              }
              snapshot: {
                delete: { daysAfterCreationGreaterThan: 90 }
              }
            }
          }
        }
      ]
    }
  }
}

output containers array = [
  knowledgeSources.name
  okfWorking.name
  okfApproved.name
  learningArtifacts.name
  quarantine.name
  exports.name
]
