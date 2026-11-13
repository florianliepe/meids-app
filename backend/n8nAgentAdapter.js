const crypto = require("node:crypto");

function optionalString(value, field) {
  if (value == null) return "";
  if (typeof value !== "string") {
    const error = new Error(`Actor Twin n8n ${field} must be a string.`);
    error.statusCode = 400;
    throw error;
  }
  return value.trim();
}

function n8nAgentEnvelope(agentId, envelope = {}) {
  if (agentId !== "actor_twin") return envelope;

  const requestId = optionalString(envelope.request_id, "request_id");
  const explicitSessionId = optionalString(envelope.sessionId ?? envelope.session_id, "sessionId");
  const logicalSessionId = explicitSessionId || requestId;
  if (!logicalSessionId) {
    const error = new Error("Actor Twin n8n requests require a request or session ID.");
    error.statusCode = 400;
    throw error;
  }

  const tenantId = optionalString(envelope.principal?.tenant_id || envelope.metadata?.identity?.tenantId, "tenant scope");
  const userId = optionalString(envelope.principal?.user_id || envelope.metadata?.identity?.userId, "user scope");
  const twinId = optionalString(envelope.context?.active_twin_id || envelope.metadata?.identity?.activeTwinId, "twin scope");
  if (!tenantId || !userId || !twinId) {
    const error = new Error("Actor Twin n8n sessions require tenant, user, and twin scope.");
    error.statusCode = 400;
    throw error;
  }

  const chatInput = optionalString(envelope.chatInput, "chatInput");
  const inputMessage = optionalString(envelope.input?.message, "input.message");
  const message = chatInput || inputMessage;
  if (!message) {
    const error = new Error("Actor Twin n8n requests require a text message.");
    error.statusCode = 400;
    throw error;
  }

  const sessionId = `meids_${crypto.createHash("sha256")
    .update(JSON.stringify([tenantId, userId, twinId, logicalSessionId]))
    .digest("hex")}`;
  return {
    ...envelope,
    action: "sendMessage",
    sessionId,
    chatInput: message,
  };
}

module.exports = { n8nAgentEnvelope };
