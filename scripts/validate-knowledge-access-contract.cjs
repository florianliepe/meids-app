const assert = require("node:assert/strict");
const {
  signKnowledgeAccessToken,
  verifyKnowledgeAccessToken,
  buildKnowledgeSecurityFilter,
} = require("../backend/knowledgeAccess");

const secret = "test-only-signing-secret-with-sufficient-entropy";
const claims = {
  tenant_id: "eraneos",
  user_id: "4277841b-d713-47b6-8168-172ac3cde535",
  active_twin_id: "florian",
  allowed_twin_ids: ["florian", "lucas"],
  group_ids: ["team-cargo"],
  roles: ["viewer"],
  visibility_scopes: ["private", "twin_shared", "team_shared", "org_shared"],
  knowledge_scope: "active_twin",
};

const token = signKnowledgeAccessToken(claims, { secret });
assert.ok(token.split(".").length === 3, "signed access token must use compact JWT shape");
assert.deepEqual(verifyKnowledgeAccessToken(token, { secret }), claims);

const ownFilter = buildKnowledgeSecurityFilter(claims);
assert.match(ownFilter, /organization_id eq 'eraneos'/);
assert.match(ownFilter, /owner_user_id eq '4277841b-d713-47b6-8168-172ac3cde535'/);
assert.match(ownFilter, /search\.in\(twin_id, 'florian', '\|'\)/);
assert.doesNotMatch(ownFilter, /lucas/);
assert.match(ownFilter, /allowed_group_ids/);
assert.match(
  ownFilter,
  /visibility_scope eq 'private' and search\.in\(twin_id, 'florian', '\|'\)/,
  "private knowledge must remain scoped to the active twin",
);

const overarching = buildKnowledgeSecurityFilter({ ...claims, knowledge_scope: "all_assigned_twins" });
assert.match(overarching, /florian\|lucas/);
assert.match(overarching, /allowed_user_ids\/any/);

const pending = buildKnowledgeSecurityFilter(claims, { includePending: true });
assert.match(pending, /pending-review/);

assert.throws(
  () => buildKnowledgeSecurityFilter({ tenant_id: "eraneos", user_id: "user", allowed_twin_ids: [] }),
  /assigned twin claims/,
);

const tokenParts = token.split(".");
const tamperedToken = `${tokenParts[0]}.${tokenParts[1]}.${tokenParts[2][0] === "A" ? "B" : "A"}${tokenParts[2].slice(1)}`;
assert.throws(
  () => verifyKnowledgeAccessToken(tamperedToken, { secret }),
  /signature is invalid/,
);

console.log(JSON.stringify({
  status: "passed",
  contract: "meids.knowledge-access.v1",
  scenarios: ["user-owned knowledge", "assigned-twin overarching knowledge", "team and organization sharing"],
}, null, 2));
