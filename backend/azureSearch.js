const crypto = require("node:crypto");

const DEFAULT_API_VERSION = "2025-09-01";
const DEFAULT_AZURE_OPENAI_API_VERSION = "2024-02-01";
const DEFAULT_APPROVED_INDEX = "meids-okf-approved-v1";
const DEFAULT_WORKING_INDEX = "meids-okf-working-v1";
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

function cleanBaseUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function azureSearchConfigFromEnv(env = process.env) {
  const endpoint = cleanBaseUrl(env.AZURE_SEARCH_ENDPOINT || env.AZURE_AI_SEARCH_ENDPOINT || "");
  const apiKey = String(env.AZURE_SEARCH_API_KEY || env.AZURE_AI_SEARCH_API_KEY || "").trim();
  const approvedIndex = String(env.AZURE_SEARCH_APPROVED_INDEX || DEFAULT_APPROVED_INDEX).trim();
  const workingIndex = String(env.AZURE_SEARCH_WORKING_INDEX || DEFAULT_WORKING_INDEX).trim();
  const apiVersion = String(env.AZURE_SEARCH_API_VERSION || DEFAULT_API_VERSION).trim();
  const embeddingDimensions = Number(env.AZURE_OPENAI_EMBEDDING_DIMENSIONS || DEFAULT_EMBEDDING_DIMENSIONS);
  const embeddingEndpoint = cleanBaseUrl(env.AZURE_OPENAI_ENDPOINT || "");
  const embeddingApiKey = String(env.AZURE_OPENAI_API_KEY || "").trim();
  const embeddingDeployment = String(env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || "").trim();
  const embeddingApiVersion = String(env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_OPENAI_API_VERSION).trim();
  const missing = [];
  if (!endpoint) missing.push("AZURE_SEARCH_ENDPOINT");
  if (!apiKey) missing.push("AZURE_SEARCH_API_KEY");
  if (!approvedIndex) missing.push("AZURE_SEARCH_APPROVED_INDEX");
  if (!workingIndex) missing.push("AZURE_SEARCH_WORKING_INDEX");
  const embeddingMissing = [];
  if (!embeddingEndpoint) embeddingMissing.push("AZURE_OPENAI_ENDPOINT");
  if (!embeddingApiKey) embeddingMissing.push("AZURE_OPENAI_API_KEY");
  if (!embeddingDeployment) embeddingMissing.push("AZURE_OPENAI_EMBEDDING_DEPLOYMENT");
  return {
    endpoint,
    apiKey,
    approvedIndex,
    workingIndex,
    apiVersion,
    embeddingDimensions,
    embeddingEndpoint,
    embeddingApiKey,
    embeddingDeployment,
    embeddingApiVersion,
    configured: missing.length === 0,
    embeddingConfigured: embeddingMissing.length === 0,
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
    approved_index: config.approvedIndex,
    working_index: config.workingIndex,
    api_version: config.apiVersion,
    embedding: {
      status: config.embeddingConfigured ? "configured" : "blocked",
      endpoint_configured: Boolean(config.embeddingEndpoint),
      deployment_configured: Boolean(config.embeddingDeployment),
      api_version: config.embeddingApiVersion,
      dimensions: config.embeddingDimensions,
      missing: config.embeddingMissing,
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

function stableVector(text, dimensions) {
  const hash = crypto.createHash("sha256").update(String(text || "")).digest();
  return Array.from({ length: dimensions }, (_, index) => {
    const byte = hash[index % hash.length];
    return Number((((byte / 255) * 2 - 1) / Math.sqrt(dimensions)).toFixed(8));
  });
}

function normalizeReviewState(value = "") {
  const normalized = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "approved") return "approved";
  if (normalized === "candidate") return "candidate";
  if (normalized === "pending-review" || normalized === "pending") return "pending-review";
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
  return {
    id: document.vector_doc_id || crypto.createHash("sha1").update(`${request.organization_id || "org"}:${request.twin_id}:${conceptId}:${chunkId}`).digest("hex"),
    organization_id: request.organization_id || metadata.organization_id || "default",
    user_id: request.user_id || metadata.user_id || "",
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
  const response = await fetch(`${config.endpoint}${path}${separator}api-version=${encodeURIComponent(config.apiVersion)}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "api-key": config.apiKey,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(data.error?.message || data.message || text || `Azure AI Search returned ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

async function azureOpenAiEmbedding(text, config = azureSearchConfigFromEnv()) {
  if (!config.embeddingConfigured) {
    const error = new Error(`Azure OpenAI embeddings are not configured: ${config.embeddingMissing.join(", ")}`);
    error.statusCode = 503;
    throw error;
  }
  const url = `${config.embeddingEndpoint}/openai/deployments/${encodeURIComponent(config.embeddingDeployment)}/embeddings?api-version=${encodeURIComponent(config.embeddingApiVersion)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": config.embeddingApiKey,
    },
    body: JSON.stringify({ input: String(text || "") }),
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    const error = new Error(data.error?.message || data.message || raw || `Azure OpenAI embeddings returned ${response.status}`);
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
  return { status: "upserted", operation: "upsert", document_count: docs.length, results };
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
      const stats = await azureSearchRequest(`/indexes/${encodeURIComponent(item.name)}/stats`, { method: "GET" }, config);
      return [key, { ...item, status: "ready", document_count: stats.documentCount ?? 0, storage_size: stats.storageSize ?? 0 }];
    } catch (error) {
      return [key, { ...item, status: "blocked", error: error.message, status_code: error.statusCode || 500 }];
    }
  }));
  return Object.fromEntries(checks);
}

async function searchVectorKnowledge(query = {}, config = azureSearchConfigFromEnv()) {
  const twinId = query.twin_id || query.twin || "";
  const organizationId = query.organization_id || "default";
  const includePending = query.source_policy === "selected_pending";
  const indexes = includePending ? [config.approvedIndex, config.workingIndex] : [config.approvedIndex];
  const body = {
    search: query.query || query.text || "*",
    top: Number(query.top || 5),
    filter: query.filter || buildActorTwinFilter({
      organizationId,
      twinId,
      includeShared: query.include_shared !== false,
      includePending,
    }),
    select: "id,organization_id,user_id,twin_id,visibility_scope,knowledge_state,okf_concept_id,okf_type,title,summary,chunk_text,repo_path,evidence_id,graph_node_id,graph_cluster_id,tags",
  };
  if (config.embeddingConfigured && String(query.query || query.text || "").trim()) {
    body.vectorQueries = [{
      kind: "vector",
      vector: await azureOpenAiEmbedding(query.query || query.text, config),
      fields: "content_vector",
      k: Number(query.k || query.top || 5),
    }];
    body.queryType = "semantic";
    body.semanticConfiguration = query.semantic_configuration || "okf-semantic";
    body.captions = "extractive";
    body.answers = "extractive";
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
    retrieval_mode: body.vectorQueries ? "hybrid_vector_semantic" : "keyword_only",
    source_policy: includePending ? "selected_pending" : "approved_only",
    filter: body.filter,
    results,
  };
}

module.exports = {
  DEFAULT_APPROVED_INDEX,
  DEFAULT_WORKING_INDEX,
  azureSearchConfigFromEnv,
  statusFromConfig,
  vectorDocumentFromOkf,
  buildActorTwinFilter,
  getIndexReadiness,
  upsertVectorDocuments,
  searchVectorKnowledge,
};
