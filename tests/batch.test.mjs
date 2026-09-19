import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { scrape, GoogleSearch, TransportError, PaymentRequiredError } from "../dist/esm/index.js";
import { cacheKeys, JobCache } from "../dist/esm/cache.js";
import { batchBackend, cachePath, envelope, item, json, mockApi } from "./helpers.mjs";

test("submit all before polling; resume reordered inputs with zero balance", async (t) => {
  const api = mockApi();
  const { submissions } = batchBackend(api);
  const options = { ...api.options, batched: true, cachePath: cachePath(t) };
  const inputs = [item("a"), item("b")];
  const first = await scrape(inputs, options);
  assert.ok(first.every((r) => r.ok && r.jobId));
  assert.deepEqual(
    api.calls.map((r) => r.method),
    ["POST", "POST", "GET", "GET"],
  );
  api.calls.length = 0;
  api.status.remaining_calls = 0;
  const resumed = await scrape([...inputs].reverse(), { ...options, useCache: true });
  assert.deepEqual(
    resumed.map((r) => r.data),
    [...first].reverse().map((r) => r.data),
  );
  assert.ok(
    api.calls.every((r) => r.method === "GET" && new URL(r.url).pathname.startsWith("/api/batch/jobs/")),
  );
  assert.equal(submissions.length, 2);
});

test("duplicates are distinct jobs and default mode creates fresh jobs", async (t) => {
  const api = mockApi();
  batchBackend(api);
  const options = { ...api.options, batched: true, cachePath: cachePath(t) };
  const inputs = [item("same"), item("same")];
  const first = await scrape(inputs, options);
  assert.notEqual(first[0].jobId, first[1].jobId);
  assert.deepEqual(
    (await scrape(inputs, { ...options, useCache: true })).map((r) => r.jobId),
    first.map((r) => r.jobId),
  );
  assert.ok((await scrape(inputs, options)).every((r) => !first.some((old) => old.jobId === r.jobId)));
});

test("all intents are committed before POST, and IDs/size/deadlines are sent", async (t) => {
  const api = mockApi();
  const { handler } = batchBackend(api);
  const path = cachePath(t);
  const seen = [];
  api.handle = async (request) => {
    if (request.method === "POST") {
      const db = new DatabaseSync(path);
      try {
        assert.equal(db.prepare("SELECT count(*) AS n FROM jobs").get().n, 20);
        assert.equal(db.prepare("SELECT count(DISTINCT batch_key) AS n FROM jobs").get().n, 1);
      } finally {
        db.close();
      }
      assert.equal(request.headers.get("x-litescrape-batch-size"), "20");
      seen.push(request.headers.get("x-litescrape-batch-id"));
      assert.equal((await request.clone().json()).timeout, "15");
      assert.ok(request.headers.get("x-litescrape-client").startsWith("typescript-sdk/"));
    }
    return handler(request);
  };
  const result = await scrape(
    Array.from({ length: 20 }, (_, i) => item(String(i))),
    {
      ...api.options,
      batched: true,
      concurrency: 2,
      cachePath: path,
      requestTimeout: 15,
    },
  );
  assert.ok(result.every((r) => r.ok));
  assert.equal(new Set(seen).size, 1);
});

test("lost acknowledgement recovers the original idempotency and batch IDs", async (t) => {
  const api = mockApi();
  const { jobs, submissions, handler } = batchBackend(api);
  const options = { ...api.options, batched: true, cachePath: cachePath(t), attempts: 1 };
  let lost = true;
  const batchIds = [];
  api.handle = async (request) => {
    const response = await handler(request);
    if (request.method === "POST") {
      batchIds.push(request.headers.get("x-litescrape-batch-id"));
      if (lost) {
        lost = false;
        throw new TypeError("response lost");
      }
    }
    return response;
  };
  assert.equal((await scrape([item("old")], options))[0].ok, false);
  const recovered = await scrape([item("old"), item("new")], { ...options, useCache: true });
  assert.ok(recovered.every((r) => r.ok));
  assert.equal(jobs.size, 2);
  assert.equal(submissions[0], submissions[1]);
  assert.equal(batchIds[0], batchIds[1]);
  assert.notEqual(batchIds[1], batchIds[2]);
});

