const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { searchVectorKnowledge } = require("../backend/azureSearch");

async function withSearchStub(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

function config(endpoint, overrides = {}) {
  return {
    endpoint,
    apiKey: "synthetic-key",
    authMode: "api_key",
    approvedIndex: "approved",
    workingIndex: "working",
    apiVersion: "2025-09-01",
    configured: true,
    embeddingConfigured: false,
    requestTimeoutMs: 100,
    retrievalDeadlineMs: Date.now() + 1_000,
    ...overrides,
  };
}

test("read-only Search timeout is retried once inside the original deadline", async () => {
  let calls = 0;
  const observed = [];
  await withSearchStub((request, response) => {
    calls += 1;
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => observed.push({ authorization: request.headers["api-key"], body: Buffer.concat(chunks).toString("utf8") }));
    if (calls === 1) {
      setTimeout(() => { if (!response.writableEnded) response.end(JSON.stringify({ value: [] })); }, 180);
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ value: [{ id: "e1", title: "Reviewed" }] }));
  }, async (endpoint) => {
    const result = await searchVectorKnowledge({ query: "synthetic", twin_id: "florian", organization_id: "eraneos" }, config(endpoint));
    assert.equal(result.status, "completed");
    assert.equal(result.search_retry_count, 1);
    assert.equal(result.results[0].count, 1);
    assert.equal(calls, 2);
    assert.equal(observed.length, 2);
    assert.equal(observed[0].authorization, observed[1].authorization);
    assert.equal(observed[0].body, observed[1].body);
  });
});

test("exhausted Search timeout is visible, non-fallback, and never retried a third time", async () => {
  let calls = 0;
  await withSearchStub((request, response) => {
    calls += 1;
    setTimeout(() => { if (!response.writableEnded) response.end(JSON.stringify({ value: [] })); }, 180);
  }, async (endpoint) => {
    await assert.rejects(
      () => searchVectorKnowledge({ query: "synthetic", twin_id: "florian", organization_id: "eraneos" }, config(endpoint)),
      (error) => {
        assert.equal(error.code, "azure_search_unavailable");
        assert.equal(error.statusCode, 503);
        assert.equal(error.noRetry, true);
        return true;
      },
    );
    assert.equal(calls, 2);
  });
});

test("nearly exhausted retrieval deadline prevents a late second Search call", async () => {
  let calls = 0;
  await withSearchStub((request, response) => {
    calls += 1;
    setTimeout(() => { if (!response.writableEnded) response.end(JSON.stringify({ value: [] })); }, 180);
  }, async (endpoint) => {
    await assert.rejects(
      () => searchVectorKnowledge({ query: "synthetic", twin_id: "florian", organization_id: "eraneos" }, config(endpoint, { retrievalDeadlineMs: Date.now() + 400 })),
      (error) => ["azure_search_timeout", "azure_search_unavailable"].includes(error.code),
    );
    assert.equal(calls, 1);
  });
});

test("cancellation during retry wait prevents a late second Search call", async () => {
  let calls = 0;
  const controller = new AbortController();
  await withSearchStub((request, response) => {
    calls += 1;
    setTimeout(() => { if (!response.writableEnded) response.end(JSON.stringify({ value: [] })); }, 180);
  }, async (endpoint) => {
    setTimeout(() => controller.abort(), 120);
    await assert.rejects(
      () => searchVectorKnowledge({ query: "synthetic", twin_id: "florian", organization_id: "eraneos" }, config(endpoint, { retrievalSignal: controller.signal })),
      (error) => error.code === "azure_search_cancelled" && error.noRetry === true,
    );
    assert.equal(calls, 1);
  });
});

test("an already-aborted retrieval signal prevents the first Search dispatch", async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  await withSearchStub((request, response) => {
    calls += 1;
    response.end(JSON.stringify({ value: [] }));
  }, async (endpoint) => {
    await assert.rejects(
      () => searchVectorKnowledge({ query: "synthetic", twin_id: "florian", organization_id: "eraneos" }, config(endpoint, { retrievalSignal: controller.signal })),
      (error) => error.code === "azure_search_cancelled" && error.noRetry === true,
    );
    assert.equal(calls, 0);
  });
});

test("authorized empty Search is completed and distinct from dependency failure", async () => {
  let calls = 0;
  await withSearchStub((request, response) => {
    calls += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ value: [] }));
  }, async (endpoint) => {
    const result = await searchVectorKnowledge({ query: "synthetic", twin_id: "florian", organization_id: "eraneos" }, config(endpoint));
    assert.equal(result.status, "completed");
    assert.equal(result.results[0].count, 0);
    assert.equal(result.search_retry_count, 0);
    assert.equal(calls, 1);
  });
});

test("Search authorization failure is not retried or degraded to empty evidence", async () => {
  let calls = 0;
  await withSearchStub((request, response) => {
    calls += 1;
    response.writeHead(403, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "forbidden" } }));
  }, async (endpoint) => {
    await assert.rejects(
      () => searchVectorKnowledge({ query: "synthetic", twin_id: "florian", organization_id: "eraneos" }, config(endpoint)),
      (error) => error.statusCode === 403 && error.message === "forbidden",
    );
    assert.equal(calls, 1);
  });
});
