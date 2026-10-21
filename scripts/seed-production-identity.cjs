const { Client } = require("pg");

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function twinIds() {
  const values = String(process.env.MEIDS_SEED_TWIN_IDS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(values)];
}

async function main() {
  const tenantId = required("MEIDS_SEED_TENANT_ID").toLowerCase();
  const tenantName = required("MEIDS_SEED_TENANT_NAME");
  const userId = required("MEIDS_SEED_USER_ID").toLowerCase();
  const entraObjectId = required("MEIDS_SEED_ENTRA_OBJECT_ID").toLowerCase();
  const email = required("MEIDS_SEED_USER_EMAIL").toLowerCase();
  const displayName = required("MEIDS_SEED_USER_DISPLAY_NAME");
  const twins = twinIds();
  const client = new Client({
    host: required("POSTGRES_ADMIN_HOST"),
    port: Number(process.env.POSTGRES_ADMIN_PORT || 5432),
    database: process.env.DATABASE_NAME || "meids_prod",
    user: required("POSTGRES_ADMIN_USER"),
    password: required("POSTGRES_ADMIN_ACCESS_TOKEN"),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15_000,
  });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO identity.tenant (tenant_id, display_name, status)
      VALUES ($1, $2, 'active')
      ON CONFLICT (tenant_id) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'active'
    `, [tenantId, tenantName]);
    await client.query(`
      INSERT INTO identity.app_user
        (user_id, tenant_id, entra_object_id, email, display_name, status, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'active', now())
      ON CONFLICT (user_id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        entra_object_id = EXCLUDED.entra_object_id,
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        status = 'active',
        updated_at = now()
    `, [userId, tenantId, entraObjectId, email, displayName]);

    for (const twinId of twins) {
      const twinName = twinId === userId ? displayName : `${twinId[0].toUpperCase()}${twinId.slice(1)} (Demo)`;
      await client.query(`
        INSERT INTO twin.twin (twin_id, tenant_id, owner_user_id, display_name, status, updated_at)
        VALUES ($1, $2, $3, $4, 'active', now())
        ON CONFLICT (twin_id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          owner_user_id = EXCLUDED.owner_user_id,
          display_name = EXCLUDED.display_name,
          status = 'active',
          updated_at = now()
      `, [twinId, tenantId, userId, twinName]);
      await client.query(`
        INSERT INTO twin.user_twin_access (tenant_id, user_id, twin_id, access_role, granted_by)
        VALUES ($1, $2, $3, 'owner', $2)
        ON CONFLICT (tenant_id, user_id, twin_id) DO UPDATE SET
          access_role = 'owner',
          granted_by = EXCLUDED.granted_by
      `, [tenantId, userId, twinId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }

  process.stdout.write(`${JSON.stringify({
    status: "completed",
    tenant_id: tenantId,
    user_id: userId,
    entra_object_id: entraObjectId,
    twin_ids: twins,
    access_role: twins.length ? "owner" : "viewer",
    next_action: twins.length ? "Use an assigned twin." : "Sign in and create the first owned twin.",
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
