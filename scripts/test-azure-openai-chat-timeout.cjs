const test = require("node:test");
const assert = require("node:assert/strict");
const { completeChat } = require("../backend/azureOpenAiChat");

function testConfig() {
  return {
    provider: "azure_openai",
    configured: true,
    endpoint: "https://azure-openai.invalid",
    deployment: "test-deployment",
    apiKey: "test-only-key",
    authMode: "api_key",
    apiVersion: "2024-10-21",
    timeoutMs: 5_000,
    maxOutputTokens: 256,
  };
}

test("provider timeout is unknown completion and cannot be retried", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    const error = new Error("synthetic timeout after request acceptance");
    error.name = "TimeoutError";
    throw error;
  };
  try {
    await assert.rejects(
      () => completeChat([{ role: "user", content: "synthetic no-write probe" }], { config: testConfig() }),
      (error) => {
        assert.equal(error.statusCode, 504);
        assert.equal(error.code, "azure_chat_timeout");
        assert.equal(error.noRetry, true);
        assert.equal(error.unknownCompletion, true);
        return true;
      },
    );
  } finally {
    global.fetch = originalFetch;
  }
});
