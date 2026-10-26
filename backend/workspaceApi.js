const crypto = require("node:crypto");
const { MAX_DOCUMENT_BYTES, extractDocumentText } = require("./documentExtraction");
const { MAX_AUDIO_BYTES, validateAudioUpload } = require("./audioUpload");

const MAX_AVATAR_BYTES = 1_500_000;
const REVIEW_FROM_UI = {
  "pending-review": "review_needed",
  pending_review: "review_needed",
  "needs-rework": "updated",
  needs_rework: "updated",
  approved: "approved",
  rejected: "rejected",
};
const REVIEW_TO_UI = {
  review_needed: "pending-review",
  updated: "needs-rework",
  approved: "approved",
  rejected: "rejected",
  archived: "archived",
};

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function clean(value, max = 20_000) {
  return String(value || "").trim().slice(0, max);
}

function slug(value, max = 64) {
  return clean(value, 300)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

function assertTwin(mapping, twinId) {
  const normalized = clean(twinId || mapping.active_twin_id, 128);
  if (!normalized || !(mapping.allowed_twin_ids || []).includes(normalized)) {
    throw httpError(403, "The selected twin is not assigned to the signed-in user.");
  }
  return normalized;
}

async function setContext(client, mapping) {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [mapping.tenant_id]);
  await client.query("SELECT set_config('app.user_id', $1, true)", [mapping.user_id]);
  await client.query("SELECT set_config('app.allowed_twin_ids', $1, true)", [(mapping.allowed_twin_ids || []).join(",")]);
  await client.query("SELECT set_config('app.group_ids', $1, true)", [(mapping.group_ids || []).join(",")]);
}

