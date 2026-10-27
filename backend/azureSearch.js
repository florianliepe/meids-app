const crypto = require("node:crypto");
const { buildKnowledgeSecurityFilter } = require("./knowledgeAccess");
const http = require("node:http");
const https = require("node:https");

const DEFAULT_API_VERSION = "2025-09-01";
const DEFAULT_AZURE_OPENAI_API_VERSION = "2024-02-01";
const DEFAULT_APPROVED_INDEX = "meids-okf-approved-v1";
const DEFAULT_WORKING_INDEX = "meids-okf-working-v1";
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_SEMANTIC_CONFIGURATION = "meids-semantic";
const SEARCH_TOKEN_RESOURCE = "https://search.azure.com";
const COGNITIVE_SERVICES_TOKEN_RESOURCE = "https://cognitiveservices.azure.com";
const MANAGED_IDENTITY_API_VERSION = "2019-08-01";

const managedIdentityTokenCache = new Map();
const managedIdentityTokenPromises = new Map();

function cleanBaseUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function cleanGatewayEmbeddingBaseUrl(value = "") {
  return cleanBaseUrl(value).replace(/\/embeddings$/i, "");
}

function normalizeSearchAuthMode(value = "") {
  return String(value || "api_key").trim().toLowerCase() === "managed_identity"
    ? "managed_identity"
    : "api_key";
}

function normalizeEmbeddingAuthMode(value = "") {
  return String(value || "api_key").trim().toLowerCase() === "managed_identity"
    ? "managed_identity"
    : "api_key";
}

function normalizeEmbeddingProvider(value = "") {
  return String(value || "azure_openai").trim().toLowerCase() === "eraneos_gateway"
    ? "eraneos_gateway"
    : "azure_openai";
}

