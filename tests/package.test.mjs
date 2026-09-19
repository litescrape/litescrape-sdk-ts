import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import * as sdk from "litescrape-sdk";
import { batchBackend, cachePath, item, mockApi } from "./helpers.mjs";

test("package exports work in ESM and CommonJS and match the version", async (t) => {
  const common = createRequire(import.meta.url)("litescrape-sdk");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(sdk.VERSION, pkg.version);
  assert.equal(common.VERSION, pkg.version);
  assert.deepEqual(Object.keys(common.REQUEST_TYPES), Object.keys(sdk.REQUEST_TYPES));
  for (const library of [sdk, common]) {
    const api = mockApi();
    const [result] = await library.scrape([new library.GoogleSearch({ q: "cjs/esm" })], api.options);
    assert.equal(result.data.search_parameters.q, "cjs/esm");
    assert.equal(result.request.path, "/api/google/search");
    batchBackend(api);
    const [durable] = await library.scrape([new library.GoogleSearch({ q: "durable" })], {
      ...api.options,
      batched: true,
      cachePath: cachePath(t),
    });
    assert.equal(durable.ok, true);
    assert.equal(durable.jobId, "job-0");
  }
});

test("native fetch sends the expected wire request and aborts a transport timeout", async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    requests.push({ url, headers: request.headers });
    response.setHeader("content-type", "application/json");
    if (url.pathname === "/api/keys/status")
      return response.end(JSON.stringify({ remaining_calls: 100, concurrency_limit: 2 }));
    if (url.searchParams.get("q") === "timeout") return;
    response.setHeader("x-request-id", "wire-id");
    response.end(JSON.stringify({ search_parameters: Object.fromEntries(url.searchParams) }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const options = {
    apiKey: "wire-test-key",
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    attempts: 1,
  };
  const [result] = await sdk.scrape([item("café & tea")], options);
  assert.equal(result.requestId, "wire-id");
  assert.equal(result.data.search_parameters.q, "café & tea");
  assert.equal(requests[1].headers.authorization, "Bearer wire-test-key");
  assert.equal(requests[1].headers["x-litescrape-client"], `typescript-sdk/${sdk.VERSION}`);
  const [timedOut] = await sdk.scrape([item("timeout")], { ...options, timeout: 0.05 });
  assert.ok(timedOut.error instanceof sdk.TransportError);
  assert.equal(timedOut.error.retryable, true);
  assert.equal(timedOut.statusCode, null);
});
