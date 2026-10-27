const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const statusPath = path.join(process.env.TEMP || "/tmp", "meids-migration-status.json");

function writeStatus(status) {
  fs.writeFileSync(statusPath, JSON.stringify({ ...status, checked_at: new Date().toISOString() }));
}

if (String(process.env.MEIDS_AUTO_MIGRATE || "").toLowerCase() === "true") {
  const migration = spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "run-postgres-migrations.cjs")], {
    cwd: path.join(__dirname, ".."),
    env: process.env,
    encoding: "utf8",
    timeout: 120_000,
  });
  const succeeded = migration.status === 0;
  writeStatus({ status: succeeded ? "applied" : "failed", exit_code: migration.status });
  process[succeeded ? "stdout" : "stderr"].write(JSON.stringify({
    event: "database_migration",
    status: succeeded ? "applied" : "failed",
    exit_code: migration.status,
    output: String(succeeded ? migration.stdout : migration.stderr || migration.stdout).slice(-4_000),
  }) + "\n");
} else {
  writeStatus({ status: "disabled" });
}

require("./server");