function azureSearchConfigFromEnv(env = process.env) {
  const endpoint = cleanBaseUrl(env.AZURE_SEARCH_ENDPOINT || env.AZURE_AI_SEARCH_ENDPOINT || "");
  const apiKey = String(env.AZURE_SEARCH_API_KEY || env.AZURE_AI_SEARCH_API_KEY || "").trim();
  const authMode = normalizeSearchAuthMode(env.AZURE_SEARCH_AUTH_MODE);
  const identityEndpoint = cleanBaseUrl(env.IDENTITY_ENDPOINT || "");
  const identityHeader = String(env.IDENTITY_HEADER || "").trim();
  const identityClientId = String(env.AZURE_SEARCH_MANAGED_IDENTITY_CLIENT_ID || "").trim();
  const approvedIndex = String(env.AZURE_SEARCH_APPROVED_INDEX || DEFAULT_APPROVED_INDEX).trim();
  const workingIndex = String(env.AZURE_SEARCH_WORKING_INDEX || DEFAULT_WORKING_INDEX).trim();
  const apiVersion = String(env.AZURE_SEARCH_API_VERSION || DEFAULT_API_VERSION).trim();
  const requestTimeoutMs = Math.max(1000, Number(env.AZURE_SEARCH_REQUEST_TIMEOUT_MS || 10000));
  const embeddingDimensions = Number(env.AZURE_OPENAI_EMBEDDING_DIMENSIONS || DEFAULT_EMBEDDING_DIMENSIONS);
  const embeddingProvider = normalizeEmbeddingProvider(env.MEIDS_EMBEDDING_PROVIDER);
  const embeddingEndpoint = embeddingProvider === "eraneos_gateway"
    ? cleanGatewayEmbeddingBaseUrl(env.ERANEOS_AI_GATEWAY_BASE_URL || env.OPENAI_BASE_URL || "")
    : cleanBaseUrl(env.AZURE_OPENAI_ENDPOINT || "");
  const embeddingApiKey = String(embeddingProvider === "eraneos_gateway"
    ? env.ERANEOS_AI_GATEWAY_API_KEY || env.OPENAI_API_KEY || ""
    : env.AZURE_OPENAI_API_KEY || "").trim();
  const embeddingAuthMode = normalizeEmbeddingAuthMode(env.AZURE_OPENAI_AUTH_MODE);
  const embeddingDeployment = String(embeddingProvider === "eraneos_gateway"
    ? env.ERANEOS_AI_GATEWAY_EMBEDDING_MODEL || env.OPENAI_EMBEDDING_MODEL || ""
    : env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || "").trim();
  const embeddingApiVersion = String(env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_OPENAI_API_VERSION).trim();
  const deterministicVectorsAllowed = ["true", "1", "yes", "on"].includes(String(env.MEIDS_ALLOW_DETERMINISTIC_VECTORS || "").trim().toLowerCase());
  const missing = [];
  if (!endpoint) missing.push("AZURE_SEARCH_ENDPOINT");
  if (authMode === "managed_identity") {
    if (!identityEndpoint) missing.push("IDENTITY_ENDPOINT");
    if (!identityHeader) missing.push("IDENTITY_HEADER");
  } else if (!apiKey) {
    missing.push("AZURE_SEARCH_API_KEY");
  }
  if (!approvedIndex) missing.push("AZURE_SEARCH_APPROVED_INDEX");
  if (!workingIndex) missing.push("AZURE_SEARCH_WORKING_INDEX");
  const embeddingMissing = [];
  if (!embeddingEndpoint) embeddingMissing.push(embeddingProvider === "eraneos_gateway" ? "ERANEOS_AI_GATEWAY_BASE_URL" : "AZURE_OPENAI_ENDPOINT");
  if (embeddingProvider === "azure_openai" && embeddingAuthMode === "managed_identity") {
    if (!identityEndpoint) embeddingMissing.push("IDENTITY_ENDPOINT");
    if (!identityHeader) embeddingMissing.push("IDENTITY_HEADER");
  } else if (!embeddingApiKey) {
    embeddingMissing.push(embeddingProvider === "eraneos_gateway" ? "ERANEOS_AI_GATEWAY_API_KEY" : "AZURE_OPENAI_API_KEY");
  }
  if (!embeddingDeployment) embeddingMissing.push(embeddingProvider === "eraneos_gateway" ? "ERANEOS_AI_GATEWAY_EMBEDDING_MODEL" : "AZURE_OPENAI_EMBEDDING_DEPLOYMENT");
  return {
    endpoint,
    apiKey,
    authMode,
    identityEndpoint,
    identityHeader,
    identityClientId,
    approvedIndex,
    workingIndex,
    apiVersion,
    requestTimeoutMs,
    embeddingDimensions,
    embeddingProvider,
    embeddingEndpoint,
    embeddingApiKey,
    embeddingAuthMode,
    embeddingDeployment,
    embeddingApiVersion,
    configured: missing.length === 0,
    embeddingConfigured: embeddingMissing.length === 0,
    deterministicVectorsAllowed,
    missing,
    embeddingMissing,
  };
}

function statusFromConfig(config = azureSearchConfigFromEnv()) {
  return {
    status: config.configured ? "configured" : "blocked",
    available: config.configured,
    provider: "azure_ai_search",
    endpoint_configured: Boolean(config.endpoint),
    api_key_configured: Boolean(config.apiKey),
    authentication: {
      mode: config.authMode || "api_key",
      managed_identity_endpoint_available: Boolean(config.identityEndpoint && config.identityHeader),
      user_assigned_identity: Boolean(config.identityClientId),
    },
    approved_index: config.approvedIndex,
    working_index: config.workingIndex,
    api_version: config.apiVersion,
    request_timeout_ms: config.requestTimeoutMs,
    embedding: {
      status: config.embeddingConfigured ? "configured" : "blocked",
      provider: config.embeddingProvider || "azure_openai",
      endpoint_configured: Boolean(config.embeddingEndpoint),
      deployment_configured: Boolean(config.embeddingDeployment),
      authentication_mode: config.embeddingAuthMode || "api_key",
      api_version: config.embeddingApiVersion,
      dimensions: config.embeddingDimensions,
      missing: config.embeddingMissing,
    },
    vector_fallback: {
      deterministic_vectors_allowed: Boolean(config.deterministicVectorsAllowed),
      use: "uat_only_when_azure_openai_embeddings_are_unavailable",
    },
    missing: config.missing,
    policy: {
      default_answer_scope: "approved_private_plus_org_shared",
      approved_visibility: ["private", "org_shared", "team_shared"],
      working_visibility: ["private", "team_shared"],
      cross_twin_sharing: "approved_org_shared_only",
    },
  };
}

