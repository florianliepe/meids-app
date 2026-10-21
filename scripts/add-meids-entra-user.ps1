[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [string]$UserObjectId,

  [switch]$Owner
)

$ErrorActionPreference = 'Stop'
$usersGroupId = '6d05aad5-e0ea-4bc5-84b0-003f43611079'
$ownersGroupId = '849d2888-ecd3-42e8-ad91-fd3178b83734'

$user = az ad user show --id $UserObjectId --query '{id:id,displayName:displayName,userPrincipalName:userPrincipalName,userType:userType}' -o json | ConvertFrom-Json
if (-not $user.id) {
  throw "No Microsoft Entra user or accepted B2B guest was found for object ID '$UserObjectId'."
}

function Add-DirectGroupMember([string]$GroupId, [string]$GroupName) {
  $isMember = az ad group member check --group $GroupId --member-id $user.id --query value -o tsv
  if ($isMember -eq 'true') { return }
  if ($PSCmdlet.ShouldProcess($user.userPrincipalName, "Add direct membership to $GroupName")) {
    az ad group member add --group $GroupId --member-id $user.id
  }
}

Add-DirectGroupMember $usersGroupId 'Me.IDs Users'
if ($Owner) {
  Add-DirectGroupMember $ownersGroupId 'Me.IDs Owners'
}

[pscustomobject]@{
  status = 'completed'
  user_object_id = $user.id
  user_principal_name = $user.userPrincipalName
  user_type = $user.userType
  meids_user = $true
  meids_owner = [bool]$Owner
  note = 'Start a fresh sign-in session after membership propagation. First-login database provisioning requires the Me.IDs custom enterprise application configuration.'
} | ConvertTo-Json
