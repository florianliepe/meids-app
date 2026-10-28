const { Client } = require("pg");

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  const client = new Client({
    host: required("DATABASE_HOST"),
    port: Number(process.env.DATABASE_PORT || 5432),
    database: process.env.DATABASE_NAME || "meids_prod",
    user: required("DATABASE_USER"),
    password: required("DATABASE_ACCESS_TOKEN"),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();
  try {
    const migration = await client.query(
      "SELECT migration_name, applied_at FROM public.meids_schema_migration WHERE migration_name = '017_runtime_background_jobs.sql'",
    );
    const relation = await client.query("SELECT to_regclass('runtime.background_job')::text AS relation");
    const indexes = await client.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'runtime' AND tablename = 'background_job' ORDER BY indexname",
    );
    const grant = await client.query(
      `SELECT has_table_privilege('meids_app_runtime', 'runtime.background_job', 'SELECT,INSERT,UPDATE,DELETE') AS runtime_grant`,
    );
    const jobs = await client.query("SELECT count(*)::int AS count FROM runtime.background_job");
    const result = {
      status: migration.rowCount === 1
        && relation.rows[0]?.relation === "runtime.background_job"
        && indexes.rowCount >= 4
        && grant.rows[0]?.runtime_grant === true
        ? "ready"
        : "blocked",
      migration: migration.rows[0] || null,
      relation: relation.rows[0]?.relation || null,
      indexes: indexes.rows.map((row) => row.indexname),
      runtime_grant: Boolean(grant.rows[0]?.runtime_grant),
      queued_job_count: jobs.rows[0]?.count ?? null,
    };
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "ready") process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
