const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { Client } = require("pg");

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function decodeJwtClaims(token) {
  const payload = String(token || "").split(".")[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function migrationChecksums(sql) {
  const canonicalSql = String(sql).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const checksum = (value) => crypto.createHash("sha256").update(value).digest("hex");
  return {
    canonicalSql,
    canonical: checksum(canonicalSql),
    acceptedLegacy: new Set([
      checksum(sql),
      checksum(canonicalSql.replace(/\n/g, "\r\n")),
    ]),
  };
}

const knownLegacyMigrationChecksums = new Map([
  ["006_knowledge_persistence_outbox.sql", "87e4fee33c23297393d1f7cc88385fe9b8307394670d003a47b3ef756ca4c0d2"],
]);

async function verifyKnownLegacyMigration(client, file, checksum) {
  if (knownLegacyMigrationChecksums.get(file) !== checksum) return false;
  const expectedColumns = [
    ["knowledge", "concept", "approved_revision"],
    ["knowledge", "concept_revision", "blob_uri"],
    ["knowledge", "concept_revision", "checksum"],
    ["learning", "increment", "blob_uri"],
    ["runtime", "outbox_event", "dedupe_key"],
    ["runtime", "outbox_event", "next_attempt_at"],
    ["runtime", "outbox_event", "last_error"],
    ["runtime", "outbox_event", "locked_at"],
    ["runtime", "outbox_event", "locked_by"],
  ];
  for (const [schema, table, column] of expectedColumns) {
    const result = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
      [schema, table, column],
    );
    if (!result.rowCount) return false;
  }
  const reviewTable = await client.query("SELECT to_regclass('knowledge.review_action') AS relation");
  if (!reviewTable.rows[0]?.relation) return false;
  const expectedIndexes = ["idx_outbox_dedupe_key", "idx_outbox_pending", "idx_review_action_concept"];
  for (const indexName of expectedIndexes) {
    const result = await client.query("SELECT 1 FROM pg_indexes WHERE indexname = $1", [indexName]);
    if (!result.rowCount) return false;
  }
  const expectedPolicies = ["source_access", "concept_delta_access", "review_action_read", "review_action_write"];
  for (const policyName of expectedPolicies) {
    const result = await client.query("SELECT 1 FROM pg_policies WHERE policyname = $1", [policyName]);
    if (!result.rowCount) return false;
  }
  return true;
}

function clientConfig(database) {
  return {
    host: required("POSTGRES_ADMIN_HOST"),
    port: Number(process.env.POSTGRES_ADMIN_PORT || 5432),
    database,
    user: required("POSTGRES_ADMIN_USER"),
    password: required("POSTGRES_ADMIN_ACCESS_TOKEN"),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15_000,
  };
}

async function withClient(database, callback) {
  const client = new Client(clientConfig(database));
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function ensureRuntimePrincipal() {
  const principalName = required("POSTGRES_RUNTIME_PRINCIPAL_NAME");
  const objectId = required("POSTGRES_RUNTIME_PRINCIPAL_OBJECT_ID").toLowerCase();
  await withClient("postgres", async (client) => {
    const mappings = await client.query("SELECT * FROM pg_catalog.pgaadauth_list_principals(false)");
    const mapping = mappings.rows.find((row) => String(row.rolename || row.roleName || "") === principalName);
    if (!mapping) {
      const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [principalName]);
      if (role.rowCount) {
        await client.query(
          `SECURITY LABEL for "pgaadauth" on role ${quoteIdentifier(principalName)} is 'aadauth,oid=${objectId},type=service'`,
        );
        return;
      }
      await client.query(
        "SELECT * FROM pg_catalog.pgaadauth_create_principal_with_oid($1, $2, 'service', false, false)",
        [principalName, objectId],
      );
      return;
    }
    const mappedObjectId = String(mapping.objectid || mapping.objectId || "").toLowerCase();
    const mappedPrincipalType = String(mapping.principaltype || mapping.principalType || "").toLowerCase();
    if (mappedObjectId !== objectId || mappedPrincipalType !== "service") {
      throw new Error(
        `Existing Entra mapping for ${principalName} does not match the managed identity object ID or service principal type.`,
      );
    }
  });
}

async function managedIdentityAccessToken() {
  const endpoint = String(process.env.IDENTITY_ENDPOINT || "").trim();
  const identityHeader = String(process.env.IDENTITY_HEADER || "").trim();
  if (!endpoint || !identityHeader) return "";
  const url = new URL(endpoint);
  url.searchParams.set("resource", "https://ossrdbms-aad.database.windows.net");
  url.searchParams.set("api-version", "2019-08-01");
  const response = await fetch(url, {
    headers: { "X-IDENTITY-HEADER": identityHeader, Metadata: "true" },
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Managed identity token request returned ${response.status}`);
  }
  return data.access_token;
}

async function verifyRuntimePrincipalLogin() {
  const token = await managedIdentityAccessToken();
  if (!token) return false;
  const claims = decodeJwtClaims(token);
  const expectedObjectId = required("POSTGRES_RUNTIME_PRINCIPAL_OBJECT_ID").toLowerCase();
  const tokenObjectId = String(claims.oid || claims.sub || "").toLowerCase();
  if (tokenObjectId !== expectedObjectId) {
    throw new Error(`Managed identity token object ID ${tokenObjectId || "missing"} does not match ${expectedObjectId}.`);
  }
  const client = new Client({
    host: required("POSTGRES_ADMIN_HOST"),
    port: Number(process.env.POSTGRES_ADMIN_PORT || 5432),
    database: process.env.DATABASE_NAME || "meids_prod",
    user: required("POSTGRES_RUNTIME_PRINCIPAL_NAME"),
    password: token,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    await client.end();
  }
  return true;
}

async function applyMigrations() {
  const database = process.env.DATABASE_NAME || "meids_prod";
  const principalName = required("POSTGRES_RUNTIME_PRINCIPAL_NAME");
  const directory = path.resolve(__dirname, "..", "backend", "migrations");
  const files = (await fs.readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  await withClient(database, async (client) => {
    await client.query(`CREATE TABLE IF NOT EXISTS public.meids_schema_migration (
      migration_name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const file of files) {
      const sql = await fs.readFile(path.join(directory, file), "utf8");
      const checksums = migrationChecksums(sql);
      const existing = await client.query(
        "SELECT checksum FROM public.meids_schema_migration WHERE migration_name = $1",
        [file],
      );
      if (existing.rows[0]) {
        const storedChecksum = existing.rows[0].checksum;
        const verifiedKnownLegacy = await verifyKnownLegacyMigration(client, file, storedChecksum);
        if (
          storedChecksum !== checksums.canonical
          && !checksums.acceptedLegacy.has(storedChecksum)
          && !verifiedKnownLegacy
        ) {
          throw new Error(
            `Applied migration changed: ${file} (stored=${storedChecksum}, canonical=${checksums.canonical})`,
          );
        }
        if (storedChecksum !== checksums.canonical) {
          await client.query(
            "UPDATE public.meids_schema_migration SET checksum = $2 WHERE migration_name = $1",
            [file, checksums.canonical],
          );
          process.stdout.write(`normalized checksum ${file}\n`);
        }
        process.stdout.write(`skip ${file}\n`);
        continue;
      }
      await client.query(checksums.canonicalSql);
      await client.query(
        "INSERT INTO public.meids_schema_migration (migration_name, checksum) VALUES ($1, $2)",
        [file, checksums.canonical],
      );
      process.stdout.write(`applied ${file}\n`);
    }
    await client.query(`GRANT meids_app_runtime TO ${quoteIdentifier(principalName)}`);
  });
}

async function main() {
  await ensureRuntimePrincipal();
  await applyMigrations();
  const runtimeLoginVerified = await verifyRuntimePrincipalLogin();
  process.stdout.write(JSON.stringify({
    status: "completed",
    database: process.env.DATABASE_NAME || "meids_prod",
    runtime_principal: required("POSTGRES_RUNTIME_PRINCIPAL_NAME"),
    runtime_login_verified: runtimeLoginVerified,
    runtime_login_verification: runtimeLoginVerified ? "scm_managed_identity" : "deferred_to_app_health_probe",
    credential_persisted: false,
  }, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
