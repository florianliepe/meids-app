param(
  [Parameter(Mandatory = $true)][string]$AppName,
  [Parameter(Mandatory = $true)][string]$RestoreHost,
  [Parameter(Mandatory = $true)][string]$AdminPrincipalName,
  [string]$DatabaseName = "meids_prod",
  [string]$ResourceGroup = "rg-ai-intellectual-twin"
)

$ErrorActionPreference = "Stop"

try {
  $token = az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv
  if ($LASTEXITCODE -ne 0 -or -not $token) {
    throw "Could not acquire a PostgreSQL Entra access token."
  }

  $credentials = az webapp deployment list-publishing-credentials `
    --resource-group $ResourceGroup `
    --name $AppName `
    --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "Could not acquire Kudu publishing credentials." }

  $pair = "{0}:{1}" -f $credentials.publishingUserName, $credentials.publishingPassword
  $authorization = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
  $headers = @{ Authorization = "Basic $authorization" }
  $installBody = @{ command = "npm ci --omit=dev --loglevel=error"; dir = "/home/site/wwwroot" } | ConvertTo-Json
  $install = Invoke-RestMethod `
    -Method Post `
    -Uri "https://$AppName.scm.azurewebsites.net/api/command" `
    -Headers $headers `
    -ContentType "application/json" `
    -Body $installBody `
    -TimeoutSec 180
  if ([int]$install.ExitCode -ne 0) { throw "Could not install the restore validation database client." }

  $connection = @{
    host = $RestoreHost
    database = $DatabaseName
    user = $AdminPrincipalName
    password = $token
  } | ConvertTo-Json -Compress
  $connectionEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($connection))
  $javascript = @'
const { Client } = require("pg");
(async () => {
  const connection = JSON.parse(Buffer.from("__CONNECTION__", "base64").toString("utf8"));
  const client = new Client({
    host: connection.host,
    port: 5432,
    database: connection.database,
    user: connection.user,
    password: connection.password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  const queries = {
    migrations: "SELECT count(*)::int AS count, max(migration_name) AS latest FROM public.meids_schema_migration",
    tenants: "SELECT count(*)::int AS count FROM identity.tenant",
    users: "SELECT count(*)::int AS count FROM identity.app_user",
    twins: "SELECT count(*)::int AS count FROM twin.twin",
    concepts: "SELECT count(*)::int AS count FROM knowledge.concept",
    increments: "SELECT count(*)::int AS count FROM learning.increment",
    outbox: "SELECT count(*)::int AS count FROM runtime.outbox_event",
  };
  const result = {};
  for (const [name, sql] of Object.entries(queries)) {
    result[name] = (await client.query(sql)).rows[0];
  }
  await client.end();
  console.log(JSON.stringify({ status: "restore_verified", ...result }));
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
'@
  $javascript = $javascript.Replace("__CONNECTION__", $connectionEncoded)
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($javascript))
  $command = "node -e `"eval(Buffer.from('$encoded','base64').toString('utf8'))`""
  $body = @{ command = $command; dir = "/home/site/wwwroot" } | ConvertTo-Json
  $result = Invoke-RestMethod `
    -Method Post `
    -Uri "https://$AppName.scm.azurewebsites.net/api/command" `
    -Headers $headers `
    -ContentType "application/json" `
    -Body $body `
    -TimeoutSec 180
  if ($result.Output) { Write-Output $result.Output.Trim() }
  if ($result.Error) { Write-Output $result.Error.Trim() }
  if ([int]$result.ExitCode -ne 0) { throw "Restore validation command failed." }
  Write-Output "RESTORE_VALIDATION_COMPLETE"
} finally {
  $token = $null
  $connection = $null
  $connectionEncoded = $null
  Write-Output "TEMP_RESTORE_TOKEN_DISCARDED"
}
