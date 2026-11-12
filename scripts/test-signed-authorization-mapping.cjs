const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveSignedAuthorizationMapping } = require("../backend/server");

const access = {
  tenant_id: "eraneos",
  user_id: "4277841b-d713-47b6-8168-172ac3cde535",
  active_twin_id: "florian",
  allowed_twin_ids: ["florian", "removed-twin"],
  visibility_scopes: ["private", "twin_shared"],
  knowledge_scope: "active_twin",
};

test("signed Entra identity resolves to the internal application user and current twin grants", async () => {
  const pool = {
    async query(_sql, params) {
      assert.deepEqual(params, [access.tenant_id, access.user_id]);
      return { rows: [{
        user_id: "entra-4277841bd71347b68168172a",
        tenant_id: "eraneos",
        active_twin_id: "florian",
        allowed_twin_ids: ["florian", "current-other-twin"],
        roles: ["owner", "user"],
        group_ids: ["meids-users"],
      }] };
    },
  };
  const mapping = await resolveSignedAuthorizationMapping(access, pool);
  assert.equal(mapping.user_id, "entra-4277841bd71347b68168172a");
  assert.equal(mapping.external_user_id, access.user_id);
  assert.deepEqual(mapping.allowed_twin_ids, ["florian"]);
  assert.deepEqual(mapping.visibility_scopes, ["private", "twin_shared"]);
});

test("signed identity cannot retain a removed twin grant", async () => {
  const pool = {
    async query() {
      return { rows: [{
        user_id: "entra-4277841bd71347b68168172a",
        tenant_id: "eraneos",
        allowed_twin_ids: ["current-other-twin"],
        roles: ["user"],
        group_ids: [],
      }] };
    },
  };
  await assert.rejects(() => resolveSignedAuthorizationMapping(access, pool), (error) => {
    assert.equal(error.statusCode, 403);
    return /no longer has access/.test(error.message);
  });
});

test("unknown signed identity is rejected before persistence", async () => {
  const pool = { async query() { return { rows: [] }; } };
  await assert.rejects(() => resolveSignedAuthorizationMapping(access, pool), (error) => {
    assert.equal(error.statusCode, 403);
    return /no active Me\.IDs production mapping/.test(error.message);
  });
});
