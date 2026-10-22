const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool } = require("pg");

const POSTGRES_TOKEN_RESOURCE = "https://ossrdbms-aad.database.windows.net";

async function managedIdentityToken() {
  const endpoint = String(process.env.IDENTITY_ENDPOINT || "").trim();
  const identityHeader = String(process.env.IDENTITY_HEADER || "").trim();
  if (!endpoint || !identityHeader) throw new Error("App Service managed identity endpoint is unavailable for PostgreSQL migrations.");
  const url = new URL(endpoint);
  url.searchParams.set("resource", POSTGRES_TOKEN_RESOURCE);
  url.searchParams.set("api-version", "2019-08-01");
  const clientId = String(process.env.POSTGRES_MANAGED_IDENTITY_CLIENT_ID || "").trim();
  if (clientId) url.searchParams.set("client_id", clientId);
  const response = await fetch(url, {
    headers: { "X-IDENTITY-HEADER": identityHeader, Metadata: "true" },
    signal: AbortSignal.timeout(10_000),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || raw || `Managed identity token request returned ${response.status}`);
  }
  return data.access_token;
}

async function poolOptions() {
  const connectionString = String(process.env.DATABASE_URL || "").trim();
  const authMode = String(process.env.POSTGRES_AUTH_MODE || "").toLowerCase();
  const managedIdentity = authMode === "managed_identity";
  const ssl = String(process.env.DATABASE_SSL || "true").toLowerCase() === "true"
    ? { rejectUnauthorized: true }
    : false;
  if (managedIdentity) {
    const required = ["DATABASE_HOST", "DATABASE_USER"].filter((name) => !String(process.env[name] || "").trim());
    if (required.length) throw new Error(`${required.join(", ")} required for managed-identity migrations.`);
    return {
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT || 5432),
      database: process.env.DATABASE_NAME || "meids_prod",
      user: process.env.DATABASE_USER,
      password: await managedIdentityToken(),
      ssl,
      max: 1,
    };
  }
  if (authMode === "access_token") {
    const required = ["DATABASE_HOST", "DATABASE_USER", "DATABASE_ACCESS_TOKEN"].filter((name) => !String(process.env[name] || "").trim());
    if (required.length) throw new Error(`${required.join(", ")} required for access-token migrations.`);
    return {
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT || 5432),
      database: process.env.DATABASE_NAME || "meids_prod",
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_ACCESS_TOKEN,
      ssl,
      max: 1,
    };
  }
  if (!connectionString) throw new Error("DATABASE_URL or POSTGRES_AUTH_MODE=managed_identity is required.");
  return { connectionString, ssl, max: 1 };
}

async function main() {
  const pool = new Pool(await poolOptions());
  const directory = path.resolve(__dirname, "..", "backend", "migrations");
  const files = (await fs.readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.meids_schema_migration (
      migration_name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const file of files) {
      const sql = await fs.readFile(path.join(directory, file), "utf8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      const existing = await client.query("SELECT checksum FROM public.meids_schema_migration WHERE migration_name = $1", [file]);
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${file}`);
        process.stdout.write(`skip ${file}\n`);
        continue;
      }
      await client.query(sql);
      await client.query("INSERT INTO public.meids_schema_migration (migration_name, checksum) VALUES ($1, $2)", [file, checksum]);
      process.stdout.write(`applied ${file}\n`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
