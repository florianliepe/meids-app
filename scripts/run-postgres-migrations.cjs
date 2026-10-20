const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool } = require("pg");

async function main() {
  const connectionString = String(process.env.DATABASE_URL || "").trim();
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const pool = new Pool({
    connectionString,
    ssl: String(process.env.DATABASE_SSL || "true").toLowerCase() === "true"
      ? { rejectUnauthorized: true }
      : false,
    max: 1,
  });
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
