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
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
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
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("a definitive provider 429 is retried once inside the response budget", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { message: "synthetic throttle" } }), {
        status: 429,
        headers: { "retry-after-ms": "0", "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "ready" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await completeChat([{ role: "user", content: "synthetic no-write probe" }], { config: testConfig() });
    assert.equal(result.text, "ready");
    assert.equal(result.throttleRetries, 1);
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("exhausted provider throttling stays a visible 429", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: "synthetic throttle" } }), {
      status: 429,
      headers: { "retry-after-ms": "0", "content-type": "application/json" },
    });
  };
  try {
    await assert.rejects(
      () => completeChat([{ role: "user", content: "synthetic no-write probe" }], { config: testConfig() }),
      (error) => {
        assert.equal(error.statusCode, 429);
        assert.equal(error.code, "azure_chat_throttled");
        assert.equal(error.throttleRetries, 1);
        return true;
      },
    );
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});