test("a poll outage never permits a replacement reservation", async (t) => {
  const api = mockApi();
  const { handler, submissions } = batchBackend(api);
  const options = { ...api.options, batched: true, cachePath: cachePath(t), attempts: 2 };
  const [first] = await scrape([item("a")], options);
  api.handle = (request) =>
    request.method === "GET" ? envelope(503, "unavailable", true, { "retry-after": "0" }) : handler(request);
  const [failed] = await scrape([item("a")], { ...options, useCache: true });
  assert.equal(failed.ok, false);
  assert.equal(failed.jobId, first.jobId);
  assert.equal(submissions.length, 1);
  api.handle = handler;
  assert.equal((await scrape([item("a")], { ...options, useCache: true }))[0].ok, true);
});

for (const status of [404, 410, "expired"])
  test(`confirmed ${status} replaces a cached job`, async (t) => {
    const api = mockApi();
    const { handler, submissions } = batchBackend(api);
    const options = { ...api.options, batched: true, cachePath: cachePath(t) };
    const [first] = await scrape([item("a")], options);
    api.handle = (request) =>
      new URL(request.url).pathname.endsWith(first.jobId)
        ? status === "expired"
          ? json({ job_id: first.jobId, state: "expired" })
          : json({}, status)
        : handler(request);
    const [second] = await scrape([item("a")], { ...options, useCache: true });
    assert.equal(second.ok, true);
    assert.notEqual(second.jobId, first.jobId);
    assert.equal(submissions.length, 2);
  });

test("an expired lost acknowledgement is replaced only after confirmation", async (t) => {
  const api = mockApi();
  const { jobs, submissions, handler } = batchBackend(api);
  const options = { ...api.options, batched: true, cachePath: cachePath(t), attempts: 1 };
  api.handle = async (request) => {
    const response = await handler(request);
    if (request.method === "POST") throw new TypeError("lost acknowledgement");
    return response;
  };
  assert.equal((await scrape([item("a")], options))[0].ok, false);
  jobs.get(submissions[0]).state = "expired";
  api.handle = handler;
  assert.equal((await scrape([item("a")], { ...options, useCache: true }))[0].ok, true);
  assert.equal(submissions[0], submissions[1]);
  assert.notEqual(submissions[1], submissions[2]);
});

test("submission retries preserve idempotency and batch headers", async (t) => {
  const api = mockApi();
  const { handler } = batchBackend(api);
  let attempts = 0;
  api.handle = (request) =>
    request.method === "POST" && attempts++ < 2
      ? envelope(503, "service_unavailable", true, { "retry-after": "0" })
      : handler(request);
  const [result] = await scrape([item("x")], {
    ...api.options,
    batched: true,
    cachePath: cachePath(t),
    attempts: 3,
  });
  assert.ok(result.ok);
  const posts = api.calls.filter((r) => r.method === "POST");
  assert.equal(posts.length, 3);
  assert.equal(new Set(posts.map((r) => r.headers.get("idempotency-key"))).size, 1);
  assert.equal(new Set(posts.map((r) => r.headers.get("x-litescrape-batch-id"))).size, 1);
});

test("round-robin polling lets later jobs finish while the first is pending", async (t) => {
  const api = mockApi();
  const { handler } = batchBackend(api);
  const polls = [];
  api.handle = (request) => {
    if (request.method === "GET") {
      const id = new URL(request.url).pathname.split("/").at(-1);
      polls.push(id);
      if (id === "job-0" && polls.filter((x) => x === id).length < 2)
        return json({ job_id: id, state: "running" });
    }
    return handler(request);
  };
  const results = await scrape(
    Array.from({ length: 8 }, (_, i) => item(String(i))),
    {
      ...api.options,
      batched: true,
      cachePath: cachePath(t),
      concurrency: 2,
    },
  );
  assert.ok(results.every((r) => r.ok));
  assert.ok(polls.indexOf("job-7") < polls.lastIndexOf("job-0"));
});