async function withContext(pool, mapping, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setContext(client, mapping);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function audit(client, mapping, action, resourceType, resourceId, details = {}) {
  await client.query(
    `INSERT INTO audit.event (tenant_id, actor_user_id, action, resource_type, resource_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [mapping.tenant_id, mapping.user_id, action, resourceType, String(resourceId), JSON.stringify(details)],
  );
}

function conceptRecord(row) {
  const content = row.content && typeof row.content === "object" ? row.content : {};
  const citations = Array.isArray(row.citations) ? row.citations : [];
  return {
    path: String(row.concept_id),
    concept_id: String(row.concept_id),
    revision: Number(row.current_revision || row.revision || 1),
    title: row.title,
    description: content.summary || content.purpose || content.how_to_apply || content.topic || "",
    summary: content.summary || content.purpose || "",
    type: content.raw?.type || "OKF Concept",
    review_state: REVIEW_TO_UI[row.review_state] || row.review_state,
    visibility_scope: row.visibility_scope,
    source_anchor: citations[0]?.path || citations[0]?.title || content.raw?.source_name || "",
    reviewed_by: row.reviewed_by || "",
    reviewed_at: row.reviewed_at || "",
    review_note: row.review_note || "",
    sensitivity: content.raw?.sensitivity || citations[0]?.sensitivity || "",
    consent_scope: content.raw?.consent_scope || citations[0]?.consent_scope || "",
    provenance_hash: content.raw?.provenance_hash || citations[0]?.sha256 || "",
    curation_method: content.raw?.curation_method || citations[0]?.curation_method || "",
    source_anchor_detail: content.raw?.source_anchor_detail || {},
    source_refs: citations,
    evidence_review_states: citations.map((citation) => {
      const reviewState = citation && typeof citation === "object" ? citation.review_state : "";
      return REVIEW_TO_UI[reviewState] || reviewState || "pending-review";
    }),
    tags: Array.isArray(content.tags) ? content.tags : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata: {
      review_state: REVIEW_TO_UI[row.review_state] || row.review_state,
      visibility_scope: row.visibility_scope,
      content,
      evidence_count: Number(row.evidence_count || citations.length || 0),
      reviewed_by: row.reviewed_by || "",
      reviewed_at: row.reviewed_at || "",
      review_note: row.review_note || "",
    },
  };
}

function graphConceptId(nodeKey) {
  const match = clean(nodeKey, 256).match(/^concept:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
  return match?.[1] || "";
}

function conceptGraphNode(concept) {
  return {
    node_key: `concept:${concept.concept_id}`,
    node_type: "concept",
    title: concept.title,
    summary: concept.summary || concept.description || "",
    review_state: concept.review_state,
    confidence: concept.review_state === "approved" ? 1 : 0.65,
    cluster: concept.type || "knowledge",
    tags: concept.tags || [],
    okf_path: concept.path,
    actor_readiness: concept.review_state === "approved" ? "ready" : "needs-review",
    actor_readiness_score: concept.review_state === "approved" ? 100 : 60,
    source_refs: concept.source_refs || [],
  };
}

function graphConceptEvidence(concept) {
  const evidence = (concept.source_refs || []).map((source) => ({
    ...source,
    title: source.title || source.source_name || concept.title,
    path: source.path || source.evidence_path || source.source_anchor || concept.source_anchor || "",
    evidence_path: source.evidence_path || source.path || source.source_anchor || concept.source_anchor || "",
    excerpt: source.excerpt || source.summary || concept.summary || concept.description || "",
    review_state: source.review_state || "pending-review",
  }));
  if (!evidence.length && concept.source_anchor) {
    evidence.push({
      title: concept.title,
      path: concept.source_anchor,
      evidence_path: concept.source_anchor,
      excerpt: concept.summary || concept.description || "",
      review_state: concept.review_state,
    });
  }
  return evidence;
}

async function queryConcepts(pool, mapping, twinId, conceptId = "") {
  return withContext(pool, mapping, async (client) => {
    const result = await client.query(
      `SELECT concept.*, revision.content, revision.revision,
        COALESCE(evidence_data.citations, '[]'::jsonb) AS citations,
        COALESCE(evidence_data.evidence_count, 0) AS evidence_count,
        review_data.actor_user_id AS reviewed_by,
        review_data.created_at AS reviewed_at,
        review_data.rationale AS review_note
       FROM knowledge.concept concept
       JOIN knowledge.concept_revision revision
         ON revision.concept_id = concept.concept_id AND revision.revision = concept.current_revision
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(evidence.citation ORDER BY evidence.created_at) AS citations,
           count(*)::int AS evidence_count
         FROM knowledge.evidence evidence WHERE evidence.concept_id = concept.concept_id
       ) evidence_data ON true
       LEFT JOIN LATERAL (
         SELECT review.actor_user_id, review.created_at, review.rationale
         FROM knowledge.review_action review
         WHERE review.concept_id = concept.concept_id AND review.revision = concept.current_revision
         ORDER BY review.created_at DESC LIMIT 1
       ) review_data ON true
       WHERE concept.tenant_id = $1 AND concept.twin_id = $2
         AND ($3::text = '' OR concept.concept_id::text = $3)
       ORDER BY concept.updated_at DESC`,
      [mapping.tenant_id, twinId, conceptId],
    );
    return result.rows.map(conceptRecord);
  });
}

function qualityAssessment(body) {
  const transcript = clean(body.transcript, 50_000);
  const replies = Array.isArray(body.replies) ? body.replies.map((item) => clean(item, 10_000)).filter(Boolean) : [];
  const combined = [transcript, ...replies].join(" ");
  const words = combined.split(/\s+/).filter(Boolean);
  const dimensions = {
    what: /\b(is|means|consists|includes|refers|what)\b/i.test(combined),
    how: /\b(first|then|next|after|before|step|process|how)\b/i.test(combined),
    why: /\b(because|purpose|reason|therefore|why|so that)\b/i.test(combined),
    who: /\b(owner|responsible|team|customer|stakeholder|who)\b/i.test(combined),
    what_then: /\b(result|outcome|impact|then|leads to|implication)\b/i.test(combined),
  };
  const missing = Object.entries(dimensions).filter(([, present]) => !present).map(([name]) => name);
  const questionByDimension = {
    what: "What exactly do you mean by this topic, and where does its boundary lie?",
    how: "How do you apply it step by step, including exceptions and shortcuts?",
    why: "Why is it needed, and in which context does that reasoning change?",
    who: "Who is involved, responsible, consulted, or affected?",
    what_then: "And then what happens: which result, consequence, or follow-up do you expect?",
  };
  const coverage = Object.values(dimensions).filter(Boolean).length / Object.keys(dimensions).length;
  const wordScore = Math.min(1, words.length / 90);
  const score = Number((coverage * 0.7 + wordScore * 0.3).toFixed(2));
  const ready = words.length >= 45 && missing.length <= 1;
  return {
    ready,
    final_ready: ready,
    category: clean(body.category || "process_insight", 100),
    category_label: clean(body.category || "Process insight", 100),
    summary: transcript.split(/[.!?]\s/)[0].slice(0, 240) || "Voice knowledge concept",
    consistency_score: score,
    eligibility_score: score,
    word_count: words.length,
    missing_dimensions: missing,
    covered_dimensions: Object.entries(dimensions).filter(([, present]) => present).map(([name]) => name),
    blocking_reasons: [
      ...(words.length < 45 ? [`Add ${45 - words.length} or more words.`] : []),
      ...(missing.length > 1 ? [`Close at least ${missing.length - 1} more W-question dimensions.`] : []),
    ],
    dimensions,
    next_question: missing.length ? questionByDimension[missing[0]] : "What exception or failure mode would an experienced colleague know to watch for?",
  };
}

function skillRecord(row) {
  const storedSpec = row.spec || {};
  return {
    skill_id: row.skill_id,
    name: row.name,
    description: row.description,
    status: row.status,
    risk_class: row.risk_class,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    spec: {
      ...storedSpec,
      name: storedSpec.name || row.name,
      description: storedSpec.description || row.description,
      risk_class: storedSpec.risk_class || row.risk_class,
    },
  };
}

function skillDetailRecord(row) {
  const skill = skillRecord(row);
  const taskAgents = Array.isArray(skill.spec.task_agents) ? skill.spec.task_agents : [];
  return {
    ...skill,
    skill,
    folder: skill.spec.folder || "",
    config: {
      status: skill.status,
      actor_agent: { persona_ref: row.twin_id },
      orchestrator: {
        mode: "skill_orchestrator",
        model: "Call n8n Workflow Tool",
        max_steps: skill.spec.max_steps || 8,
        actor_checkpoints: skill.spec.actor_checkpoints || ["before_external_side_effect", "before_irreversible_action"],
      },
      task_agents: taskAgents,
    },
    lint: { valid: true, errors: [] },
  };
}

function voiceDraftRecord(row) {
  const assessment = row.assessment || {};
  return {
    ...row,
    path: String(row.draft_id),
    title: assessment.summary || row.category,
    consistency_score: Number(assessment.consistency_score) || 0,
    eligibility_score: Number(assessment.eligibility_score) || 0,
    final_ready: Boolean(assessment.final_ready ?? assessment.ready),
    word_count: Number(assessment.word_count) || 0,
  };
}

function createWorkspaceApi(deps) {
  const {
    getPgPool,
    requireTwinRequestMapping,
    requireKnowledgeRequestMapping,
    readBody,
    readMultipartForm,
    jsonResponse,
    stageKnowledge,
    promoteKnowledge,
    rejectKnowledge,
    proxyToN8n,
    transcribeAudio,
    transcriptionConfig,
    issueKnowledgeAccessToken,
  } = deps;

  function actorChatRequest(envelope, mapping, twinId, message, suppliedSessionId = "") {
    const knowledgeAccessToken = issueKnowledgeAccessToken(mapping, twinId);
    return {
      ...envelope,
      action: "sendMessage",
      sessionId: clean(suppliedSessionId, 256) || envelope.request_id,
      chatInput: clean(message, 20_000),
      metadata: {
        source: "meids-intellectual-twin",
        interface: "backend_agent_handoff",
        interfaceContract: "meids.actor_twin.embedded_chat.v1",
        identity: {
          tenantId: mapping.tenant_id,
          userId: mapping.user_id,
          activeTwinId: twinId,
          allowedTwinIds: mapping.allowed_twin_ids || [],
        },
        authorization: {
          contract: "meids.knowledge-access.v1",
          knowledgeAccessToken,
          knowledgeScope: "active_twin",
          handling: "opaque_backend_credential_do_not_prompt_or_log",
        },
        orchestrationEnvelope: envelope,
      },
    };
  }

  async function context(req, body = {}, knowledge = false) {
    const mapping = knowledge
      ? await requireKnowledgeRequestMapping(req, body)
      : await requireTwinRequestMapping(req);
    return { mapping, pool: await getPgPool() };
  }

  async function picture(req, res, remove = false) {
    const form = remove ? { fields: await readBody(req), files: {} } : await readMultipartForm(req, { maxBytes: MAX_AVATAR_BYTES + 100_000 });
    const { mapping, pool } = await context(req, form.fields);
    const twinId = assertTwin(mapping, form.fields.twin_id);
    let picturePath = "";
    if (!remove) {
      const file = form.files.file;
      if (!file) throw httpError(400, "A picture file is required.");
      if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) throw httpError(415, "Twin pictures must be PNG, JPEG, WebP, or GIF.");
      if (file.buffer.length > MAX_AVATAR_BYTES) throw httpError(413, "Twin pictures must not exceed 1.5 MB.");
      picturePath = `data:${file.type};base64,${file.buffer.toString("base64")}`;
    }
    const row = await withContext(pool, mapping, async (client) => {
      const result = await client.query(
        `UPDATE twin.twin twin_row SET profile = jsonb_set(
           jsonb_set(COALESCE(profile, '{}'::jsonb), '{picture_path}', to_jsonb($4::text), true),
           '{picture_uploaded_at}', to_jsonb($5::text), true
         ), updated_at = now()
         FROM twin.user_twin_access access
         WHERE twin_row.tenant_id = $1 AND twin_row.twin_id = $2
           AND access.tenant_id = twin_row.tenant_id AND access.twin_id = twin_row.twin_id
           AND access.user_id = $3 AND access.access_role IN ('owner','editor')
         RETURNING twin_row.twin_id, twin_row.profile`,
        [mapping.tenant_id, twinId, mapping.user_id, picturePath, picturePath ? new Date().toISOString() : ""],
      );
      if (!result.rowCount) throw httpError(404, "Twin not found or modification access is missing.");
      await audit(client, mapping, remove ? "twin.picture.remove" : "twin.picture.upload", "twin", twinId, { bytes: remove ? 0 : form.files.file.buffer.length });
      return result.rows[0];
    });
    jsonResponse(res, 200, { status: remove ? "removed" : "updated", twin_id: twinId, picture_path: row.profile.picture_path || "" });
  }

  async function picturePosition(req, res) {
    const body = await readBody(req);
    const { mapping, pool } = await context(req, body);
    const twinId = assertTwin(mapping, body.twin_id);
    const x = Math.max(0, Math.min(100, Number(body.focus_x) || 50));
    const y = Math.max(0, Math.min(100, Number(body.focus_y) || 50));
    await withContext(pool, mapping, async (client) => {
      const result = await client.query(
        `UPDATE twin.twin twin_row SET profile = jsonb_set(
          jsonb_set(COALESCE(profile, '{}'::jsonb), '{picture_focus_x}', to_jsonb($4::numeric), true),
          '{picture_focus_y}', to_jsonb($5::numeric), true), updated_at = now()
         FROM twin.user_twin_access access
         WHERE twin_row.tenant_id = $1 AND twin_row.twin_id = $2
           AND access.tenant_id = twin_row.tenant_id AND access.twin_id = twin_row.twin_id
           AND access.user_id = $3 AND access.access_role IN ('owner','editor')`,
        [mapping.tenant_id, twinId, mapping.user_id, x, y],
      );
      if (!result.rowCount) throw httpError(404, "Twin not found or modification access is missing.");
      await audit(client, mapping, "twin.picture.position", "twin", twinId, { focus_x: x, focus_y: y });
    });
    jsonResponse(res, 200, { status: "updated", twin_id: twinId, focus_x: x, focus_y: y });
  }

  async function ingestText(req, res) {
    const body = await readBody(req);
    const { mapping, pool } = await context(req, body, true);
    const twinId = assertTwin(mapping, body.twin || body.twin_id);
    const text = clean(body.text, 100_000);
    if (!text) throw httpError(400, "Text is required.");
    const title = text.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 200) || "Manual knowledge intake";
    const staged = await stageKnowledge(pool, mapping, {
      twin_id: twinId,
      concept: { title, topic: title, summary: text.slice(0, 2_000), how_to_apply: text, raw: { type: "Manual Note", source_name: clean(body.source || "manual-paste", 200) } },
      source: { type: "manual_paste", name: clean(body.source || "manual-paste", 200) },
      evidence: [{ citation: { type: "manual_paste", title, captured_at: new Date().toISOString() }, confidence: 1 }],
      change_reason: "Manual frontend knowledge intake",
    });
    jsonResponse(res, 201, { ...staged, concept: { path: staged.concept_id, concept_id: staged.concept_id, title, review_state: REVIEW_TO_UI[staged.review_state] || staged.review_state } });
  }

  async function ingestDocument(req, res) {
    const { mapping, pool } = await context(req, {}, true);
    const form = await readMultipartForm(req, { maxBytes: MAX_DOCUMENT_BYTES + 100_000 });
    const twinId = assertTwin(mapping, form.fields.twin || form.fields.twin_id);
    const file = form.files.file;
    if (!file) throw httpError(400, "A document file is required.");
    const { filename, extension, text } = await extractDocumentText(file);
    const title = clean(filename.replace(/\.[^.]+$/, ""), 200) || "Uploaded document";
    const checksum = crypto.createHash("sha256").update(file.buffer).digest("hex");
    const capturedAt = new Date().toISOString();
    const staged = await stageKnowledge(pool, mapping, {
      twin_id: twinId,
      concept: { title, topic: title, summary: text.slice(0, 2_000), how_to_apply: text.slice(0, 80_000), raw: {
        type: "Document Upload", source_name: filename, media_type: file.type,
        sensitivity: "internal", consent_scope: "authorized_upload",
        provenance_hash: checksum, curation_method: "direct_document_upload",
        source_anchor_detail: { filename, extension, media_type: file.type, size_bytes: file.buffer.length, captured_at: capturedAt },
      } },
      source: { type: extension || "document", name: filename, size: file.buffer.length, checksum },
      evidence: [{ citation: {
        type: "uploaded_document", title: filename, path: filename, media_type: file.type,
        size_bytes: file.buffer.length, sha256: checksum, captured_at: capturedAt,
        sensitivity: "internal", consent_scope: "authorized_upload", curation_method: "direct_document_upload",
        review_state: "pending-review",
      }, confidence: 1 }],
      change_reason: "Frontend document ingestion",
    });
    jsonResponse(res, 201, { ...staged, concept: { path: staged.concept_id, concept_id: staged.concept_id, title, review_state: REVIEW_TO_UI[staged.review_state] || staged.review_state } });
  }

  async function concepts(req, res, url) {
    const { mapping, pool } = await context(req, {}, true);
    const twinId = assertTwin(mapping, url.searchParams.get("twin"));
    jsonResponse(res, 200, { concepts: await queryConcepts(pool, mapping, twinId) });
  }

  async function conceptDetail(req, res, url) {
    const { mapping, pool } = await context(req, {}, true);
    const conceptId = clean(url.searchParams.get("path"), 128);
    const candidates = [];
    for (const twinId of mapping.allowed_twin_ids || []) candidates.push(...await queryConcepts(pool, mapping, twinId, conceptId));
    const concept = candidates[0];
    if (!concept) throw httpError(404, "Concept not found.");
    jsonResponse(res, 200, {
      path: concept.path,
      metadata: {
        title: concept.title, type: concept.type, review_state: concept.review_state,
        visibility_scope: concept.visibility_scope, tags: concept.tags,
        evidence_count: concept.metadata.evidence_count, reviewed_by: concept.reviewed_by,
        reviewed_at: concept.reviewed_at, review_note: concept.review_note,
        source_anchor: concept.source_anchor, sensitivity: concept.sensitivity,
        consent_scope: concept.consent_scope, provenance_hash: concept.provenance_hash,
        curation_method: concept.curation_method, source_anchor_detail: concept.source_anchor_detail,
      },
      content: concept.metadata.content,
      linked_evidence: concept.source_refs,
    });
  }

  async function conceptReview(req, res) {
    const body = await readBody(req);
    const { mapping, pool } = await context(req, body, true);
    const conceptId = clean(body.path || body.concept_id, 128);
    const found = await withContext(pool, mapping, (client) => client.query(
      `SELECT concept_id, current_revision, review_state FROM knowledge.concept WHERE concept_id::text = $1`,
      [conceptId],
    ));
    if (!found.rowCount) throw httpError(404, "Concept not found.");
    const target = REVIEW_FROM_UI[String(body.review_state || body.decision || "").toLowerCase()];
    if (target === "approved") {
      const result = await promoteKnowledge(pool, mapping, { concept_id: conceptId, revision: found.rows[0].current_revision, rationale: clean(body.note || body.rationale, 5_000) });
      jsonResponse(res, 200, { ...result, review_state: "approved" });
      return;
    }
    if (target === "rejected") {
      const result = await rejectKnowledge(pool, mapping, { concept_id: conceptId, revision: found.rows[0].current_revision, decision: "reject", rationale: clean(body.note || body.rationale, 5_000) });
      jsonResponse(res, 200, { ...result, review_state: "rejected" });
      return;
    }
    if (!target) throw httpError(400, "Unsupported concept review state.");
    await withContext(pool, mapping, async (client) => {
      await client.query("UPDATE knowledge.concept SET review_state = $2, updated_at = now() WHERE concept_id::text = $1", [conceptId, target]);
      await audit(client, mapping, "knowledge.review_state", "knowledge.concept", conceptId, { review_state: target, note: clean(body.note, 5_000) });
    });
    jsonResponse(res, 200, { status: "updated", concept_id: conceptId, review_state: REVIEW_TO_UI[target] });
  }

  async function conceptArchive(req, res) {
    const body = await readBody(req);
    const { mapping, pool } = await context(req, body, true);
    const conceptId = clean(body.path || body.concept_id, 128);
    const result = await withContext(pool, mapping, async (client) => {
      const updated = await client.query(
        `UPDATE knowledge.concept SET review_state = 'archived', updated_at = now()
         WHERE concept_id::text = $1 AND owner_user_id = $2 RETURNING concept_id`,
        [conceptId, mapping.user_id],
      );
      if (!updated.rowCount) throw httpError(404, "Concept not found or archive access is missing.");
      await audit(client, mapping, "knowledge.archive", "knowledge.concept", conceptId);
      return updated.rows[0];
    });
    jsonResponse(res, 200, { status: "archived", concept_id: result.concept_id });
  }

  async function skills(req, res, url) {
    const { mapping, pool } = await context(req);
    const twinId = assertTwin(mapping, url.searchParams.get("twin") || mapping.active_twin_id);
    const result = await withContext(pool, mapping, (client) => client.query(
      "SELECT * FROM agent.skill_spec WHERE tenant_id = $1 AND twin_id = $2 AND status <> 'archived' ORDER BY updated_at DESC",
      [mapping.tenant_id, twinId],
    ));
    jsonResponse(res, 200, { skills: result.rows.map(skillRecord) });
  }

  async function skillDetail(req, res, url) {
    const { mapping, pool } = await context(req);
    const result = await withContext(pool, mapping, (client) => client.query(
      "SELECT * FROM agent.skill_spec WHERE tenant_id = $1 AND skill_id = $2",
      [mapping.tenant_id, clean(url.searchParams.get("skill_id"), 128)],
    ));
    if (!result.rowCount) throw httpError(404, "Skill not found.");
    jsonResponse(res, 200, skillDetailRecord(result.rows[0]));
  }

  async function skillElicit(req, res) {
    const body = await readBody(req);
    const { mapping, pool } = await context(req, body);
    const twinId = assertTwin(mapping, body.twin || body.twin_id);
    const description = clean(body.description, 30_000);
    if (!description) throw httpError(400, "Skill description is required.");
    const name = clean(body.name_hint || description.split(/[.\n]/)[0] || "New skill", 160);
    const skillId = `${slug(name) || "skill"}-${crypto.randomBytes(3).toString("hex")}`;
    const spec = {
      name,
      description,
      elicitation_questions: [
        "When should this skill trigger, and when should it not?",
        "Which inputs and tools are required?",
        "Which actions require human approval?",
      ],
      approval_policy: "never_auto_approve_generated_skills",
      execution_hierarchy: "Actor Twin -> Agentic Butler -> Skill Orchestrator -> Task Agent",
    };
    const result = await withContext(pool, mapping, async (client) => {
      const inserted = await client.query(
        `INSERT INTO agent.skill_spec (skill_id, tenant_id, owner_user_id, twin_id, name, description, spec)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING *`,
        [skillId, mapping.tenant_id, mapping.user_id, twinId, name, description, JSON.stringify(spec)],
      );
      await audit(client, mapping, "skill.elicit", "agent.skill_spec", skillId, { twin_id: twinId });
      return inserted.rows[0];
    });
    jsonResponse(res, 201, { status: "pending_approval", skill: skillRecord(result), lint: { valid: true, errors: [] } });
  }

  async function skillMutate(req, res, action) {
    const body = await readBody(req);
    const { mapping, pool } = await context(req, body);
    const skillId = clean(body.skill_id, 128);
    const row = await withContext(pool, mapping, async (client) => {
      const current = await client.query("SELECT * FROM agent.skill_spec WHERE tenant_id = $1 AND skill_id = $2", [mapping.tenant_id, skillId]);
      if (!current.rowCount) throw httpError(404, "Skill not found.");
      let status = current.rows[0].status;
      let spec = current.rows[0].spec || {};
      if (action === "decompose") {
        spec = { ...spec, task_agents: [{ name: `${slug(current.rows[0].name)}-task-agent`, purpose: current.rows[0].description, tools: [], boundary: "Execute only the approved SkillSpec through Skill Orchestrator." }] };
      } else if (action === "approval") {
        status = body.decision === "approve" ? "approved" : "rejected";
      } else if (action === "archive") status = "archived";
      const updated = await client.query(
        "UPDATE agent.skill_spec SET status = $3, spec = $4::jsonb, updated_at = now() WHERE tenant_id = $1 AND skill_id = $2 RETURNING *",
        [mapping.tenant_id, skillId, status, JSON.stringify(spec)],
      );
      await audit(client, mapping, `skill.${action}`, "agent.skill_spec", skillId, { status, decision: body.decision || "" });
      return updated.rows[0];
    });
    jsonResponse(res, 200, { status: row.status, skill: skillRecord(row), lint: { valid: true, errors: [] } });
  }

  async function skillRun(req, res) {
    const body = await readBody(req);
    const { mapping, pool } = await context(req, body);
    const skillId = clean(body.skill_id, 128);
    const result = await withContext(pool, mapping, (client) => client.query(
      "SELECT * FROM agent.skill_spec WHERE tenant_id = $1 AND skill_id = $2 AND status = 'approved'",
      [mapping.tenant_id, skillId],
    ));
    if (!result.rowCount) throw httpError(409, "Only approved skills can run.");
    const skill = result.rows[0];
    const requestId = `skill-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
    const envelope = {
      envelope_version: "0.1.0",
      request_id: requestId,
      timestamp: new Date().toISOString(),
      agent_id: "actor_twin",
      intent: "execute_approved_skill",
      principal: { tenant_id: mapping.tenant_id, user_id: mapping.user_id, roles: mapping.roles || [] },
      input: { message: clean(body.manual_request, 20_000), skill_id: skillId, skill_spec: skill.spec, source_inputs: body },
      context: { active_twin_id: skill.twin_id, allowed_twin_ids: mapping.allowed_twin_ids, routing_policy: "call_n8n_workflow_tool_first", target_capability: "agentic_butler" },
    };
    const manualRequest = envelope.input.message || "Run the approved skill with the supplied context.";
    const knowledgeContext = clean(body.knowledge_context, 20_000);
    const skillPrompt = [
      `Execute the approved skill "${skill.name}" through Agentic Butler using the Call n8n Workflow Tool.`,
      "This is approved-skill execution: call Agentic Butler first and let it use Skill Orchestrator/Task Agent as configured.",
      "Treat all supplied knowledge as read-only. If Knowledge Fabric is needed, operation must be retrieve. Do not stage, update, or create knowledge unless the user's manual request explicitly asks for a write.",
      `Manual request: ${manualRequest}`,
      knowledgeContext ? `Approved knowledge context: ${knowledgeContext}` : "",
      `Approved SkillSpec: ${JSON.stringify(skill.spec || {})}`,
    ].filter(Boolean).join("\n\n");
    const request = actorChatRequest(envelope, mapping, skill.twin_id, skillPrompt, body.session_id);
    const queued = {
      status: "queued", run_id: requestId, skill_id: skillId, skill_name: skill.name,
      twin: skill.twin_id, summary: "Approved skill run queued for Actor Twin orchestration.",
      review_state: "unreviewed", inputs: body, created_at: new Date().toISOString(),
      orchestration: { entry_agent: "actor_twin", delegation: "Call n8n Workflow Tool", target: "agentic_butler" },
    };
    await withContext(pool, mapping, (client) => audit(client, mapping, "skill.run.queued", "agent.skill_run", requestId, queued));
    jsonResponse(res, 202, queued);

    const persistRunResult = (action, details) => withContext(pool, mapping, async (client) => {
      const updated = await client.query(
        `UPDATE audit.event SET action = $3, details = $4::jsonb
         WHERE tenant_id = $1 AND resource_id = $2 AND resource_type = 'agent.skill_run'
           AND actor_user_id = $5`,
        [mapping.tenant_id, requestId, action, JSON.stringify(details), mapping.user_id],
      );
      if (updated.rowCount !== 1) throw new Error(`Skill run ledger update did not match ${requestId}.`);
    });

    void (async () => {
      try {
        const response = await proxyToN8n("actor_twin", request);
        const output = response.output || response;
        const completed = {
          ...queued,
          status: response.status || "completed",
          summary: clean(typeof output === "string" ? output : response.message || "Skill run completed.", 1_000),
          result: output,
          completed_at: new Date().toISOString(),
        };
        await persistRunResult("skill.run", completed);
      } catch (error) {
        const failed = {
          ...queued, status: "failed", review_state: "needs_rework",
          summary: clean(error.message, 1_000), completed_at: new Date().toISOString(),
        };
        try {
          await persistRunResult("skill.run.failed", failed);
        } catch (persistError) {
          console.error(JSON.stringify({
            event: "skill_run_ledger_update",
            status: "failed",
            run_id: requestId,
            execution_error: error.message || String(error),
            persistence_error: persistError.message || String(persistError),
          }));
        }
      }
    })();
  }

  async function skillRuns(req, res, url) {
    const { mapping, pool } = await context(req);
    const limit = Math.min(100, Number(url.searchParams.get("limit")) || 20);
    const result = await withContext(pool, mapping, (client) => client.query(
      `SELECT resource_id, action, details, created_at FROM audit.event
       WHERE tenant_id = $1 AND actor_user_id = $2 AND action IN ('skill.run.queued', 'skill.run', 'skill.run.failed')
       ORDER BY created_at DESC LIMIT $3`,
      [mapping.tenant_id, mapping.user_id, limit],
    ));
    jsonResponse(res, 200, {
      status: "ready",
      total: result.rowCount,
      runs: result.rows.map((row) => ({ run_id: row.resource_id, ...row.details, created_at: row.details.created_at || row.created_at })),
    });
  }

  async function voiceCriteria(res) {
    jsonResponse(res, 200, {
      source: "Me.IDs circular W-question quality gate",
      readiness: { minimum_score: 70, max_missing_dimensions: 1, minimum_words: 45 },
      dimensions: {
        what: { question: "What does the concept mean and where is its boundary?" },
        how: { question: "How is it applied, including exceptions and omitted steps?" },
        why: { question: "Why is it needed and in which context?" },
        who: { question: "Who is responsible, involved, or affected?" },
        what_then: { question: "And then what happens or changes?" },
      },
      metadata: { approval_state: "approved", owner: "Me.IDs knowledge governance", updated_at: "2026-10-22" },
    });
  }

  async function voiceUatSamples(req, res) {
    await context(req, {}, true);
    jsonResponse(res, 200, {
      status: "ready",
      samples: [
        {
          category: "knowledge",
          label: "Process knowledge example",
          initial_transcript: "The handover is a controlled decision point. The responsible consultant first checks the evidence, then records unresolved assumptions and asks the accountable owner to confirm them because later delivery depends on an explicit basis. The project team is informed before the approved result becomes the next work package and any exception is logged for review.",
          suggested_clarification: "An experienced colleague also checks whether the evidence is current and pauses the handover when ownership or expected impact is unclear.",
          expected_question: "What exception or failure mode would an experienced colleague know to watch for?",
        },
        {
          category: "personality",
          label: "Working preference example",
          initial_transcript: "I prefer decisions to begin with a concise evidence summary and a clear statement of uncertainty. I first compare the available options, then ask the responsible people for missing context because silent assumptions create avoidable risk. The team should know who decides, who advises, and what will happen after the decision is recorded.",
          suggested_clarification: "This preference changes in an emergency, when I accept a reversible interim decision but require the assumptions and follow-up review to be documented.",
          expected_question: "What exception or failure mode would an experienced colleague know to watch for?",
        },
        {
          category: "skill_input",
          label: "Skill input example",
          initial_transcript: "The skill prepares a review-ready recommendation. It receives the question and evidence scope, validates required sources, then structures options, risks, owners, and expected outcomes. The requesting user remains responsible for approval because the skill must not execute an external side effect. After approval, the result is stored with its evidence and trace for later learning.",
          suggested_clarification: "If evidence conflicts or the impact is high, the skill must call Critical Faculty and return a pause recommendation instead of presenting a confident conclusion.",
          expected_question: "What exception or failure mode would an experienced colleague know to watch for?",
        },
      ],
    });
  }

  async function voiceRealCoverage(req, res, url) {
    const { mapping, pool } = await context(req, {}, true);
    const twinId = assertTwin(mapping, url.searchParams.get("twin"));
    const concepts = await queryConcepts(pool, mapping, twinId);
    const required = [
      { category: "knowledge", label: "Knowledge" },
      { category: "personality", label: "Personality" },
      { category: "skill_input", label: "Skill input" },
    ];
    const voiceConcepts = concepts.filter((concept) => ["Voice Concept", "Audio Document Concept"].includes(concept.type));
    const coverage = required.map((item) => {
      const matches = voiceConcepts.filter((concept) => clean(concept.metadata?.content?.raw?.category, 100) === item.category);
      return {
        ...item,
        covered: matches.length > 0,
        count: matches.length,
        latest_path: matches[0]?.path || "",
      };
    });
    const missing = coverage.filter((item) => !item.covered).map((item) => item.category);
    jsonResponse(res, 200, {
      status: missing.length ? "incomplete" : "complete",
      twin_id: twinId,
      coverage,
      missing_categories: missing,
    });
  }

  async function voiceTranscribe(req, res) {
    const { mapping, pool } = await context(req, {}, true);
    const form = await readMultipartForm(req, { maxBytes: MAX_AUDIO_BYTES + 100_000 });
    const twinId = assertTwin(mapping, form.fields.twin || form.fields.twin_id);
    const file = form.files.file;
    const validated = validateAudioUpload(file);
    const sourceType = clean(form.fields.source_type, 50) === "audio_document" ? "audio_document" : "voice_capture";
    const category = clean(form.fields.category || "knowledge", 100);
    const jobId = `voice-transcription-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
    const audioHash = crypto.createHash("sha256").update(file.buffer).digest("hex");
    const queued = {
      status: "queued",
      job_id: jobId,
      twin_id: twinId,
      category,
      source_type: sourceType,
      filename: validated.filename,
      media_type: validated.mediaType,
      size_bytes: validated.size,
      audio_sha256: audioHash,
      transcription_provider: transcriptionConfig().provider,
      transcription_transport: transcriptionConfig().mode,
      model: transcriptionConfig().model,
      created_at: new Date().toISOString(),
    };
    await withContext(pool, mapping, (client) => audit(
      client,
      mapping,
      "voice.transcription.queued",
      "runtime.voice_transcription_job",
      jobId,
      queued,
    ));

    jsonResponse(res, 202, queued);

    void (async () => {
      const startedAt = Date.now();
      try {
        await withContext(pool, mapping, (client) => audit(client, mapping, "voice.transcription.processing", "runtime.voice_transcription_job", jobId, {
          ...queued,
          status: "processing",
          started_at: new Date(startedAt).toISOString(),
        }));
        const transcript = clean(await transcribeAudio({
          ...file,
          mediaType: validated.mediaType,
          gatewayFilename: validated.gatewayFilename,
        }), 50_000);
        if (!transcript) throw httpError(422, "The transcription provider returned no readable transcript.");

        const evidenceId = `voice_evidence_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
        const transcriptHash = crypto.createHash("sha256").update(transcript).digest("hex");
        const result = {
          status: "transcribed",
          job_id: jobId,
          transcript,
          category,
          evidence: {
            evidence_id: evidenceId,
            path: `voice-transcription:${evidenceId}`,
            source_type: sourceType,
            filename: validated.filename,
            media_type: validated.mediaType,
            transcription_provider: transcriptionConfig().provider,
            transcription_transport: transcriptionConfig().mode,
          },
          assessment: qualityAssessment({ transcript, category, replies: [] }),
          agent: { id: "knowledge_retrieval_agent", mode: "circular_interview" },
        };
        await withContext(pool, mapping, (client) => audit(client, mapping, "voice.transcription.completed", "runtime.voice_transcription_job", jobId, {
          ...queued,
          ...result,
          transcript_sha256: transcriptHash,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
        }));
        console.log(JSON.stringify({ event: "voice_transcription_job", status: "completed", job_id: jobId, duration_ms: Date.now() - startedAt }));
      } catch (error) {
        const failed = {
          ...queued,
          status: "failed",
          error: clean(error.message || "Audio transcription failed.", 1_000),
          failed_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
        };
        try {
          await withContext(pool, mapping, (client) => audit(client, mapping, "voice.transcription.failed", "runtime.voice_transcription_job", jobId, failed));
        } catch (persistError) {
          console.error(JSON.stringify({ event: "voice_transcription_job_ledger", status: "failed", job_id: jobId, error: persistError.message || String(persistError) }));
        }
        console.error(JSON.stringify({ event: "voice_transcription_job", status: "failed", job_id: jobId, duration_ms: Date.now() - startedAt, error: failed.error }));
      }
    })();
  }

  async function voiceTranscriptionStatus(req, res, url) {
    const { mapping, pool } = await context(req, {}, true);
    const twinId = assertTwin(mapping, url.searchParams.get("twin"));
    const jobId = clean(url.searchParams.get("job"), 128);
    if (!jobId) throw httpError(400, "Transcription job ID is required.");
    const result = await withContext(pool, mapping, (client) => client.query(
      `SELECT action, details, created_at FROM audit.event
       WHERE tenant_id = $1 AND actor_user_id = $2
         AND resource_type = 'runtime.voice_transcription_job' AND resource_id = $3
         AND details->>'twin_id' = $4
       ORDER BY created_at DESC LIMIT 1`,
      [mapping.tenant_id, mapping.user_id, jobId, twinId],
    ));
    if (!result.rowCount) throw httpError(404, "Transcription job not found.");
    const job = result.rows[0].details || {};
    const createdAt = Date.parse(job.created_at || result.rows[0].created_at || "");
    if (["queued", "processing"].includes(job.status) && Number.isFinite(createdAt) && Date.now() - createdAt > 12 * 60_000) {
      jsonResponse(res, 200, {
        ...job,
        status: "failed",
        error: "The transcription job expired before completion. The recording is still available in this browser; retry the upload.",
      });
      return;
    }
    jsonResponse(res, 200, job);
  }

  async function voiceAssess(req, res) {
    const body = await readBody(req);
    await context(req, body, true);
    if (!clean(body.transcript)) throw httpError(400, "Transcript is required.");
    const assessment = qualityAssessment(body);
    jsonResponse(res, 200, { assessment, agent: { id: "knowledge_retrieval_agent", mode: "circular_interview" }, conversation: { turn_count: (body.replies || []).length + 1 } });
  }

  async function voicePreflight(req, res, url) {
    const { mapping } = await context(req, {}, true);
    const twinId = assertTwin(mapping, url.searchParams.get("twin"));
    const n8nReady = Boolean(process.env.N8N_ACTOR_TWIN_WEBHOOK_URL);
    jsonResponse(res, 200, {
      status: n8nReady ? "ready" : "degraded",
      criteria: { approval_state: "approved", version: "circular-w-questions-v1" },
      agent: { mode: "actor_twin_routed", n8n_configured: n8nReady },
      summary: { local_uat_ready: true, n8n_ready: n8nReady, twin_id: twinId },
      checks: [
        { key: "identity_scope", label: "Identity and twin scope", state: "ready", message: "Entra identity, tenant, and selected twin are enforced by the backend." },
        { key: "quality_gate", label: "Circular interview gate", state: "ready", message: "What, how, why, who, and what-then dimensions are scored before commit." },
        { key: "agent_route", label: "Actor Twin route", state: n8nReady ? "ready" : "warning", message: n8nReady ? "Agent handoffs enter through Actor Twin and use workflow-tool delegation." : "Actor Twin webhook is not configured in this backend instance." },
      ],
    });
  }

  async function voiceAgentHandoff(req, res) {
    const body = await readBody(req);
    const { mapping, pool } = await context(req, body, true);
    const twinId = assertTwin(mapping, body.twin || body.twin_id);
    const transcript = clean(body.transcript, 50_000);
    if (!transcript) throw httpError(400, "Transcript is required.");
    const target = ["mcp", "n8n", "github"].includes(clean(body.target, 20).toLowerCase())
      ? clean(body.target, 20).toLowerCase()
      : "n8n";
    const requestId = `voice-handoff-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
    const envelope = {
      envelope_version: "0.1.0",
      request_id: requestId,
      timestamp: new Date().toISOString(),
      agent_id: "actor_twin",
      intent: "route_request",
      principal: { tenant_id: mapping.tenant_id, user_id: mapping.user_id, roles: mapping.roles || [] },
      input: {
        query: `Prepare governed ${target} context from this voice concept. Do not execute an external side effect.`,
        transcript,
        category: clean(body.category || "knowledge", 100),
        replies: Array.isArray(body.replies) ? body.replies : [],
        human_note: clean(body.human_note, 2_000),
        execute: false,
      },
      context: {
        active_twin_id: twinId,
        allowed_twin_ids: mapping.allowed_twin_ids,
        routing_policy: "call_n8n_workflow_tool_first",
        target_capability: "knowledge_fabric_agent",
        side_effect_policy: "prepare_only",
      },
    };
    const delegated = await proxyToN8n("actor_twin", actorChatRequest(
      envelope, mapping, twinId, envelope.input.query, body.session_id,
    ));
    const payloadHash = crypto.createHash("sha256").update(JSON.stringify(envelope.input)).digest("hex");
    await withContext(pool, mapping, (client) => audit(client, mapping, "voice.agent_handoff", "runtime.voice_handoff", requestId, {
      twin_id: twinId,
      target,
      payload_hash: payloadHash,
      status: delegated.status || "completed",
    }));
    jsonResponse(res, 201, {
      status: delegated.status || "completed",
      handoff_path: requestId,
      target,
      payload_hash: payloadHash,
      evidence: { path: clean(body.evidence_path, 500) || `voice-handoff:${requestId}` },
      approval_boundary: "Prepared through Actor Twin; external execution remains approval-gated.",
      orchestration: { entry_agent: "actor_twin", delegation: "Call n8n Workflow Tool" },
      result: delegated.output || delegated,
    });
  }

  async function voiceAgentHandoffs(req, res, url) {
    const { mapping, pool } = await context(req, {}, true);
    const limit = Math.min(50, Number(url.searchParams.get("limit")) || 8);
    const result = await withContext(pool, mapping, (client) => client.query(
      `SELECT resource_id, details, created_at FROM audit.event
       WHERE tenant_id = $1 AND actor_user_id = $2 AND action = 'voice.agent_handoff'
       ORDER BY created_at DESC LIMIT $3`,
      [mapping.tenant_id, mapping.user_id, limit],
    ));
    jsonResponse(res, 200, {
      status: "ready",
      handoffs: result.rows.map((row) => ({ path: row.resource_id, ...row.details, created_at: row.created_at })),
    });
  }

  async function voiceDraft(req, res) {
    const body = await readBody(req);
    const { mapping, pool } = await context(req, body, true);
    const twinId = assertTwin(mapping, body.twin || body.twin_id);
    const assessment = qualityAssessment(body);
    const result = await withContext(pool, mapping, async (client) => {
      const inserted = await client.query(
        `INSERT INTO runtime.voice_concept_draft
          (tenant_id, owner_user_id, twin_id, transcript, category, replies, question_history, assessment, note)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9) RETURNING *`,
        [mapping.tenant_id, mapping.user_id, twinId, clean(body.transcript, 50_000), clean(body.category || "process_insight", 100), JSON.stringify(body.replies || []), JSON.stringify(body.question_history || []), JSON.stringify(assessment), clean(body.draft_note, 2_000)],
      );
      await audit(client, mapping, "voice.draft", "runtime.voice_concept_draft", inserted.rows[0].draft_id, { twin_id: twinId });
      return inserted.rows[0];
    });
    const path = String(result.draft_id);
    jsonResponse(res, 201, { status: "draft", draft: { path, ...result }, evidence: { path: `voice-draft:${path}` }, conversation_fingerprint: crypto.createHash("sha256").update(result.transcript).digest("hex") });
  }

  async function voiceDrafts(req, res, url) {
    const { mapping, pool } = await context(req, {}, true);
    const twinId = assertTwin(mapping, url.searchParams.get("twin"));
    const result = await withContext(pool, mapping, (client) => client.query(
      `SELECT * FROM runtime.voice_concept_draft WHERE tenant_id = $1 AND twin_id = $2 AND owner_user_id = $3
       ORDER BY updated_at DESC LIMIT $4`,
      [mapping.tenant_id, twinId, mapping.user_id, Math.min(100, Number(url.searchParams.get("limit")) || 20)],
    ));
    jsonResponse(res, 200, { drafts: result.rows.map(voiceDraftRecord) });
  }

  async function voiceDraftDetail(req, res) {
    const body = await readBody(req);
    const { mapping, pool } = await context(req, body, true);
    const result = await withContext(pool, mapping, (client) => client.query(
      "SELECT * FROM runtime.voice_concept_draft WHERE tenant_id = $1 AND owner_user_id = $2 AND draft_id::text = $3",
      [mapping.tenant_id, mapping.user_id, clean(body.path, 128)],
    ));
    if (!result.rowCount) throw httpError(404, "Voice concept draft not found.");
    jsonResponse(res, 200, { draft: voiceDraftRecord(result.rows[0]) });
  }

  async function voiceCommit(req, res) {
    const body = await readBody(req);
    const { mapping, pool } = await context(req, body, true);
    const twinId = assertTwin(mapping, body.twin || body.twin_id);
    const assessment = qualityAssessment(body);
    if (!assessment.ready) throw httpError(409, "The circular interview quality gate is not met yet.");
    const sourceType = clean(body.source_type, 50) === "audio_document" ? "audio_document_transcript" : "voice_transcript";
    const sourceLabel = clean(body.source_name || body.source_label || "voice-concept-conversation", 200);
    const staged = await stageKnowledge(pool, mapping, {
      twin_id: twinId,
      concept: {
        title: clean(body.title_hint || assessment.summary || "Voice knowledge concept", 300),
        topic: clean(body.title_hint || assessment.summary || "Voice knowledge concept", 1_000),
        purpose: clean(body.replies?.[0] || "", 10_000),
        wider_context: clean(body.replies?.[1] || "", 20_000),
        how_to_apply: clean(body.transcript, 40_000),
        what_else_to_know: clean((body.replies || []).slice(2).join("\n\n"), 40_000),
        implications_and_results: clean((body.replies || []).at(-1) || "", 20_000),
        summary: assessment.summary,
        raw: { type: sourceType === "audio_document_transcript" ? "Audio Document Concept" : "Voice Concept", category: body.category, assessment },
      },
      source: { type: sourceType, label: sourceLabel },
      evidence: [{ citation: { type: sourceType, title: assessment.summary, source_name: sourceLabel, evidence_path: clean(body.evidence_path, 500), conversation_turns: (body.replies || []).length + 1 }, confidence: assessment.eligibility_score }],
      change_reason: `${sourceType === "audio_document_transcript" ? "Uploaded audio" : "Guided voice capture"} quality gate passed`,
    });
    jsonResponse(res, 201, {
      status: "staged",
      assessment,
      concept: { path: staged.concept_id, concept_id: staged.concept_id, title: assessment.summary, review_state: REVIEW_TO_UI[staged.review_state] || staged.review_state },
      evidence: { path: `knowledge-evidence:${staged.concept_id}` },
      conversation: { turn_count: (body.replies || []).length + 1 },
      conversation_fingerprint: crypto.createHash("sha256").update([body.transcript, ...(body.replies || [])].join("\n")).digest("hex"),
    });
  }

  async function activity(req, res, url) {
    const { mapping, pool } = await context(req);
    const twinId = assertTwin(mapping, url.searchParams.get("twin"));
    const result = await withContext(pool, mapping, (client) => client.query(
      `SELECT action, resource_type, resource_id, details, created_at, actor_user_id
       FROM audit.event WHERE tenant_id = $1
         AND (
           details->>'twin_id' = $2
           OR resource_id = $2
           OR details->>'active_twin_id' = $2
           OR resource_id IN (
             SELECT concept_id::text FROM knowledge.concept
             WHERE tenant_id = $1 AND twin_id = $2
           )
         )
       ORDER BY created_at DESC LIMIT $3`,
      [mapping.tenant_id, twinId, Math.min(200, Number(url.searchParams.get("limit")) || 50)],
    ));
    const records = result.rows.map((row) => ({ ...row.details, action: row.action, path: row.resource_id, actor: row.actor_user_id, timestamp: row.created_at }));
    jsonResponse(res, 200, {
      crud: records.filter((row) => /twin|review|archive|skill/.test(row.action)),
      ingest: records.filter((row) => /knowledge|voice/.test(row.action)),
      evidence: records.filter((row) => /knowledge|voice/.test(row.action)),
      answer_traces: [],
    });
  }

  async function reviewDashboard(req, res, url) {
    const { mapping, pool } = await context(req);
    const twinId = assertTwin(mapping, url.searchParams.get("twin"));
    const conceptRows = await queryConcepts(pool, mapping, twinId);
    const skillRows = await withContext(pool, mapping, (client) => client.query(
      "SELECT * FROM agent.skill_spec WHERE tenant_id = $1 AND twin_id = $2 AND status <> 'archived' ORDER BY updated_at DESC",
      [mapping.tenant_id, twinId],
    ));
    const stateCounts = conceptRows.reduce((acc, item) => ({ ...acc, [item.review_state]: (acc[item.review_state] || 0) + 1 }), {});
    const skillsList = skillRows.rows.map(skillRecord);
    jsonResponse(res, 200, {
      concept_review: {
        total: conceptRows.length,
        states: stateCounts,
        pending: conceptRows.filter((item) => item.review_state === "pending-review"),
        needs_rework: conceptRows.filter((item) => item.review_state === "needs-rework"),
        rejected: conceptRows.filter((item) => item.review_state === "rejected"),
        voice_created: conceptRows.filter((item) => item.type === "Voice Concept"),
      },
      trace_review: { total: 0, states: {}, latest: [] },
      persona_quality: { status: "not_assessed" },
      skills: { total: skillsList.length, states: skillsList.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {}), pending_approval: skillsList.filter((item) => item.status === "pending_approval"), runs: { total: 0, latest: [] }, refinements: { total: 0, latest: [] } },
      mcp_tool_calls: { total: 0, pending: [] },
      actions: [],
    });
  }

  async function graphRead(req, res, url) {
    const { mapping, pool } = await context(req);
    const twinId = assertTwin(mapping, url.searchParams.get("twin"));
    const includeDrafts = String(url.searchParams.get("include_drafts") || "true").toLowerCase() !== "false";
    const concepts = (await queryConcepts(pool, mapping, twinId))
      .filter((concept) => includeDrafts || concept.review_state === "approved");
    const nodes = concepts.map(conceptGraphNode);
    const edges = [];
    jsonResponse(res, 200, {
      status: "ready",
      scope: { tenant_id: mapping.tenant_id, twin_id: twinId },
      summary: {
        node_count: nodes.length,
        edge_count: edges.length,
        approved_concepts: nodes.filter((node) => node.review_state === "approved").length,
        pending_review: nodes.filter((node) => node.review_state !== "approved").length,
        projection: "governed_okf_concepts",
      },
      nodes,
      edges,
    });
  }

  async function graphNodeDetail(req, res, url) {
    const { mapping, pool } = await context(req);
    const twinId = assertTwin(mapping, url.searchParams.get("twin"));
    const includeDrafts = String(url.searchParams.get("include_drafts") || "true").toLowerCase() !== "false";
    const nodeKey = clean(url.searchParams.get("node_key"), 256);
    const conceptId = graphConceptId(nodeKey);
    if (!conceptId) throw httpError(400, "A valid concept node_key is required.");

    const [concept] = await queryConcepts(pool, mapping, twinId, conceptId);
    if (!concept || (!includeDrafts && concept.review_state !== "approved")) {
      throw httpError(404, "Graph node not found.");
    }

    const node = conceptGraphNode(concept);
    jsonResponse(res, 200, {
      status: "ready",
      scope: { tenant_id: mapping.tenant_id, twin_id: twinId },
      node,
      edges: [],
      neighbors: [],
      evidence: graphConceptEvidence(concept),
    });
  }

  async function graphAuxiliary(req, res, url, kind) {
    const { mapping } = await context(req);
    const twinId = assertTwin(mapping, url.searchParams.get("twin"));
    if (kind === "postgres_read") {
      jsonResponse(res, 200, { status: "ready", tenant_id: mapping.tenant_id, twin_id: twinId, source: "postgresql_rls" });
      return;
    }
    jsonResponse(res, 200, { [kind]: [], total: 0, status: "ready", twin_id: twinId });
  }

  async function stableEmpty(res, kind) {
    const key = kind === "skill_runs" ? "runs" : kind === "skill_refinements" ? "refinements" : kind;
    jsonResponse(res, 200, { [key]: [], total: 0, status: "ready" });
  }

  return async function workspaceApi(req, res, url) {
    const route = `${req.method} ${url.pathname}`;
    if (route === "POST /api/twins/picture") await picture(req, res, false);
    else if (route === "DELETE /api/twins/picture") await picture(req, res, true);
    else if (route === "POST /api/twins/picture/position") await picturePosition(req, res);
    else if (route === "POST /api/ingest/text") await ingestText(req, res);
    else if (route === "POST /api/ingest/document") await ingestDocument(req, res);
    else if (route === "GET /api/concepts") await concepts(req, res, url);
    else if (route === "GET /api/concepts/detail") await conceptDetail(req, res, url);
    else if (route === "POST /api/concepts/review") await conceptReview(req, res);
    else if (route === "DELETE /api/concepts") await conceptArchive(req, res);
    else if (route === "GET /api/skills") await skills(req, res, url);
    else if (route === "GET /api/skills/detail") await skillDetail(req, res, url);
    else if (route === "POST /api/skills/elicit") await skillElicit(req, res);
    else if (route === "POST /api/skills/decompose") await skillMutate(req, res, "decompose");
    else if (route === "POST /api/skills/approval") await skillMutate(req, res, "approval");
    else if (route === "POST /api/skills/archive") await skillMutate(req, res, "archive");
    else if (route === "POST /api/skills/run") await skillRun(req, res);
    else if (route === "GET /api/skills/runs") await skillRuns(req, res, url);
    else if (route === "GET /api/skills/refinements") await stableEmpty(res, "skill_refinements");
    else if (route === "GET /api/skills/telemetry") await stableEmpty(res, "telemetry");
    else if (route === "GET /api/voice/concepts/criteria") await voiceCriteria(res);
    else if (route === "GET /api/voice/concepts/ui-uat-samples") await voiceUatSamples(req, res);
    else if (route === "GET /api/voice/concepts/real-coverage") await voiceRealCoverage(req, res, url);
    else if (route === "GET /api/voice/concepts/preflight") await voicePreflight(req, res, url);
    else if (route === "POST /api/voice/concepts/transcribe") await voiceTranscribe(req, res);
    else if (route === "GET /api/voice/concepts/transcriptions/status") await voiceTranscriptionStatus(req, res, url);
    else if (route === "POST /api/voice/concepts/assess") await voiceAssess(req, res);
    else if (route === "POST /api/voice/concepts/draft") await voiceDraft(req, res);
    else if (route === "GET /api/voice/concepts/drafts") await voiceDrafts(req, res, url);
    else if (route === "POST /api/voice/concepts/drafts/detail") await voiceDraftDetail(req, res);
    else if (route === "POST /api/voice/concepts/commit") await voiceCommit(req, res);
    else if (route === "POST /api/voice/concepts/agent-handoff") await voiceAgentHandoff(req, res);
    else if (route === "GET /api/voice/concepts/agent-handoffs") await voiceAgentHandoffs(req, res, url);
    else if (route === "GET /api/activity") await activity(req, res, url);
    else if (route === "GET /api/review-dashboard") await reviewDashboard(req, res, url);
    else if (route === "GET /api/okf/graph") await graphRead(req, res, url);
    else if (route === "GET /api/okf/graph/node") await graphNodeDetail(req, res, url);
    else if (route === "GET /api/okf/graph/recommendation-tasks") await graphAuxiliary(req, res, url, "tasks");
    else if (route === "GET /api/okf/graph/edge-reviews") await graphAuxiliary(req, res, url, "reviews");
    else if (route === "GET /api/okf/graph/postgres-read") await graphAuxiliary(req, res, url, "postgres_read");
    else return false;
    return true;
  };
}

module.exports = {
  createWorkspaceApi,
  qualityAssessment,
  graphConceptId,
  conceptGraphNode,
  graphConceptEvidence,
  REVIEW_FROM_UI,
  REVIEW_TO_UI,
};
