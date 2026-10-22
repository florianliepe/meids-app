BEGIN;

CREATE TABLE IF NOT EXISTS identity.user_application_role (
  tenant_id text NOT NULL REFERENCES identity.tenant(tenant_id),
  user_id text NOT NULL REFERENCES identity.app_user(user_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'editor', 'admin', 'owner')),
  granted_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, role)
);

INSERT INTO identity.user_application_role (tenant_id, user_id, role, granted_by)
SELECT tenant_id, user_id, 'user', 'migration-008'
FROM identity.app_user
ON CONFLICT (tenant_id, user_id, role) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_user_application_role_user
  ON identity.user_application_role (tenant_id, user_id);

COMMIT;
