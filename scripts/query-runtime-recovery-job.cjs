const { Client } = require("pg");

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function managedIdentityToken() {
  const supplied = String(process.env.DATABASE_ACCESS_TOKEN || "").trim();
  if (supplied) return supplied;
  const endpoint = required("IDENTITY_ENDPOINT");
  const header = required("IDENTITY_HEADER");
  const url = new URL(endpoint);
  url.searchParams.set("api-version", "2019-08-01");
  url.searchParams.set("resource", "https://ossrdbms-aad.database.windows.net");
  const response = await fetch(url, { headers: { "X-IDENTITY-HEADER": header } });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error("Managed identity database token acquisition failed.");
  return payload.access_token;
}

async function main() {
  const jobId = String(process.argv[2] || process.env.MEIDS_RECOVERY_JOB_ID || "").trim();
  if (!jobId) throw new Error("A runtime job ID is required.");
  const client = new Client({
    host: required("DATABASE_HOST"),
    port: Number(process.env.DATABASE_PORT || 5432),
    database: process.env.DATABASE_NAME || "meids_prod",
    user: required("DATABASE_USER"),
    password: await managedIdentityToken(),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();
  try {
    const job = await client.query(
      `SELECT job_id, job_type, status, attempts, max_attempts, created_at, updated_at,
              leased_at, lease_expires_at, next_attempt_at, completed_at,
              CASE WHEN last_error IS NULL OR last_error = '' THEN NULL ELSE left(last_error, 500) END AS last_error,
              binary_payload IS NULL AS binary_payload_purged
       FROM runtime.background_job WHERE job_id = $1`,
      [jobId],
    );
    const ledger = await client.query(
      `SELECT action, created_at, details->>'status' AS status,
              details->>'summary' AS summary, details->>'attempts' AS attempts
       FROM audit.event
       WHERE resource_type = 'agent.skill_run' AND resource_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [jobId],
    );
    console.log(JSON.stringify({
      generated_at: new Date().toISOString(),
      job: job.rows[0] || null,
      ledger: ledger.rows[0] || null,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