test("cancellation leaves accepted jobs recoverable", async (t) => {
  const api = mockApi();
  const { handler, submissions } = batchBackend(api);
  const options = { ...api.options, batched: true, cachePath: cachePath(t) };
  const controller = new AbortController();
  api.handle = async (request) => {
    if (request.method === "GET") {
      setTimeout(() => controller.abort(), 10);
      await delay(10000, null, { signal: request.signal });
    }
    return handler(request);
  };
  await assert.rejects(scrape([item("a")], { ...options, signal: controller.signal }), {
    name: "AbortError",
  });
  api.handle = handler;
  assert.equal((await scrape([item("a")], { ...options, useCache: true }))[0].ok, true);
  assert.equal(submissions.length, 1);
});

test("cache fingerprints hide key/query text and scope parameters, origins and duplicates", (t) => {
  const items = [new GoogleSearch({ q: "secret query" }), new GoogleSearch({ q: "secret query" })];
  const keys = cacheKeys(items, "secret-key", "https://one.test");
  assert.notEqual(keys[0], keys[1]);
  assert.notDeepEqual(keys, cacheKeys(items, "other-key", "https://one.test"));
  assert.notDeepEqual(keys, cacheKeys(items, "secret-key", "https://two.test"));
  assert.notDeepEqual(keys, cacheKeys([new GoogleSearch({ q: "other" })], "secret-key", "https://one.test"));
  const path = cachePath(t);
  const cache = new JobCache(path);
  try {
    const [old] = cache.prepareMany(keys, false, "batch-a", 2);
    const [fresh] = cache.prepareMany(keys, false, "batch-b", 2);
    cache.save(keys[0], old.submission, "stale-job");
    const [read] = cache.prepareMany(keys, true, "batch-c", 2);
    assert.equal(read.submission, fresh.submission);
    assert.equal(read.job_id, null);
  } finally {
    cache.close();
  }
  assert.equal(readFileSync(path).includes(Buffer.from("secret-key")), false);
  assert.equal(readFileSync(path).includes(Buffer.from("secret query")), false);
});

test("legacy cache migration preserves existing submission and job IDs", (t) => {
  const path = cachePath(t);
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE jobs(cache_key TEXT PRIMARY KEY,submission TEXT NOT NULL,job_id TEXT,expires_at TEXT,updated_at REAL); INSERT INTO jobs VALUES ('key','old-intent','old-job',NULL,0)",
  );
  db.close();
  const cache = new JobCache(path);
  try {
    const [entry] = cache.prepareMany(["key"], true, "batch-a", 10);
    assert.deepEqual(
      { ...entry },
      { submission: "old-intent", job_id: "old-job", batch_key: "batch-a", batch_size: 10 },
    );
    assert.deepEqual(cache.prepareMany(["key"], true, "batch-b", 20)[0], entry);
  } finally {
    cache.close();
  }
});

test("batch failures and malformed job envelopes produce per-item errors", async (t) => {
  const variants = [
    { body: {} },
    { body: { job_id: "a", state: "unknown" } },
    { body: { job_id: "a", state: "succeeded", status_code: 200, response: [] } },
    { body: { job_id: "a", state: "failed", status_code: 200, response: {} } },
    {
      body: {
        job_id: "a",
        state: "failed",
        status_code: 402,
        response: { error_code: "payment_required", error: "empty" },
      },
      ErrorClass: PaymentRequiredError,
    },
  ];
  for (const { body, ErrorClass = TransportError } of variants) {
    const api = mockApi();
    api.handle = () => json(body, 202);
    const [result] = await scrape([item("x")], { ...api.options, batched: true, cachePath: cachePath(t) });
    assert.ok(result.error instanceof ErrorClass);
  }
});
