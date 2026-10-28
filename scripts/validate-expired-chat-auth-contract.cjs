const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { signKnowledgeAccessToken, verifyKnowledgeAccessToken } = require("../backend/knowledgeAccess");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");
const server = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8");
const secret = "test-only-expired-chat-secret-with-sufficient-entropy";
const claims = {
  tenant_id: "eraneos",
  user_id: "uat-user",
  active_twin_id: "uat-twin",
  allowed_twin_ids: ["uat-twin"],
  visibility_scopes: ["private"],
};

const expired = signKnowledgeAccessToken(claims, { secret, ttlSeconds: 60 });
const parts = expired.split(".");
const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
payload.exp = Math.floor(Date.now() / 1000) - 1;
parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
const crypto = require("node:crypto");
parts[2] = crypto.createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest("base64url");

assert.throws(
  () => verifyKnowledgeAccessToken(parts.join("."), { secret }),
  (error) => error.statusCode === 401 && error.code === "blocked_auth_context" && /expired/.test(error.message),
);
assert.match(server, /error\.code = "blocked_auth_context"/);
assert.match(server, /\.\.\.\(error\.code \? \{ code: error\.code \} : \{\}\)/);
assert.match(app, /function blockedN8nAuthContext/);
assert.match(app, /refreshN8nChatAuthorizationContext\(\{ reconnect: true, reason: "expired" \}\)/);
assert.match(app, /The failed request was not replayed/);
assert.match(app, /error\.code = "blocked_auth_context"/);

console.log(JSON.stringify({
  status: "passed",
  scenarios: ["expired token", "structured blocked_auth_context", "automatic reconnect", "no request replay"],
}, null, 2));
