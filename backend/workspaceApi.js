const crypto = require("node:crypto");

const MAX_AVATAR_BYTES = 1_500_000;
const TEXT_DOCUMENT_EXTENSIONS = new Set(["txt", "md", "markdown", "json", "csv", "yaml", "yml", "xml"]);
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
    source_refs: citations,
    tags: Array.isArray(content.tags) ? content.tags : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata: {
      review_state: REVIEW_TO_UI[row.review_state] || row.review_state,
      visibility_scope: row.visibility_scope,
      content,
      evidence_count: Number(row.evidence_count || citations.length || 0),
    },
  };
}

async function queryConcepts(pool, mapping, twinId, conceptId = "") {
  return withContext(pool, mapping, async (client) => {
    const result = await client.query(
      `SELECT concept.*, revision.content, revision.revision,
        COALESCE(evidence_data.citations, '[]'::jsonb) AS citations,
        COALESCE(evidence_data.evidence_count, 0) AS evidence_count
       FROM knowledge.concept concept
       JOIN knowledge.concept_revision revision
         ON revision.concept_id = concept.concept_id AND revision.revision = concept.current_revision
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(evidence.citation ORDER BY evidence.created_at) AS citations,
           count(*)::int AS evidence_count
         FROM knowledge.evidence evidence WHERE evidence.concept_id = concept.concept_id
       ) evidence_data ON true
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
  const score = Math.round((coverage * 0.7 + wordScore * 0.3) * 100);
  return {
    ready: words.length >= 45 && missing.length <= 1,
    category: clean(body.category || "process_insight", 100),
    category_label: clean(body.category || "Process insight", 100),
    summary: transcript.split(/[.!?]\s/)[0].slice(0, 240) || "Voice knowledge concept",
    consistency_score: score,
    eligibility_score: score,
    missing_dimensions: missing,
    dimensions,
    next_question: missing.length ? questionByDimension[missing[0]] : "What exception or failure mode would an experienced colleague know to watch for?",
  };
}

function skillRecord(row) {
  return {
    skill_id: row.skill_id,
    name: row.name,
    description: row.description,
    status: row.status,
    risk_class: row.risk_class,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    spec: row.spec || {},
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
  } = deps;

  async function context(req, body = {}, knowledge = false) {
    const mapping = knowledge
      ? await requireKnowledgeRequestMapping(req, body)
      : await requireTwinRequestMapping(req);
    return { mapping, pool: await getPgPool() };
  }

  async function picture(req, res, remove = false) {
    const form = remove ? { fields: await readBody(req), files: {} } : await readMultipartForm(req);
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
    const form = await readMultipartForm(req);
    const { mapping, pool } = await context(req, form.fields, true);
    const twinId = assertTwin(mapping, form.fields.twin || form.fields.twin_id);
    const file = form.files.file;
    if (!file) throw httpError(400, "A document file is required.");
    const extension = file.filename.split(".").pop().toLowerCase();
    if (!file.type.startsWith("text/") && !TEXT_DOCUMENT_EXTENSIONS.has(extension) && !["application/json", "application/xml"].includes(file.type)) {
      throw httpError(415, "This production path currently supports text, Markdown, JSON, CSV, YAML, and XML. Binary PDF/DOCX extraction requires the document-extraction worker.");
    }
    const text = file.buffer.toString("utf8").replace(/\0/g, "").trim();
    if (!text) throw httpError(422, "The uploaded document contains no readable text.");
    const title = clean(file.filename.replace(/\.[^.]+$/, ""), 200) || "Uploaded document";
    const staged = await stageKnowledge(pool, mapping, {
      twin_id: twinId,
      concept: { title, topic: title, summary: text.slice(0, 2_000), how_to_apply: text.slice(0, 80_000), raw: { type: "Document Upload", source_name: file.filename, media_type: file.type } },
      source: { type: extension || "document", name: file.filename, size: file.buffer.length, checksum: crypto.createHash("sha256").update(file.buffer).digest("hex") },
      evidence: [{ citation: { type: "uploaded_document", title: file.filename, media_type: file.type }, confidence: 1 }],
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
      metadata: { title: concept.title, type: concept.type, review_state: concept.review_state, visibility_scope: concept.visibility_scope, tags: concept.tags, evidence_count: concept.metadata.evidence_count },
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
    jsonResponse(res, 200, { skill: skillRecord(result.rows[0]) });
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
    const response = await proxyToN8n("actor_twin", envelope);
    jsonResponse(res, 200, { status: response.status || "completed", run_id: requestId, skill_id: skillId, skill_name: skill.name, result: response.output || response, orchestration: { entry_agent: "actor_twin", delegation: "Call n8n Workflow Tool" } });
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

  async function voiceAssess(req, res) {
    const body = await readBody(req);
    await context(req, body, true);
    if (!clean(body.transcript)) throw httpError(400, "Transcript is required.");
    const assessment = qualityAssessment(body);
    jsonResponse(res, 200, { assessment, agent: { id: "knowledge_retrieval_agent", mode: "circular_interview" }, conversation: { turn_count: (body.replies || []).length + 1 } });
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
    jsonResponse(res, 200, { drafts: result.rows.map((row) => ({ ...row, path: String(row.draft_id), title: row.assessment?.summary || row.category })) });
  }

  async function voiceDraftDetail(req, res) {
    const body = await readBody(req);
    const { mapping, pool } = await context(req, body, true);
    const result = await withContext(pool, mapping, (client) => client.query(
      "SELECT * FROM runtime.voice_concept_draft WHERE tenant_id = $1 AND owner_user_id = $2 AND draft_id::text = $3",
      [mapping.tenant_id, mapping.user_id, clean(body.path, 128)],
    ));
    if (!result.rowCount) throw httpError(404, "Voice concept draft not found.");
    jsonResponse(res, 200, { draft: { ...result.rows[0], path: String(result.rows[0].draft_id) } });
  }

  async function voiceCommit(req, res) {
    const body = await readBody(req);
    const { mapping, pool } = await context(req, body, true);
    const twinId = assertTwin(mapping, body.twin || body.twin_id);
    const assessment = qualityAssessment(body);
    if (!assessment.ready) throw httpError(409, "The circular interview quality gate is not met yet.");
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
        raw: { type: "Voice Concept", category: body.category, assessment },
      },
      source: { type: "voice_transcript", label: clean(body.source_label || "voice-concept-conversation", 200) },
      evidence: [{ citation: { type: "voice_transcript", title: assessment.summary, conversation_turns: (body.replies || []).length + 1 }, confidence: assessment.eligibility_score / 100 }],
      change_reason: "Guided voice capture quality gate passed",
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
    const result = await pool.query(
      `SELECT action, resource_type, resource_id, details, created_at, actor_user_id
       FROM audit.event WHERE tenant_id = $1
         AND (details->>'twin_id' = $2 OR resource_id = $2 OR details->>'active_twin_id' = $2)
       ORDER BY created_at DESC LIMIT $3`,
      [mapping.tenant_id, twinId, Math.min(200, Number(url.searchParams.get("limit")) || 50)],
    );
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
    else if (route === "GET /api/skills/runs") await stableEmpty(res, "skill_runs");
    else if (route === "GET /api/skills/refinements") await stableEmpty(res, "skill_refinements");
    else if (route === "GET /api/skills/telemetry") await stableEmpty(res, "telemetry");
    else if (route === "GET /api/voice/concepts/criteria") await voiceCriteria(res);
    else if (route === "POST /api/voice/concepts/assess") await voiceAssess(req, res);
    else if (route === "POST /api/voice/concepts/draft") await voiceDraft(req, res);
    else if (route === "GET /api/voice/concepts/drafts") await voiceDrafts(req, res, url);
    else if (route === "POST /api/voice/concepts/drafts/detail") await voiceDraftDetail(req, res);
    else if (route === "POST /api/voice/concepts/commit") await voiceCommit(req, res);
    else if (route === "GET /api/activity") await activity(req, res, url);
    else if (route === "GET /api/review-dashboard") await reviewDashboard(req, res, url);
    else return false;
    return true;
  };
}

module.exports = { createWorkspaceApi, qualityAssessment, REVIEW_FROM_UI, REVIEW_TO_UI };
