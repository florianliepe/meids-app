const crypto = require("node:crypto");

const ACCESS_TOKEN_VERSION = 1;
const DEFAULT_TOKEN_TTL_SECONDS = 3600;
const MAX_TOKEN_TTL_SECONDS = 8 * 60 * 60;
const ALLOWED_VISIBILITY_SCOPES = new Set([
  "private",
  "twin_shared",
  "team_shared",
  "org_shared",
]);

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function readBase64UrlJson(value) {
  return JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
}

function signingKeyFromEnv(env = process.env) {
  const value = String(env.MEIDS_AUTH_CONTEXT_SIGNING_KEY || "").trim();
  if (!value || value.startsWith("@Microsoft.KeyVault(")) return "";
  return value;
}

function signKnowledgeAccessToken(claims, options = {}) {
  const secret = String(options.secret || signingKeyFromEnv(options.env)).trim();
  if (!secret) return "";
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Math.min(Number(options.ttlSeconds || DEFAULT_TOKEN_TTL_SECONDS), MAX_TOKEN_TTL_SECONDS));
  const header = base64UrlJson({ alg: "HS256", typ: "JWT", kid: "meids-knowledge-v1" });
  const payload = base64UrlJson({
    v: ACCESS_TOKEN_VERSION,
    iat: now,
    exp: now + ttl,
    jti: crypto.randomUUID(),
    ...normalizeAccessClaims(claims),
  });
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function verifyKnowledgeAccessToken(token, options = {}) {
  const secret = String(options.secret || signingKeyFromEnv(options.env)).trim();
  if (!secret) throw accessError("Knowledge access signing key is not configured.", 503);
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw accessError("Knowledge access token is malformed.", 401);
  const expected = crypto.createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  const supplied = Buffer.from(parts[2], "base64url");
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    throw accessError("Knowledge access token signature is invalid.", 401);
  }
  const claims = readBase64UrlJson(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (claims.v !== ACCESS_TOKEN_VERSION || !claims.exp || claims.exp <= now) {
    throw accessError("Knowledge access token is expired or unsupported.", 401);
  }
  return normalizeAccessClaims(claims);
}

function accessError(message, statusCode = 403) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function cleanId(value) {
  return String(value || "").trim().slice(0, 256);
}

function cleanIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanId).filter(Boolean))].slice(0, 200);
}

function normalizeAccessClaims(claims = {}) {
  const visibilityScopes = cleanIds(claims.visibility_scopes || claims.allowed_scopes)
    .filter((scope) => ALLOWED_VISIBILITY_SCOPES.has(scope));
  return {
    tenant_id: cleanId(claims.tenant_id || claims.organization_id),
    user_id: cleanId(claims.user_id || claims.sub),
    active_twin_id: cleanId(claims.active_twin_id || claims.twin_id),
    allowed_twin_ids: cleanIds(claims.allowed_twin_ids || claims.twin_ids),
    group_ids: cleanIds(claims.group_ids),
    roles: cleanIds(claims.roles).map((role) => role.toLowerCase()),
    visibility_scopes: visibilityScopes.length ? visibilityScopes : ["private"],
    knowledge_scope: claims.knowledge_scope === "all_assigned_twins" ? "all_assigned_twins" : "active_twin",
  };
}

function odataLiteral(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function searchIn(field, values) {
  const clean = cleanIds(values).map((value) => value.replace(/\|/g, "")).filter(Boolean);
  if (!clean.length) return "false";
  return `search.in(${field}, ${odataLiteral(clean.join("|"))}, '|')`;
}

function collectionSearchIn(field, values) {
  const clean = cleanIds(values).map((value) => value.replace(/\|/g, "")).filter(Boolean);
  if (!clean.length) return "false";
  return `${field}/any(item: search.in(item, ${odataLiteral(clean.join("|"))}, '|'))`;
}

function buildKnowledgeSecurityFilter(claims, options = {}) {
  const access = normalizeAccessClaims(claims);
  if (!access.tenant_id || !access.user_id || !access.allowed_twin_ids.length) {
    throw accessError("Knowledge access requires tenant, user, and assigned twin claims.", 403);
  }
  const activeTwin = access.allowed_twin_ids.includes(access.active_twin_id)
    ? access.active_twin_id
    : access.allowed_twin_ids[0];
  const twinIds = access.knowledge_scope === "all_assigned_twins"
    ? access.allowed_twin_ids
    : [activeTwin];
  const stateFilter = options.includePending
    ? "(knowledge_state eq 'approved' or knowledge_state eq 'pending-review' or knowledge_state eq 'candidate')"
    : "knowledge_state eq 'approved'";
  const scopeRules = [
    `(visibility_scope eq 'private' and ${searchIn("twin_id", twinIds)} and (owner_user_id eq ${odataLiteral(access.user_id)} or user_id eq ${odataLiteral(access.user_id)} or allowed_user_ids/any(user: user eq ${odataLiteral(access.user_id)})))`,
  ];
  if (access.visibility_scopes.includes("twin_shared")) {
    scopeRules.push(`(visibility_scope eq 'twin_shared' and ${searchIn("twin_id", twinIds)})`);
  }
  if (access.visibility_scopes.includes("team_shared") && access.group_ids.length) {
    scopeRules.push(`(visibility_scope eq 'team_shared' and ${collectionSearchIn("allowed_group_ids", access.group_ids)})`);
  }
  if (access.visibility_scopes.includes("org_shared")) {
    scopeRules.push("visibility_scope eq 'org_shared'");
  }
  return [
    `organization_id eq ${odataLiteral(access.tenant_id)}`,
    stateFilter,
    `(${searchIn("twin_id", twinIds)} or allowed_user_ids/any(user: user eq ${odataLiteral(access.user_id)}) or visibility_scope eq 'team_shared' or visibility_scope eq 'org_shared')`,
    `(${scopeRules.join(" or ")})`,
  ].join(" and ");
}

module.exports = {
  ACCESS_TOKEN_VERSION,
  signingKeyFromEnv,
  signKnowledgeAccessToken,
  verifyKnowledgeAccessToken,
  normalizeAccessClaims,
  buildKnowledgeSecurityFilter,
};
