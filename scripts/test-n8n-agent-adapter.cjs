const test = require("node:test");
const assert = require("node:assert/strict");
const { n8nAgentEnvelope } = require("../backend/n8nAgentAdapter");

function actorEnvelope(overrides = {}) {
  return {
    request_id: "req-123",
    principal: { tenant_id: "tenant-a", user_id: "user-a" },
    context: { active_twin_id: "twin-a" },
    input: { message: "Hello" },
    ...overrides,
  };
}

test("Actor rollback requests always satisfy the n8n chat memory contract", () => {
  const normalized = n8nAgentEnvelope("actor_twin", actorEnvelope());

  assert.equal(normalized.action, "sendMessage");
  assert.match(normalized.sessionId, /^meids_[a-f0-9]{64}$/);
  assert.equal(normalized.chatInput, "Hello");
});

test("explicit Actor session takes priority and client action cannot override sendMessage", () => {
  const normalized = n8nAgentEnvelope("actor_twin", actorEnvelope({
    action: "deleteEverything",
    sessionId: "session-456",
    chatInput: "Existing message",
  }));
  const requestFallback = n8nAgentEnvelope("actor_twin", actorEnvelope());

  assert.notEqual(normalized.sessionId, requestFallback.sessionId);
  assert.equal(normalized.action, "sendMessage");
  assert.equal(normalized.chatInput, "Existing message");
});

test("the same logical session is isolated by tenant, user, and twin", () => {
  const base = actorEnvelope({ sessionId: "shared-session" });
  const first = n8nAgentEnvelope("actor_twin", base);
  const otherTenant = n8nAgentEnvelope("actor_twin", actorEnvelope({
    sessionId: "shared-session",
    principal: { tenant_id: "tenant-b", user_id: "user-a" },
  }));
  const otherUser = n8nAgentEnvelope("actor_twin", actorEnvelope({
    sessionId: "shared-session",
    principal: { tenant_id: "tenant-a", user_id: "user-b" },
  }));
  const otherTwin = n8nAgentEnvelope("actor_twin", actorEnvelope({
    sessionId: "shared-session",
    context: { active_twin_id: "twin-b" },
  }));

  assert.equal(new Set([first.sessionId, otherTenant.sessionId, otherUser.sessionId, otherTwin.sessionId]).size, 4);
});

test("non-Actor agent envelopes remain unchanged", () => {
  const envelope = { request_id: "req-123", input: { message: "Retrieve" } };
  assert.equal(n8nAgentEnvelope("knowledge_fabric_agent", envelope), envelope);
  assert.deepEqual(envelope, { request_id: "req-123", input: { message: "Retrieve" } });
});

test("Actor rollback requests fail closed without a correlation ID", () => {
  assert.throws(
    () => n8nAgentEnvelope("actor_twin", actorEnvelope({ request_id: "" })),
    /require a request or session ID/,
  );
});

test("Actor rollback requests fail closed on malformed fields or missing scope", () => {
  assert.throws(() => n8nAgentEnvelope("actor_twin", actorEnvelope({ sessionId: {} })), /sessionId must be a string/);
  assert.throws(() => n8nAgentEnvelope("actor_twin", actorEnvelope({ chatInput: {} })), /chatInput must be a string/);
  assert.throws(() => n8nAgentEnvelope("actor_twin", actorEnvelope({ principal: {} })), /require tenant, user, and twin scope/);
});