function tokenExpiryMillis(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric * 1000;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Date.now() + 5 * 60 * 1000;
}

function requestManagedIdentityToken(tokenUrl, identityHeader, timeoutMs = 10000) {
  const client = tokenUrl.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.get(tokenUrl, {
      headers: {
        "X-IDENTITY-HEADER": identityHeader,
        Metadata: "true",
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode || 500,
        text: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Managed identity token request timed out after ${timeoutMs} ms`));
    });
    request.on("error", reject);
  });
}

function requestHttpText(targetUrl, options = {}, timeoutMs = 10000) {
  const client = targetUrl.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(targetUrl, {
      method: options.method || "GET",
      headers: options.headers || {},
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode || 500,
        text: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`HTTP request timed out after ${timeoutMs} ms`));
    });
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function managedIdentityAccessToken(config = azureSearchConfigFromEnv(), resource = SEARCH_TOKEN_RESOURCE) {
  if (!config.identityEndpoint || !config.identityHeader) {
    const error = new Error("App Service managed identity endpoint is unavailable.");
    error.statusCode = 503;
    throw error;
  }
  const cacheKey = `${config.identityEndpoint}:${config.identityClientId || "system"}:${resource}`;
  const cached = managedIdentityTokenCache.get(cacheKey);
  if (cached?.accessToken && cached.expiresAt > Date.now() + 60 * 1000) return cached.accessToken;
  if (managedIdentityTokenPromises.has(cacheKey)) return managedIdentityTokenPromises.get(cacheKey);
  const tokenPromise = (async () => {
    const tokenUrl = new URL(config.identityEndpoint);
    tokenUrl.searchParams.set("resource", resource);
    tokenUrl.searchParams.set("api-version", MANAGED_IDENTITY_API_VERSION);
    if (config.identityClientId) tokenUrl.searchParams.set("client_id", config.identityClientId);
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await requestManagedIdentityToken(tokenUrl, config.identityHeader, config.requestTimeoutMs);
        const text = response.text;
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = {};
        }
        if (response.status < 200 || response.status >= 300 || !data.access_token) {
          const error = new Error(data.error_description || data.error || text || `Managed identity token request returned ${response.status}`);
          error.statusCode = response.status || 502;
          throw error;
        }
        managedIdentityTokenCache.set(cacheKey, {
          accessToken: data.access_token,
          expiresAt: tokenExpiryMillis(data.expires_on),
        });
        return data.access_token;
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
        }
      }
    }
    throw lastError;
  })();
  managedIdentityTokenPromises.set(cacheKey, tokenPromise);
  try {
    return await tokenPromise;
  } finally {
    managedIdentityTokenPromises.delete(cacheKey);
  }
}

async function azureSearchAuthHeaders(config = azureSearchConfigFromEnv()) {
  if (config.authMode === "managed_identity") {
    return { Authorization: `Bearer ${await managedIdentityAccessToken(config)}` };
  }
  return { "api-key": config.apiKey };
}

function stableVector(text, dimensions) {
  const hash = crypto.createHash("sha256").update(String(text || "")).digest();
  return Array.from({ length: dimensions }, (_, index) => {
    const byte = hash[index % hash.length];
    return Number((((byte / 255) * 2 - 1) / Math.sqrt(dimensions)).toFixed(8));
  });
}

function deterministicVectorFromText(text, dimensions = DEFAULT_EMBEDDING_DIMENSIONS) {
  return stableVector(text, Number(dimensions || DEFAULT_EMBEDDING_DIMENSIONS));
}

function deterministicVectorsRequested(request = {}, config = azureSearchConfigFromEnv()) {
  const mode = String(request.vector_mode || request.embedding_mode || "").trim().toLowerCase();
  return Boolean(
    config.deterministicVectorsAllowed
    || request.allow_deterministic_vectors === true
    || request.allowDeterministicVectors === true
    || mode === "deterministic_fallback"
    || mode === "deterministic_hash_fallback"
  );
}

function normalizeReviewState(value = "") {
  const normalized = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "approved") return "approved";
  if (normalized === "candidate") return "candidate";
  if (["pending-review", "pending", "review-needed", "updated", "draft"].includes(normalized)) return "pending-review";
  return normalized || "pending-review";
}

function targetIndexForDocument(document = {}, config = azureSearchConfigFromEnv()) {
  return normalizeReviewState(document.review_state) === "approved" ? config.approvedIndex : config.workingIndex;
}

function vectorDocumentFromOkf(document = {}, request = {}, options = {}) {
  const dimensions = Number(options.embeddingDimensions || DEFAULT_EMBEDDING_DIMENSIONS);
  const metadata = document.metadata || {};
  const conceptId = document.concept_id || document.okf_concept_id || document.id || "";
  const repoPath = document.repo_path || "";
  const text = document.text || document.summary || document.title || "";
  const chunkId = document.chunk_id || "chunk-0001";
  const reviewState = normalizeReviewState(document.review_state);
  const visibility = metadata.visibility_scope || document.visibility_scope || (reviewState === "approved" ? "private" : "private");
  const ownerUserId = metadata.owner_user_id || document.owner_user_id || request.user_id || metadata.user_id || "";
  const allowedUserIds = Array.isArray(metadata.allowed_user_ids)
    ? metadata.allowed_user_ids
    : Array.isArray(document.allowed_user_ids) ? document.allowed_user_ids : [];
  const allowedGroupIds = Array.isArray(metadata.allowed_group_ids)
    ? metadata.allowed_group_ids
    : Array.isArray(document.allowed_group_ids) ? document.allowed_group_ids : [];
  return {
    id: document.vector_doc_id || crypto.createHash("sha1").update(`${request.organization_id || "org"}:${request.twin_id}:${conceptId}:${chunkId}`).digest("hex"),
    organization_id: request.organization_id || metadata.organization_id || "default",
    user_id: request.user_id || metadata.user_id || "",
    owner_user_id: ownerUserId,
    allowed_user_ids: [...new Set([ownerUserId, ...allowedUserIds].filter(Boolean))],
    allowed_group_ids: [...new Set(allowedGroupIds.filter(Boolean))],
    acl_version: metadata.acl_version || document.acl_version || "v1",
    twin_id: request.twin_id || document.twin_id || "",
    visibility_scope: visibility,
    knowledge_state: reviewState,
    okf_concept_id: conceptId,
    okf_type: metadata.type || document.okf_type || "",
    title: document.title || metadata.title || conceptId,
    summary: document.summary || text.slice(0, 500),
    chunk_id: chunkId,
    chunk_text: text,
    source_type: metadata.source_type || document.source_type || "okf_markdown",
    repo_name: metadata.repo_name || request.repo_name || "",
    repo_path: repoPath,
    commit_sha: metadata.commit_sha || request.commit_sha || "",
    evidence_id: Array.isArray(metadata.evidence_refs) ? metadata.evidence_refs[0] || "" : "",
    graph_node_id: metadata.graph_node_id || "",
    graph_cluster_id: metadata.cluster || "",
    tags: Array.isArray(metadata.tags) ? metadata.tags : [metadata.cluster, metadata.type].filter(Boolean),
    permission_tags: Array.isArray(metadata.permission_tags) ? metadata.permission_tags : [],
    created_at: document.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    content_vector: Array.isArray(options.contentVector)
      ? options.contentVector
      : Array.isArray(document.content_vector)
        ? document.content_vector
        : stableVector(text, dimensions),
  };
}

function buildActorTwinFilter({ organizationId = "default", twinId = "", includeShared = true, includePending = false } = {}) {
  const stateFilter = includePending
    ? "(knowledge_state eq 'approved' or knowledge_state eq 'pending-review' or knowledge_state eq 'candidate')"
    : "knowledge_state eq 'approved'";
  const visibility = includeShared
    ? `(twin_id eq '${escapeFilterValue(twinId)}' or visibility_scope eq 'org_shared' or visibility_scope eq 'team_shared')`
    : `twin_id eq '${escapeFilterValue(twinId)}'`;
  return `organization_id eq '${escapeFilterValue(organizationId)}' and ${stateFilter} and ${visibility}`;
}

function escapeFilterValue(value) {
  return String(value || "").replace(/'/g, "''");
}

async function azureSearchRequest(path, options = {}, config = azureSearchConfigFromEnv()) {
  if (!config.configured) {
    const error = new Error(`Azure AI Search is not configured: ${config.missing.join(", ")}`);
    error.statusCode = 503;
    throw error;
  }
  const separator = path.includes("?") ? "&" : "?";
  const targetUrl = new URL(`${config.endpoint}${path}${separator}api-version=${encodeURIComponent(config.apiVersion)}`);
  const response = await requestHttpText(targetUrl, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(await azureSearchAuthHeaders(config)),
      ...(options.headers || {}),
    },
    body: options.body,
  }, Number(config.requestTimeoutMs || 10000));
  const text = response.text;
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(data.error?.message || data.message || text || `Azure AI Search returned ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

const MAX_EMBEDDING_INPUT_CHARACTERS = 24_000;

function boundedEmbeddingInput(text) {
  const value = String(text || "");
  if (value.length <= MAX_EMBEDDING_INPUT_CHARACTERS) return value;
  return value.slice(0, MAX_EMBEDDING_INPUT_CHARACTERS);
}

async function azureOpenAiEmbedding(text, config = azureSearchConfigFromEnv()) {
  if (!config.embeddingConfigured) {
    const error = new Error(`Azure OpenAI embeddings are not configured: ${config.embeddingMissing.join(", ")}`);
    error.statusCode = 503;
    throw error;
  }
  const isGateway = config.embeddingProvider === "eraneos_gateway";
  const url = isGateway
    ? `${config.embeddingEndpoint}/embeddings`
    : `${config.embeddingEndpoint}/openai/deployments/${encodeURIComponent(config.embeddingDeployment)}/embeddings?api-version=${encodeURIComponent(config.embeddingApiVersion)}`;
  const authHeaders = isGateway
    ? { Authorization: `Bearer ${config.embeddingApiKey}` }
    : config.embeddingAuthMode === "managed_identity"
      ? { Authorization: `Bearer ${await managedIdentityAccessToken(config, COGNITIVE_SERVICES_TOKEN_RESOURCE)}` }
      : { "api-key": config.embeddingApiKey };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({
      input: boundedEmbeddingInput(text),
      ...(isGateway ? { model: config.embeddingDeployment, dimensions: config.embeddingDimensions } : {}),
    }),
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    const error = new Error(data.error?.message || data.message || raw || `${isGateway ? "Eraneos AI Gateway" : "Azure OpenAI"} embeddings returned ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  const vector = data.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== Number(config.embeddingDimensions)) {
    const error = new Error(`Embedding vector dimension mismatch. Expected ${config.embeddingDimensions}, got ${Array.isArray(vector) ? vector.length : "none"}.`);
    error.statusCode = 502;
    throw error;
  }
  return vector;
}

async function enrichVectorDocument(document = {}, request = {}, config = azureSearchConfigFromEnv()) {
  if (Array.isArray(document.content_vector)) {
    return vectorDocumentFromOkf(document, request, { embeddingDimensions: config.embeddingDimensions });
  }
  if (deterministicVectorsRequested(request, config)) {
    return vectorDocumentFromOkf({
      ...document,
      metadata: {
        ...(document.metadata || {}),
        embedding_provider: "deterministic_hash_fallback",
      },
    }, request, { embeddingDimensions: config.embeddingDimensions });
  }
  const text = document.text || document.summary || document.title || "";
  const contentVector = await azureOpenAiEmbedding(text, config);
  return vectorDocumentFromOkf(document, request, {
    embeddingDimensions: config.embeddingDimensions,
    contentVector,
  });
}

async function upsertVectorDocuments(request = {}, config = azureSearchConfigFromEnv()) {
  const inputDocuments = request.documents || [];
  const docs = [];
  for (const document of inputDocuments) {
    docs.push(await enrichVectorDocument(document, request, config));
  }
  const byIndex = docs.reduce((acc, doc, index) => {
    const target = targetIndexForDocument(inputDocuments[index], config);
    acc[target] = acc[target] || [];
    acc[target].push({ ...doc, "@search.action": "mergeOrUpload" });
    return acc;
  }, {});
  const results = [];
  for (const [indexName, value] of Object.entries(byIndex)) {
    const data = await azureSearchRequest(`/indexes/${encodeURIComponent(indexName)}/docs/index`, {
      method: "POST",
      body: JSON.stringify({ value }),
    }, config);
    results.push({ index: indexName, count: value.length, result: data });
  }
  const suppliedCount = inputDocuments.filter((document) => Array.isArray(document.content_vector)).length;
  const embeddingProvider = suppliedCount === inputDocuments.length
    ? "caller_supplied_vectors"
    : deterministicVectorsRequested(request, config)
      ? "deterministic_hash_fallback"
      : config.embeddingProvider || "azure_openai";
  return {
    status: "upserted",
    operation: "upsert",
    document_count: docs.length,
    embedding: {
      provider: embeddingProvider,
      dimensions: config.embeddingDimensions,
      caller_supplied_vectors: suppliedCount,
      deterministic_fallback: embeddingProvider === "deterministic_hash_fallback",
    },
    results,
  };
}

async function deleteVectorDocuments(indexName, documentIds = [], config = azureSearchConfigFromEnv()) {
  const ids = [...new Set(documentIds.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!ids.length) return { status: "completed", operation: "delete", document_count: 0, index: indexName };
  const data = await azureSearchRequest(`/indexes/${encodeURIComponent(indexName)}/docs/index`, {
    method: "POST",
    body: JSON.stringify({ value: ids.map((id) => ({ id, "@search.action": "delete" })) }),
  }, config);
  return { status: "completed", operation: "delete", document_count: ids.length, index: indexName, result: data };
}

async function getIndexReadiness(config = azureSearchConfigFromEnv()) {
  const base = {
    approved: { name: config.approvedIndex, status: "unknown" },
    working: { name: config.workingIndex, status: "unknown" },
  };
  if (!config.configured) {
    return {
      ...base,
      approved: { ...base.approved, status: "blocked", missing: config.missing },
      working: { ...base.working, status: "blocked", missing: config.missing },
    };
  }
  const checks = await Promise.all(Object.entries(base).map(async ([key, item]) => {
    try {
      if (config.authMode === "managed_identity") {
        const result = await azureSearchRequest(`/indexes/${encodeURIComponent(item.name)}/docs/search`, {
          method: "POST",
          body: JSON.stringify({
            search: "*",
            count: true,
            top: 1,
            select: "id",
          }),
        }, config);
        return [key, {
          ...item,
          status: "ready",
          validation: "document_query",
          document_count: result["@odata.count"] ?? 0,
        }];
      }
      const stats = await azureSearchRequest(`/indexes/${encodeURIComponent(item.name)}/stats`, { method: "GET" }, config);
      return [key, {
        ...item,
        status: "ready",
        validation: "index_statistics",
        document_count: stats.documentCount ?? 0,
        storage_size: stats.storageSize ?? 0,
      }];
    } catch (error) {
      return [key, { ...item, status: "blocked", error: error.message, status_code: error.statusCode || 500 }];
    }
  }));
  return Object.fromEntries(checks);
}

async function searchVectorKnowledge(query = {}, config = azureSearchConfigFromEnv()) {
  const includePending = query.source_policy === "selected_pending";
  const indexes = includePending ? [config.approvedIndex, config.workingIndex] : [config.approvedIndex];
  const queryText = String(query.query || query.text || "").trim();
  const pureVectorScoring = query.score_mode === "vector_similarity";
  const body = {
    top: Number(query.top || 5),
    filter: query.access_context
      ? buildKnowledgeSecurityFilter(query.access_context, { includePending })
      : buildActorTwinFilter({
        organizationId: query.organization_id || "default",
        twinId: query.twin_id || query.twin || "",
        includeShared: query.include_shared !== false,
        includePending,
      }),
    select: "id,organization_id,user_id,twin_id,visibility_scope,knowledge_state,okf_concept_id,okf_type,title,summary,chunk_text,repo_path,evidence_id,graph_node_id,graph_cluster_id,tags",
  };
  if (!pureVectorScoring) body.search = query.query || query.text || "*";
  let retrievalMode = "keyword_only";
  if (config.embeddingConfigured && queryText) {
    body.vectorQueries = [{
      kind: "vector",
      vector: await azureOpenAiEmbedding(queryText, config),
      fields: "content_vector",
      k: Number(query.k || query.top || 5),
    }];
    if (pureVectorScoring) {
      retrievalMode = "pure_vector_similarity";
    } else {
      body.queryType = "semantic";
      body.semanticConfiguration = query.semantic_configuration || DEFAULT_SEMANTIC_CONFIGURATION;
      body.captions = "extractive";
      body.answers = "extractive";
      retrievalMode = "hybrid_vector_semantic";
    }
  }
  if (!body.vectorQueries && Array.isArray(query.query_vector)) {
    body.vectorQueries = [{
      kind: "vector",
      vector: query.query_vector,
      fields: "content_vector",
      k: Number(query.k || query.top || 5),
    }];
    retrievalMode = "hybrid_caller_vector_keyword";
  }
  if (!body.vectorQueries && queryText && deterministicVectorsRequested(query, config)) {
    body.vectorQueries = [{
      kind: "vector",
      vector: deterministicVectorFromText(queryText, config.embeddingDimensions),
      fields: "content_vector",
      k: Number(query.k || query.top || 5),
    }];
    retrievalMode = "hybrid_deterministic_vector_keyword";
  }
  const results = [];
  for (const indexName of indexes) {
    const data = await azureSearchRequest(`/indexes/${encodeURIComponent(indexName)}/docs/search`, {
      method: "POST",
      body: JSON.stringify(body),
    }, config);
    results.push({
      index: indexName,
      count: Array.isArray(data.value) ? data.value.length : 0,
      value: Array.isArray(data.value) ? data.value : [],
    });
  }
  return {
    status: "completed",
    provider: "azure_ai_search",
    retrieval_mode: retrievalMode,
    source_policy: includePending ? "selected_pending" : "approved_only",
    filter: body.filter,
    results,
  };
}

module.exports = {
  DEFAULT_SEMANTIC_CONFIGURATION,
  DEFAULT_APPROVED_INDEX,
  DEFAULT_WORKING_INDEX,
  azureSearchConfigFromEnv,
  statusFromConfig,
  managedIdentityAccessToken,
  boundedEmbeddingInput,
  deterministicVectorFromText,
  vectorDocumentFromOkf,
  buildActorTwinFilter,
  getIndexReadiness,
  upsertVectorDocuments,
  deleteVectorDocuments,
  searchVectorKnowledge,
};
