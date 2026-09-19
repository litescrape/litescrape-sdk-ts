import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import * as sdk from "../dist/esm/index.js";
import { backoff, shouldRetry, Semaphore } from "../dist/esm/runtime.js";
import { apiError, parseRetryAfter } from "../dist/esm/errors.js";
import { envelope, item, json, mockApi } from "./helpers.mjs";

test("entire input is validated before status or scrape; failures retain indices", async () => {
  const api = mockApi();
  await assert.rejects(
    sdk.scrape([item("ok"), { endpoint: "google_maps", q: "x" }, { q: "no endpoint" }], api.options),
    (error) => {
      assert.ok(error instanceof sdk.ValidationError);
      assert.deepEqual(
        error.problems.map(([i]) => i),
        [1, 2],
      );
      return true;
    },
  );
  assert.equal(api.calls.length, 0);
  assert.deepEqual(await sdk.scrape([]), []);
  await assert.rejects(sdk.scrape(new Array(2), api.options), sdk.ValidationError);
});

test("all option bounds reject before HTTP", async () => {
  const api = mockApi();
  const bad = [
    { attempts: 0 },
    { attempts: 1.5 },
    { attempts: NaN },
    { concurrency: 0 },
    { concurrency: Infinity },
    { timeout: 0 },
    { timeout: Infinity },
    { timeout: "5" },
    { useCache: true },
    ...[0, -1, 90.01, NaN, Infinity, true, "15"].map((requestTimeout) => ({ requestTimeout })),
  ];
  for (const options of bad)
    await assert.rejects(sdk.scrape([item("x")], { ...api.options, ...options }), RangeError);
  assert.equal(api.calls.length, 0);
});

