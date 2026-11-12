const crypto = require("node:crypto");

function clean(value, max = 20_000) {
  return String(value || "").trim().slice(0, max);
}

function approvalRoute(approval = {}) {
  return clean(
    approval.original_response?.output?.route_decision?.route
      || approval.original_response?.trace?.route_decision?.route
      || approval.route_decision?.route
      || approval.route_decision,
    128,
  );
}

function approvalMessage(approval = {}) {
  return clean(
    approval.original_request?.chatInput
      || approval.original_request?.input?.message
      || approval.original_request?.input?.query,
  );
}

function approvalTwinId(approval = {}) {
  return clean(
    approval.original_request?.context?.active_twin_id
      || approval.original_request?.metadata?.identity?.activeTwinId,
    128,
  );
}

function compactTitle(message, fallback) {
  const first = clean(message, 500).split(/[.?!\n]/)[0]
    .replace(/^(please\s+)?(remember|save|store|retain|ingest|add|update|capture|stage|merke|speichere)\s+(this\s+)?(as\s+)?(knowledge|memory|note|wissen|notiz)?\s*:?[\s-]*/i, "")
    .replace(/^(please\s+)?(create|build|design|define|propose|draft|erstelle|entwickle)\s+(a\s+|an\s+|new\s+|neue[nmrs]?\s+)*(reusable\s+)?/i, "")
    .replace(/\b(skill|capability|agent|f[aä]higkeit)\b\s*$/i, "")
    .trim();
  return clean(first || fallback, 160);
}

function knowledgeStagePayload(approval = {}, body = {}) {
  const message = approvalMessage(approval);
  const twinId = approvalTwinId(approval);
  const supplied = body.concept && typeof body.concept === "object" ? body.concept : {};
  const title = clean(supplied.title || body.title || compactTitle(message, "Actor Twin knowledge proposal"), 300);
  return {
    twin_id: twinId,
    concept: {
      ...supplied,
      title,
      topic: clean(supplied.topic || title, 1_000),
      summary: clean(supplied.summary || message, 10_000),
      what_else_to_know: clean(supplied.what_else_to_know || supplied.notes || message, 40_000),
      visibility_scope: supplied.visibility_scope || "private",
      raw: {
        ...(supplied.raw && typeof supplied.raw === "object" ? supplied.raw : {}),
        source_request_id: approval.request_id || "",
        source_trace_id: approval.trace_id || "",
        source_message: message,
      },
    },
    source: {
      type: "agent_interaction",
      repository_ref: approval.trace_id || approval.request_id || "",
    },
    evidence: message ? [{ citation: { text: message, source: "approved_actor_interaction" }, confidence: 1 }] : [],
    change_reason: clean(body.approval_note || body.input?.approval_note || "Human-approved Actor Twin knowledge intake", 2_000),
  };
}

function skillProposalPayload(approval = {}, body = {}) {
  const message = approvalMessage(approval);
  const twinId = approvalTwinId(approval);
  const name = clean(body.name || body.skill_name || compactTitle(message, "Actor Twin skill proposal"), 160);
  return {
    skill_id: `${name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "skill"}-${crypto.randomBytes(3).toString("hex")}`,
    twin_id: twinId,
    name,
    description: clean(body.description || message, 30_000),
    risk_class: ["low", "medium", "high", "critical"].includes(body.risk_class) ? body.risk_class : "medium",
    spec: {
      name,
      description: clean(body.description || message, 30_000),
      elicitation_questions: [
        "When should this skill trigger, and when should it not?",
        "Which inputs and tools are required?",
        "Which actions require human approval?",
      ],
      approval_policy: "never_auto_approve_generated_skills",
      execution_hierarchy: "Actor Twin -> Agentic Butler -> Skill Orchestrator -> Task Agent",
      runtime_contract: "meids.agent-routing.v1",
      source_request_id: approval.request_id || "",
      source_trace_id: approval.trace_id || "",
    },
  };
}

async function stageSkillProposal(pool, mapping, payload, options = {}) {
  if (!payload.twin_id || !(mapping.allowed_twin_ids || []).includes(payload.twin_id)) {
    const error = new Error("The approved skill proposal is outside the authenticated twin scope.");
    error.statusCode = 403;
    throw error;
  }
  const externalClient = options.client || null;
  const client = externalClient || await pool.connect();
  try {
    if (!externalClient) await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [mapping.tenant_id]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [mapping.user_id]);
    await client.query("SELECT set_config('app.allowed_twin_ids', $1, true)", [(mapping.allowed_twin_ids || []).join(",")]);
    await client.query("SELECT set_config('app.group_ids', $1, true)", [(mapping.group_ids || []).join(",")]);
    const inserted = await client.query(
      `INSERT INTO agent.skill_spec
        (skill_id, tenant_id, owner_user_id, twin_id, name, description, status, risk_class, spec)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending_approval', $7, $8::jsonb)
       RETURNING skill_id, twin_id, name, status, risk_class, version`,
      [payload.skill_id, mapping.tenant_id, mapping.user_id, payload.twin_id, payload.name, payload.description, payload.risk_class, JSON.stringify(payload.spec)],
    );
    await client.query(
      `INSERT INTO audit.event (tenant_id, actor_user_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, 'skill.elicit', 'agent.skill_spec', $3, $4::jsonb)`,
      [mapping.tenant_id, mapping.user_id, payload.skill_id, JSON.stringify({ twin_id: payload.twin_id, source: "azure_native_approval_resume" })],
    );
    if (!externalClient) await client.query("COMMIT");
    return { status: "pending_approval", skill: inserted.rows[0] };
  } catch (error) {
    if (!externalClient) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (!externalClient) client.release();
  }
}

module.exports = {
  approvalRoute,
  approvalMessage,
  approvalTwinId,
  knowledgeStagePayload,
  skillProposalPayload,
  stageSkillProposal,
};
