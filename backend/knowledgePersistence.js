const crypto = require("node:crypto");
const {
  azureSearchConfigFromEnv,
  upsertVectorDocuments,
  deleteVectorDocuments,
} = require("./azureSearch");

const STORAGE_RESOURCE = "https://storage.azure.com/";
const STORAGE_API_VERSION = "2023-11-03";
const MAX_OUTBOX_ATTEMPTS = 8;

let storageToken = { value: "", expiresAt: 0 };

function cleanText(value, max = 20_000) {
  return String(value || "").trim().slice(0, max);
}

function canonicalKey(value) {
  return cleanText(value, 200)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

function checksum(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function searchDocumentId(tenantId, twinId, conceptId, revision, ordinal = 0) {
  return crypto.createHash("sha256").update(`${tenantId}:${twinId}:${conceptId}:${revision}:${ordinal}`).digest("hex");
}

function assertTwinAccess(mapping, twinId) {
  const allowed = Array.isArray(mapping.allowed_twin_ids) ? mapping.allowed_twin_ids : [];
  if (!twinId || !allowed.includes(twinId)) {
    const error = new Error("The selected twin is not assigned to the signed-in user.");
    error.statusCode = 403;
    throw error;
  }
}

async function setRequestContext(client, mapping) {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [mapping.tenant_id]);
  await client.query("SELECT set_config('app.user_id', $1, true)", [mapping.user_id]);
  await client.query("SELECT set_config('app.allowed_twin_ids', $1, true)", [(mapping.allowed_twin_ids || []).join(",")]);
  await client.query("SELECT set_config('app.group_ids', $1, true)", [(mapping.group_ids || []).join(",")]);
}

function normalizedConcept(body, mapping) {
  const source = body.concept && typeof body.concept === "object" ? body.concept : body;
  const twinId = cleanText(source.twin_id || body.twin_id || mapping.active_twin_id, 128);
  assertTwinAccess(mapping, twinId);
  const title = cleanText(source.title || source.topic, 300);
  if (!title) {
    const error = new Error("Knowledge concept title is required.");
    error.statusCode = 400;
    throw error;
  }
  const key = canonicalKey(source.canonical_key || title);
  const content = {
    topic: cleanText(source.topic || title, 1_000),
    purpose: cleanText(source.purpose, 10_000),
    wider_context: cleanText(source.wider_context || source.context, 20_000),
    how_to_apply: cleanText(source.how_to_apply || source.application, 40_000),
    what_else_to_know: cleanText(source.what_else_to_know || source.notes, 40_000),
    implications_and_results: cleanText(source.implications_and_results || source.what_then, 20_000),
    summary: cleanText(source.summary, 10_000),
    tags: Array.isArray(source.tags) ? source.tags.map((tag) => cleanText(tag, 100)).filter(Boolean).slice(0, 50) : [],
    relations: Array.isArray(source.relations) ? source.relations.slice(0, 100) : [],
    raw: source.raw && typeof source.raw === "object" ? source.raw : {},
  };
  const chunkText = [content.topic, content.purpose, content.wider_context, content.how_to_apply, content.what_else_to_know, content.implications_and_results]
    .filter(Boolean)
    .join("\n\n");
  return {
    twinId,
    title,
    key,
    content,
    chunkText: chunkText || title,
    visibilityScope: ["private", "twin_shared", "team_shared", "org_shared"].includes(source.visibility_scope)
      ? source.visibility_scope
      : "private",
    changeReason: cleanText(source.change_reason || body.change_reason || "Knowledge Fabric staging", 2_000),
    source: body.source && typeof body.source === "object" ? body.source : {},
    evidence: Array.isArray(body.evidence) ? body.evidence.slice(0, 100) : [],
    contentVector: Array.isArray(source.content_vector) ? source.content_vector : null,
  };
}

async function stageKnowledge(pool, mapping, body = {}) {
  const conceptInput = normalizedConcept(body, mapping);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setRequestContext(client, mapping);
    const existing = await client.query(
      `SELECT * FROM knowledge.concept WHERE tenant_id = $1 AND twin_id = $2 AND canonical_key = $3 FOR UPDATE`,
      [mapping.tenant_id, conceptInput.twinId, conceptInput.key],
    );
    const current = existing.rows[0];
    const revision = current ? Number(current.current_revision) + 1 : 1;
    const state = current ? "updated" : "review_needed";
    const conceptResult = current
      ? await client.query(
        `UPDATE knowledge.concept
         SET title = $4, visibility_scope = $5, review_state = $6, current_revision = $7, updated_at = now()
         WHERE tenant_id = $1 AND twin_id = $2 AND canonical_key = $3
         RETURNING *`,
        [mapping.tenant_id, conceptInput.twinId, conceptInput.key, conceptInput.title, conceptInput.visibilityScope, state, revision],
      )
      : await client.query(
        `INSERT INTO knowledge.concept
          (tenant_id, owner_user_id, twin_id, canonical_key, title, visibility_scope, review_state, current_revision)
         VALUES ($1, $2, $3, $4, $5, $6, 'review_needed', 1)
         RETURNING *`,
        [mapping.tenant_id, mapping.user_id, conceptInput.twinId, conceptInput.key, conceptInput.title, conceptInput.visibilityScope],
      );
    const concept = conceptResult.rows[0];
    let sourceId = null;
    if (Object.keys(conceptInput.source).length) {
      const sourcePayload = JSON.stringify(conceptInput.source);
      const source = await client.query(
        `INSERT INTO knowledge.source
          (tenant_id, owner_user_id, twin_id, source_type, repository_ref, checksum, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING source_id`,
        [mapping.tenant_id, mapping.user_id, conceptInput.twinId, cleanText(conceptInput.source.type || "agent_interaction", 100), cleanText(conceptInput.source.repository_ref, 1_000) || null, checksum(sourcePayload), sourcePayload],
      );
      sourceId = source.rows[0].source_id;
    }
    const revisionChecksum = checksum(conceptInput.content);
    await client.query(
      `INSERT INTO knowledge.concept_revision
        (concept_id, revision, tenant_id, owner_user_id, twin_id, content, change_reason, created_by, checksum)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $4, $8)`,
      [concept.concept_id, revision, mapping.tenant_id, mapping.user_id, conceptInput.twinId, JSON.stringify(conceptInput.content), conceptInput.changeReason, revisionChecksum],
    );
    const documentId = searchDocumentId(mapping.tenant_id, conceptInput.twinId, concept.concept_id, revision);
    const chunk = await client.query(
      `INSERT INTO knowledge.chunk
        (concept_id, revision, tenant_id, owner_user_id, twin_id, chunk_ordinal, chunk_text, search_document_id, content_vector)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8::jsonb)
       RETURNING chunk_id`,
      [concept.concept_id, revision, mapping.tenant_id, mapping.user_id, conceptInput.twinId, conceptInput.chunkText, documentId, conceptInput.contentVector ? JSON.stringify(conceptInput.contentVector) : null],
    );
    const evidenceIds = [];
    for (const item of conceptInput.evidence) {
      const evidence = await client.query(
        `INSERT INTO knowledge.evidence
          (concept_id, tenant_id, owner_user_id, twin_id, source_id, citation, confidence)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         RETURNING evidence_id`,
        [concept.concept_id, mapping.tenant_id, mapping.user_id, conceptInput.twinId, sourceId, JSON.stringify(item.citation || item), Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null],
      );
      evidenceIds.push(evidence.rows[0].evidence_id);
    }
    const document = {
      vector_doc_id: documentId,
      concept_id: concept.concept_id,
      chunk_id: chunk.rows[0].chunk_id,
      twin_id: conceptInput.twinId,
      title: conceptInput.title,
      summary: conceptInput.content.summary || conceptInput.content.purpose || conceptInput.chunkText.slice(0, 500),
      text: conceptInput.chunkText,
      review_state: state,
      visibility_scope: conceptInput.visibilityScope,
      owner_user_id: mapping.user_id,
      content_vector: conceptInput.contentVector,
      metadata: {
        type: "okf_concept",
        source_type: conceptInput.source.type || "agent_interaction",
        evidence_refs: evidenceIds,
        tags: conceptInput.content.tags,
        owner_user_id: mapping.user_id,
        visibility_scope: conceptInput.visibilityScope,
      },
    };
    const payload = {
      organization_id: mapping.tenant_id,
      user_id: mapping.user_id,
      twin_id: conceptInput.twinId,
      revision,
      checksum: revisionChecksum,
      document,
      artifact: { container: "okf-working", path: `${mapping.tenant_id}/${conceptInput.twinId}/${concept.concept_id}/revision-${revision}.json`, content: conceptInput.content },
    };
    await client.query(
      `INSERT INTO runtime.outbox_event
        (tenant_id, aggregate_type, aggregate_id, event_type, payload, dedupe_key)
       VALUES ($1, 'knowledge.concept', $2, 'knowledge.revision.staged', $3::jsonb, $4)`,
      [mapping.tenant_id, concept.concept_id, JSON.stringify(payload), `knowledge:${concept.concept_id}:${revision}:staged`],
    );
    await client.query(
      `INSERT INTO audit.event (tenant_id, actor_user_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, 'knowledge.stage', 'knowledge.concept', $3, $4::jsonb)`,
      [mapping.tenant_id, mapping.user_id, concept.concept_id, JSON.stringify({ revision, review_state: state })],
    );
    await client.query("COMMIT");
    return { status: "staged", concept_id: concept.concept_id, revision, review_state: state, outbox_status: "pending" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function stageLearning(pool, mapping, body = {}) {
  const twinId = cleanText(body.twin_id || mapping.active_twin_id, 128);
  assertTwinAccess(mapping, twinId);
  const summary = cleanText(body.summary || body.source_interaction_summary, 20_000);
  if (!summary) {
    const error = new Error("Learning increment summary is required.");
    error.statusCode = 400;
    throw error;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setRequestContext(client, mapping);
    const increment = await client.query(
      `INSERT INTO learning.increment
        (tenant_id, owner_user_id, twin_id, trace_id, increment_type, summary, payload, review_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'review_needed')
       RETURNING increment_id`,
      [mapping.tenant_id, mapping.user_id, twinId, cleanText(body.trace_id, 256) || null, cleanText(body.increment_type || "agent_learning", 100), summary, JSON.stringify(body.payload || body)],
    );
    const incrementId = increment.rows[0].increment_id;
    for (const delta of Array.isArray(body.concept_deltas) ? body.concept_deltas.slice(0, 100) : []) {
      const operation = ["create", "update", "merge", "relate"].includes(delta.operation) ? delta.operation : "create";
      await client.query(
        `INSERT INTO learning.concept_delta (increment_id, concept_id, operation, delta)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [incrementId, delta.concept_id || null, operation, JSON.stringify(delta.delta || delta)],
      );
    }
    const payload = {
      organization_id: mapping.tenant_id,
      user_id: mapping.user_id,
      twin_id: twinId,
      increment_id: incrementId,
      artifact: { container: "learning-artifacts", path: `${mapping.tenant_id}/${twinId}/${incrementId}.json`, content: body },
    };
    await client.query(
      `INSERT INTO runtime.outbox_event
        (tenant_id, aggregate_type, aggregate_id, event_type, payload, dedupe_key)
       VALUES ($1, 'learning.increment', $2, 'learning.increment.staged', $3::jsonb, $4)`,
      [mapping.tenant_id, incrementId, JSON.stringify(payload), `learning:${incrementId}:staged`],
    );
    await client.query("COMMIT");
    return { status: "staged", increment_id: incrementId, review_state: "review_needed", outbox_status: "pending" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function promoteKnowledge(pool, mapping, body = {}) {
  const conceptId = cleanText(body.concept_id, 128);
  const revision = Number(body.revision);
  if (!conceptId || !Number.isInteger(revision) || revision < 1) {
    const error = new Error("concept_id and a positive revision are required.");
    error.statusCode = 400;
    throw error;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setRequestContext(client, mapping);
    const record = await client.query(
      `SELECT concept_row.*, revision_row.content, revision_row.checksum,
        chunk.chunk_id, chunk.chunk_text, chunk.search_document_id, chunk.content_vector
       FROM knowledge.concept concept_row
       JOIN knowledge.concept_revision revision_row ON revision_row.concept_id = concept_row.concept_id AND revision_row.revision = $2
       JOIN knowledge.chunk chunk ON chunk.concept_id = concept_row.concept_id AND chunk.revision = $2 AND chunk.chunk_ordinal = 0
       JOIN twin.user_twin_access access ON access.tenant_id = concept_row.tenant_id AND access.twin_id = concept_row.twin_id
       WHERE concept_row.concept_id = $1 AND access.user_id = $3 AND access.access_role IN ('owner', 'reviewer')
       FOR UPDATE`,
      [conceptId, revision, mapping.user_id],
    );
    const concept = record.rows[0];
    if (!concept) {
      const error = new Error("Concept revision not found or reviewer access is missing.");
      error.statusCode = 404;
      throw error;
    }
    await client.query(
      `UPDATE knowledge.concept SET review_state = 'approved', approved_revision = $2, updated_at = now() WHERE concept_id = $1`,
      [conceptId, revision],
    );
    await client.query(
      `INSERT INTO knowledge.review_action (tenant_id, concept_id, revision, action, actor_user_id, rationale)
       VALUES ($1, $2, $3, 'approve', $4, $5)`,
      [mapping.tenant_id, conceptId, revision, mapping.user_id, cleanText(body.rationale, 5_000) || null],
    );
    const document = {
      vector_doc_id: concept.search_document_id,
      concept_id: conceptId,
      chunk_id: concept.chunk_id,
      twin_id: concept.twin_id,
      title: concept.title,
      summary: concept.content.summary || concept.content.purpose || concept.chunk_text.slice(0, 500),
      text: concept.chunk_text,
      review_state: "approved",
      visibility_scope: concept.visibility_scope,
      owner_user_id: concept.owner_user_id,
      content_vector: Array.isArray(concept.content_vector) ? concept.content_vector : null,
      metadata: { type: "okf_concept", owner_user_id: concept.owner_user_id, visibility_scope: concept.visibility_scope, tags: concept.content.tags || [] },
    };
    const payload = {
      organization_id: mapping.tenant_id,
      user_id: mapping.user_id,
      twin_id: concept.twin_id,
      revision,
      document,
      artifact: { container: "okf-approved", path: `${mapping.tenant_id}/${concept.twin_id}/${conceptId}/revision-${revision}.json`, content: concept.content },
    };
    await client.query(
      `INSERT INTO runtime.outbox_event
        (tenant_id, aggregate_type, aggregate_id, event_type, payload, dedupe_key)
       VALUES ($1, 'knowledge.concept', $2, 'knowledge.revision.approved', $3::jsonb, $4)
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [mapping.tenant_id, conceptId, JSON.stringify(payload), `knowledge:${conceptId}:${revision}:approved`],
    );
    await client.query("COMMIT");
    return { status: "approved", concept_id: conceptId, revision, outbox_status: "pending" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function rejectKnowledge(pool, mapping, body = {}) {
  const conceptId = cleanText(body.concept_id, 128);
  const revision = Number(body.revision);
  if (!conceptId || !Number.isInteger(revision) || revision < 1) {
    const error = new Error("concept_id and a positive revision are required.");
    error.statusCode = 400;
    throw error;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setRequestContext(client, mapping);
    const record = await client.query(
      `SELECT concept_row.*, chunk.search_document_id
       FROM knowledge.concept concept_row
       JOIN knowledge.concept_revision revision_row
         ON revision_row.concept_id = concept_row.concept_id AND revision_row.revision = $2
       JOIN knowledge.chunk chunk
         ON chunk.concept_id = concept_row.concept_id AND chunk.revision = $2 AND chunk.chunk_ordinal = 0
       JOIN twin.user_twin_access access
         ON access.tenant_id = concept_row.tenant_id AND access.twin_id = concept_row.twin_id
       WHERE concept_row.concept_id = $1
         AND access.user_id = $3
         AND access.access_role IN ('owner', 'reviewer')
       FOR UPDATE`,
      [conceptId, revision, mapping.user_id],
    );
    const concept = record.rows[0];
    if (!concept) {
      const error = new Error("Concept revision not found or reviewer access is missing.");
      error.statusCode = 404;
      throw error;
    }
    await client.query(
      `UPDATE knowledge.concept
       SET review_state = 'rejected', updated_at = now()
       WHERE concept_id = $1`,
      [conceptId],
    );
    await client.query(
      `INSERT INTO knowledge.review_action (tenant_id, concept_id, revision, action, actor_user_id, rationale)
       VALUES ($1, $2, $3, 'reject', $4, $5)`,
      [mapping.tenant_id, conceptId, revision, mapping.user_id, cleanText(body.rationale, 5_000) || null],
    );
    const payload = {
      organization_id: mapping.tenant_id,
      user_id: mapping.user_id,
      twin_id: concept.twin_id,
      revision,
      document: { vector_doc_id: concept.search_document_id },
    };
    await client.query(
      `INSERT INTO runtime.outbox_event
        (tenant_id, aggregate_type, aggregate_id, event_type, payload, dedupe_key)
       VALUES ($1, 'knowledge.concept', $2, 'knowledge.revision.rejected', $3::jsonb, $4)
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [mapping.tenant_id, conceptId, JSON.stringify(payload), `knowledge:${conceptId}:${revision}:rejected`],
    );
    await client.query(
      `INSERT INTO audit.event (tenant_id, actor_user_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, 'knowledge.reject', 'knowledge.concept', $3, $4::jsonb)`,
      [mapping.tenant_id, mapping.user_id, conceptId, JSON.stringify({ revision, review_state: "rejected" })],
    );
    await client.query("COMMIT");
    return { status: "rejected", concept_id: conceptId, revision, review_state: "rejected", outbox_status: "pending" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function backfillKnowledgeSearch(pool, mapping, body = {}) {
  const allowedRoles = new Set(["admin", "owner", "reviewer", "knowledge_curator"]);
  if (!(mapping.roles || []).some((role) => allowedRoles.has(String(role).toLowerCase()))) {
    const error = new Error("Search backfill requires a knowledge curator or reviewer role.");
    error.statusCode = 403;
    throw error;
  }
  const twinIds = Array.isArray(body.twin_ids) && body.twin_ids.length
    ? body.twin_ids.map((value) => cleanText(value, 128)).filter((value) => (mapping.allowed_twin_ids || []).includes(value))
    : mapping.allowed_twin_ids || [];
  if (!twinIds.length) {
    const error = new Error("Search backfill requires at least one assigned twin.");
    error.statusCode = 400;
    throw error;
  }
  const client = await pool.connect();
  let rows = [];
  try {
    await client.query("BEGIN");
    await setRequestContext(client, mapping);
    const result = await client.query(`
      SELECT concept.concept_id, concept.title, concept.visibility_scope,
        concept.review_state, concept.owner_user_id, concept.twin_id,
        concept.current_revision, concept.approved_revision,
        revision.revision, revision.content,
        chunk.chunk_id, chunk.chunk_text, chunk.search_document_id, chunk.content_vector
      FROM knowledge.concept concept
      JOIN knowledge.concept_revision revision
        ON revision.concept_id = concept.concept_id
        AND revision.revision IN (concept.current_revision, concept.approved_revision)
      JOIN knowledge.chunk chunk
        ON chunk.concept_id = concept.concept_id
        AND chunk.revision = revision.revision
        AND chunk.chunk_ordinal = 0
      WHERE concept.tenant_id = $1
        AND concept.twin_id = ANY($2::text[])
      ORDER BY concept.concept_id, revision.revision
    `, [mapping.tenant_id, twinIds]);
    rows = result.rows;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const config = azureSearchConfigFromEnv();
  const documents = [];
  const deferred = [];
  for (const row of rows) {
    const approved = Number(row.revision) === Number(row.approved_revision);
    const contentVector = Array.isArray(row.content_vector) ? row.content_vector : null;
    if (!contentVector && !config.embeddingConfigured && !config.deterministicVectorsAllowed) {
      deferred.push({ concept_id: row.concept_id, revision: row.revision, reason: "missing_embedding" });
      continue;
    }
    documents.push({
      vector_doc_id: row.search_document_id,
      concept_id: row.concept_id,
      chunk_id: row.chunk_id,
      twin_id: row.twin_id,
      title: row.title,
      summary: row.content?.summary || row.content?.purpose || row.chunk_text.slice(0, 500),
      text: row.chunk_text,
      review_state: approved ? "approved" : "pending-review",
      visibility_scope: row.visibility_scope,
      owner_user_id: row.owner_user_id,
      content_vector: contentVector,
      metadata: {
        type: "okf_concept",
        owner_user_id: row.owner_user_id,
        visibility_scope: row.visibility_scope,
        tags: row.content?.tags || [],
        source_type: "postgres_backfill",
      },
    });
  }
  const result = documents.length
    ? await upsertVectorDocuments({
      organization_id: mapping.tenant_id,
      user_id: mapping.user_id,
      documents,
    }, config)
    : { status: "no_projectable_documents", document_count: 0, results: [] };
  return {
    status: deferred.length ? "completed_with_deferred" : "completed",
    tenant_id: mapping.tenant_id,
    twin_ids: twinIds,
    source_rows: rows.length,
    projected_documents: documents.length,
    deferred_documents: deferred.length,
    deferred,
    projection: result,
  };
}

async function storageAccessToken() {
  if (storageToken.value && storageToken.expiresAt > Date.now() + 60_000) return storageToken.value;
  const endpoint = cleanText(process.env.IDENTITY_ENDPOINT, 2_000);
  const identityHeader = cleanText(process.env.IDENTITY_HEADER, 2_000);
  if (!endpoint || !identityHeader) throw new Error("App Service managed identity endpoint is unavailable for Blob Storage.");
  const url = new URL(endpoint);
  url.searchParams.set("resource", STORAGE_RESOURCE);
  url.searchParams.set("api-version", "2019-08-01");
  const response = await fetch(url, { headers: { "X-IDENTITY-HEADER": identityHeader, Metadata: "true" }, signal: AbortSignal.timeout(10_000) });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || raw || `Storage token request returned ${response.status}`);
  const numericExpiry = Number(data.expires_on);
  storageToken = { value: data.access_token, expiresAt: Number.isFinite(numericExpiry) ? numericExpiry * 1000 : Date.now() + 5 * 60_000 };
  return storageToken.value;
}

async function putArtifact(artifact = {}) {
  const account = cleanText(process.env.MEIDS_STORAGE_ACCOUNT_NAME, 128);
  if (!account) throw new Error("MEIDS_STORAGE_ACCOUNT_NAME is required for artifact projection.");
  const container = encodeURIComponent(cleanText(artifact.container, 128));
  const blobPath = cleanText(artifact.path, 2_000).split("/").map(encodeURIComponent).join("/");
  const body = JSON.stringify(artifact.content || {}, null, 2);
  const response = await fetch(`https://${account}.blob.core.windows.net/${container}/${blobPath}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${await storageAccessToken()}`,
      "x-ms-version": STORAGE_API_VERSION,
      "x-ms-date": new Date().toUTCString(),
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": "application/json; charset=utf-8",
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error((await response.text()) || `Blob upload returned ${response.status}`);
  return `https://${account}.blob.core.windows.net/${container}/${blobPath}`;
}

async function projectEvent(event) {
  const payload = event.payload || {};
  const blobUri = payload.artifact ? await putArtifact(payload.artifact) : "";
  if (event.event_type === "knowledge.revision.staged" || event.event_type === "knowledge.revision.approved") {
    if (!Array.isArray(payload.document?.content_vector)) {
      const searchConfig = azureSearchConfigFromEnv();
      if (!searchConfig.embeddingConfigured && !searchConfig.deterministicVectorsAllowed) {
        return {
          blob_uri: blobUri,
          search: {
            status: "deferred_missing_embedding",
            missing: searchConfig.embeddingMissing,
            backfill_required: true,
          },
        };
      }
    }
    const request = {
      organization_id: payload.organization_id,
      user_id: payload.user_id,
      twin_id: payload.twin_id,
      documents: [payload.document],
    };
    const search = await upsertVectorDocuments(request, azureSearchConfigFromEnv());
    if (event.event_type === "knowledge.revision.approved") {
      await deleteVectorDocuments(azureSearchConfigFromEnv().workingIndex, [payload.document.vector_doc_id], azureSearchConfigFromEnv());
    }
    return { blob_uri: blobUri, search };
  }
  if (event.event_type === "knowledge.revision.rejected") {
    const documentId = cleanText(payload.document?.vector_doc_id, 256);
    if (!documentId) throw new Error("Rejected knowledge event has no search document id.");
    const config = azureSearchConfigFromEnv();
    const working = await deleteVectorDocuments(config.workingIndex, [documentId], config);
    const approved = await deleteVectorDocuments(config.approvedIndex, [documentId], config);
    return { blob_uri: blobUri, search: { working, approved } };
  }
  return { blob_uri: blobUri };
}

async function processOutboxBatch(pool, options = {}) {
  const workerId = cleanText(options.workerId || `${process.env.WEBSITE_INSTANCE_ID || "local"}:${process.pid}`, 256);
  const batchSize = Math.max(1, Math.min(Number(options.batchSize || process.env.MEIDS_OUTBOX_BATCH_SIZE || 25), 100));
  const client = await pool.connect();
  let events = [];
  try {
    await client.query("BEGIN");
    const claimed = await client.query(
      `WITH candidates AS (
         SELECT event_id FROM runtime.outbox_event
         WHERE status IN ('pending', 'failed')
           AND attempts < $1
           AND next_attempt_at <= now()
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE runtime.outbox_event event
       SET status = 'processing', attempts = attempts + 1, locked_at = now(), locked_by = $3
       FROM candidates
       WHERE event.event_id = candidates.event_id
       RETURNING event.*`,
      [MAX_OUTBOX_ATTEMPTS, batchSize, workerId],
    );
    events = claimed.rows;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const results = [];
  for (const event of events) {
    try {
      const projection = await projectEvent(event);
      const metadataClient = await pool.connect();
      try {
        await metadataClient.query("BEGIN");
        await setRequestContext(metadataClient, {
          tenant_id: event.tenant_id,
          user_id: cleanText(event.payload?.user_id, 256),
          allowed_twin_ids: [cleanText(event.payload?.twin_id, 128)].filter(Boolean),
          group_ids: [],
        });
        if (projection.blob_uri && event.aggregate_type === "knowledge.concept") {
          const revision = Number(event.payload?.revision);
          if (!Number.isInteger(revision) || revision < 1) {
            throw new Error("Knowledge outbox event has no valid revision number.");
          }
          const update = await metadataClient.query(
            `UPDATE knowledge.concept_revision SET blob_uri = $2 WHERE concept_id = $1::uuid AND revision = $3`,
            [event.aggregate_id, projection.blob_uri, revision],
          );
          if (update.rowCount !== 1) throw new Error("Knowledge artifact projection did not update exactly one revision.");
        }
        if (projection.blob_uri && event.aggregate_type === "learning.increment") {
          const update = await metadataClient.query(
            "UPDATE learning.increment SET blob_uri = $2 WHERE increment_id = $1::uuid",
            [event.aggregate_id, projection.blob_uri],
          );
          if (update.rowCount !== 1) throw new Error("Learning artifact projection did not update exactly one increment.");
        }
        await metadataClient.query(
          `UPDATE runtime.outbox_event SET status = 'completed', processed_at = now(), last_error = NULL, locked_at = NULL, locked_by = NULL
           WHERE event_id = $1`,
          [event.event_id],
        );
        await metadataClient.query("COMMIT");
      } catch (error) {
        await metadataClient.query("ROLLBACK");
        throw error;
      } finally {
        metadataClient.release();
      }
      results.push({ event_id: event.event_id, status: "completed" });
    } catch (error) {
      const terminal = Number(event.attempts) >= MAX_OUTBOX_ATTEMPTS;
      const delayMinutes = Math.min(60, Math.max(1, 2 ** Math.min(Number(event.attempts), 6)));
      await pool.query(
        `UPDATE runtime.outbox_event
         SET status = $2, last_error = $3, next_attempt_at = now() + ($4::text || ' minutes')::interval, locked_at = NULL, locked_by = NULL
         WHERE event_id = $1`,
        [event.event_id, terminal ? "dead_letter" : "failed", cleanText(error.message, 4_000), delayMinutes],
      );
      results.push({ event_id: event.event_id, status: terminal ? "dead_letter" : "failed", error: error.message });
    }
  }
  return { claimed: events.length, results };
}

module.exports = {
  canonicalKey,
  stageKnowledge,
  stageLearning,
  promoteKnowledge,
  rejectKnowledge,
  backfillKnowledgeSearch,
  processOutboxBatch,
};