test("key resolution, URL precedence and SDK attribution on every request", async (t) => {
  const oldKey = process.env.LITESCRAPE_API_KEY;
  const oldUrl = process.env.LITESCRAPE_API_URL;
  t.after(() => {
    if (oldKey === undefined) delete process.env.LITESCRAPE_API_KEY;
    else process.env.LITESCRAPE_API_KEY = oldKey;
    if (oldUrl === undefined) delete process.env.LITESCRAPE_API_URL;
    else process.env.LITESCRAPE_API_URL = oldUrl;
  });
  process.env.LITESCRAPE_API_KEY = "env-key";
  process.env.LITESCRAPE_API_URL = "https://env.test/";
  const api = mockApi();
  await sdk.scrape([item("café & tea")], { fetch: api.fetch });
  assert.equal(new URL(api.calls[0].url).origin, "https://env.test");
  for (const request of api.calls) {
    assert.equal(request.headers.get("authorization"), "Bearer env-key");
    assert.equal(request.headers.get("x-litescrape-client"), `typescript-sdk/${sdk.VERSION}`);
    assert.match(request.headers.get("user-agent"), /^litescrape-sdk\/0\.1\.0 \(Node\//);
    assert.equal(request.headers.get("accept"), "application/json");
    assert.equal(request.redirect, "manual");
  }
  await sdk.scrape([item("explicit")], { ...api.options, baseUrl: "https://explicit.test/" });
  assert.equal(new URL(api.calls.at(-1).url).origin, "https://explicit.test");
  assert.equal(api.calls.at(-1).headers.get("authorization"), "Bearer ls_live_test_key");
  process.env.LITESCRAPE_API_KEY = " ";
  await assert.rejects(
    sdk.scrape([item("x")], { fetch: api.fetch }),
    (error) => error instanceof sdk.AuthenticationError && error.errorCode === "missing_api_key",
  );
});

test("key status validates body, preserves extras, and checks balance", async () => {
  const api = mockApi();
  api.status.extra = "future-field";
  const status = await sdk.keyStatus(api.options);
  assert.equal(status.extra, "future-field");
  assert.equal(status.request_id, "status-id");
  api.status.remaining_calls = 0;
  await assert.rejects(sdk.scrape([item("x")], api.options), sdk.PaymentRequiredError);
  assert.ok(api.calls.every((r) => new URL(r.url).pathname === "/api/keys/status"));
  delete api.status.remaining_calls;
  await assert.rejects(sdk.keyStatus(api.options), sdk.TransportError);
});

test("results stay ordered while progress follows completion, with bounded concurrency", async () => {
  const api = mockApi();
  api.status.concurrency_limit = 3;
  api.handle = async (request) => {
    const q = new URL(request.url).searchParams.get("q");
    await delay(q === "0" ? 30 : 1);
    return json({ q });
  };
  const progress = [];
  const results = await sdk.scrape(
    Array.from({ length: 15 }, (_, i) => item(String(i))),
    {
      ...api.options,
      concurrency: 50,
      onProgress: (count, total, result) => progress.push([count, total, result.index]),
    },
  );
  assert.equal(api.peak, 3);
  assert.deepEqual(
    results.map((r) => r.data.q),
    Array.from({ length: 15 }, (_, i) => String(i)),
  );
  assert.notEqual(progress[0][2], 0);
  assert.deepEqual(
    progress.map((p) => p[0]),
    Array.from({ length: 15 }, (_, i) => i + 1),
  );
  assert.ok(progress.every((p) => p[1] === 15));
  assert.ok(results.every((r) => r.ok && r.elapsed >= 0 && r.attempts === 1));
  assert.equal(results[0].raiseForError(), results[0].data);
});

test("overlapping calls share the key limit, even with different per-call overrides", async () => {
  const api = mockApi();
  api.status.concurrency_limit = 4;
  api.handle = async () => {
    await delay(2);
    return json({ ok: true });
  };
  const items = Array.from({ length: 12 }, (_, i) => item(String(i)));
  await Promise.all([
    sdk.scrape(items, { ...api.options, concurrency: 2 }),
    sdk.scrape(items, { ...api.options, concurrency: 20 }),
  ]);
  assert.equal(api.peak, 4);
  api.peak = 0;
  api.status.concurrency_limit = 6;
  await sdk.scrape(items, api.options);
  assert.equal(api.peak, 6);
});

test("server deadlines inherit per item without changing transport timeouts or originals", async () => {
  const api = mockApi();
  const original = new sdk.GoogleSearch({ q: "default" });
  const results = await sdk.scrape(
    [original, new sdk.GoogleSearch({ q: "override", timeout: 2.5 }), { ...item("dict"), timeout: 90 }],
    { ...api.options, requestTimeout: 15 },
  );
  assert.deepEqual(
    results.map((r) => r.request.timeout),
    [15, 2.5, 90],
  );
  assert.equal(original.timeout, undefined);
  assert.ok(!new URL(api.calls[0].url).searchParams.has("timeout"));
  assert.deepEqual(
    api.calls.slice(1).map((r) => new URL(r.url).searchParams.get("timeout")),
    ["15", "2.5", "90"],
  );
  const other = mockApi();
  await sdk.scrape([item("x")], { ...other.options, timeout: 7 });
  assert.ok(other.calls.every((r) => !new URL(r.url).searchParams.has("timeout")));
  const token = Buffer.from(
    JSON.stringify({
      v: 1,
      operation: "apps",
      context: { hl: "en", gl: "us", q: "coffee" },
      kind: "page",
      token: "native-cursor",
    }),
  ).toString("base64url");
  const [continued] = await sdk.scrape(
    [{ endpoint: "google_play_apps", q: "coffee", next_page_token: token }],
    {
      ...api.options,
      requestTimeout: 15,
    },
  );
  assert.equal(continued.ok, true);
  assert.equal(continued.request.timeout, 15);
  assert.ok(continued.request instanceof sdk.GooglePlayApps);
});

test("deadline errors retain envelope details and retry with Retry-After", async () => {
  const api = mockApi();
  api.handle = () => envelope(503, "request_deadline_exceeded", true, { "retry-after": "10" });
  const [result] = await sdk.scrape([item("x")], { ...api.options, attempts: 1 });
  assert.ok(result.error instanceof sdk.RequestDeadlineExceededError);
  assert.equal(result.error.retryAfter, 10);
  assert.equal(result.error.requestId, "abc123");
  assert.equal(result.statusCode, 503);
  assert.equal(result.requestId, "abc123");
  assert.equal(result.error.retryable, true);
  assert.throws(() => result.raiseForError(), sdk.RequestDeadlineExceededError);
  let calls = 0;
  api.handle = () =>
    calls++ === 0
      ? envelope(503, "request_deadline_exceeded", true, { "retry-after": "0" })
      : json({ ok: true });
  const [retried] = await sdk.scrape([item("x")], { ...api.options, attempts: 2 });
  assert.ok(retried.ok);
  assert.equal(retried.attempts, 2);
});

for (const [status, code, ErrorClass] of [
  [400, "bad_request", sdk.APIError],
  [401, "invalid_api_key", sdk.AuthenticationError],
  [402, "payment_required", sdk.PaymentRequiredError],
  [403, "forbidden", sdk.APIError],
  [404, "not_found", sdk.NotFoundError],
  [422, "validation_error", sdk.APIError],
])
  test(`HTTP ${status} becomes a typed result without retrying`, async () => {
    const api = mockApi();
    api.handle = () => envelope(status, code);
    const [result] = await sdk.scrape([item("x")], api.options);
    assert.ok(result.error instanceof ErrorClass);
    assert.equal(result.attempts, 1);
    assert.equal(api.calls.length, 2);
  });

test("429, 5xx, and retryable envelopes retry up to the attempt budget", async () => {
  for (const [status, code, retryable] of [
    [429, "rate_limited", false],
    [502, "bad_gateway", false],
    [409, "upstream_session_unavailable", false],
    [400, "custom", true],
  ]) {
    const api = mockApi();
    api.handle = () => envelope(status, code, retryable, { "retry-after": "0" });
    const [result] = await sdk.scrape([item("x")], { ...api.options, attempts: 3 });
    assert.equal(result.attempts, 3);
    assert.equal(api.calls.length, 4);
  }
});

for (const [status, code] of [
  [401, "invalid_api_key"],
  [402, "payment_required"],
  [403, "api_key_disabled"],
])
  test(`fatal ${code} stops unsent work`, async () => {
    const api = mockApi();
    api.status.concurrency_limit = 1;
    api.handle = () => envelope(status, code);
    const results = await sdk.scrape([item("a"), item("b"), item("c")], api.options);
    assert.deepEqual(
      results.map((r) => r.attempts),
      [1, 0, 0],
    );
    assert.ok(results.every((r) => r.error === results[0].error));
    assert.equal(api.calls.length, 2);
  });

test("transport failures, bad JSON and unexpected handlers are results", async () => {
  for (const [handle, retryable] of [
    [
      () => {
        throw new TypeError("fetch failed");
      },
      true,
    ],
    [() => new Response("not JSON"), true],
    [() => json([]), true],
    [
      () => {
        throw new Error("unexpected");
      },
      false,
    ],
  ]) {
    const api = mockApi();
    api.handle = handle;
    const [result] = await sdk.scrape([item("x")], { ...api.options, attempts: 1 });
    assert.ok(result.error instanceof sdk.TransportError);
    assert.equal(result.error.retryable, retryable);
  }
  const api = mockApi();
  let calls = 0;
  api.handle = () => {
    if (calls++ === 0) throw new TypeError("fetch failed");
    return json({ ok: true });
  };
  const [result] = await sdk.scrape([item("x")], { ...api.options, attempts: 2 });
  assert.equal(result.attempts, 2);
  assert.ok(result.ok);
});

test("cancellation stops requests, queued work and retry backoff", async () => {
  const api = mockApi();
  api.handle = async (request) => {
    await delay(10000, null, { signal: request.signal });
    return json({});
  };
  await assert.rejects(
    sdk.scrape([item("x"), item("y")], { ...api.options, signal: AbortSignal.timeout(20) }),
    { name: "TimeoutError" },
  );
  assert.equal(api.active, 0);
  api.handle = () => envelope(503, "service_unavailable", true, { "retry-after": "30" });
  await assert.rejects(sdk.scrape([item("x")], { ...api.options, signal: AbortSignal.timeout(20) }), {
    name: "TimeoutError",
  });
  const semaphore = new Semaphore(1);
  const unlock = await semaphore.acquire();
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException("test timeout", "TimeoutError")), 20);
  await assert.rejects(semaphore.acquire(controller.signal), { name: "TimeoutError" });
  unlock();
  const next = await semaphore.acquire();
  next();
});

test("backoff caps and HTTP-date parsing follow the Python policy", () => {
  assert.equal(backoff(1, 120), 30);
  assert.equal(backoff(1, 0), 0);
  for (let n = 1; n <= 10; n++) {
    const cap = Math.min(30, 2 ** (n - 1));
    const value = backoff(n);
    assert.ok(value >= cap / 2 && value <= cap);
  }
  assert.equal(parseRetryAfter("10"), 10);
  assert.equal(parseRetryAfter("nonsense"), null);
  assert.equal(parseRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT"), 0);
  assert.ok(parseRetryAfter(new Date(Date.now() + 5000).toUTCString()) > 3);
  const plain = apiError(404, { detail: "gone" });
  assert.ok(plain instanceof sdk.NotFoundError);
  assert.equal(plain.message, "gone");
  assert.equal(shouldRetry(new sdk.ValidationError([[0, "bad"]])), false);
  assert.equal(sdk.ascrape, sdk.scrape);
  assert.equal(sdk.akey_status, sdk.keyStatus);
});
