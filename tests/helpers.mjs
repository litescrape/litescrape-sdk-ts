import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
export const envelope = (status, errorCode, retryable = false, headers = {}) =>
  json(
    {
      error: `${errorCode} happened`,
      error_code: errorCode,
      status_code: status,
      request_id: "abc123",
      retryable,
    },
    status,
    headers,
  );
export const item = (q) => ({ endpoint: "google_search", q });

export function mockApi() {
  const api = {
    calls: [],
    active: 0,
    peak: 0,
    status: { remaining_calls: 1000, concurrency_limit: 25, status: "active", has_billing_email: false },
    handle: (request) =>
      json({ search_parameters: Object.fromEntries(new URL(request.url).searchParams) }, 200, {
        "x-request-id": "req-ok",
      }),
    statusOverride: null,
  };
  api.fetch = async (input, init) => {
    const request = new Request(input, init);
    api.calls.push(request);
    if (new URL(request.url).pathname === "/api/keys/status")
      return api.statusOverride?.(request) ?? json(api.status, 200, { "x-request-id": "status-id" });
    api.active++;
    api.peak = Math.max(api.peak, api.active);
    try {
      return await api.handle(request);
    } finally {
      api.active--;
    }
  };
  api.options = { apiKey: "ls_live_test_key", baseUrl: "https://api.test", fetch: api.fetch };
  return api;
}

export function cachePath(t) {
  const dir = mkdtempSync(join(tmpdir(), "litescrape-sdk-test-"));
  // Remove only this test-owned directory, after all database handles are closed.
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "jobs.sqlite3");
}

export function batchBackend(api) {
  const jobs = new Map();
  const submissions = [];
  const handler = async (request) => {
    if (request.method === "POST") {
      const key = request.headers.get("idempotency-key");
      submissions.push(key);
      if (!jobs.has(key)) jobs.set(key, { job_id: `job-${jobs.size}`, state: "queued" });
      return json(jobs.get(key), 202);
    }
    const jobId = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1));
    return json({
      job_id: jobId,
      state: "succeeded",
      status_code: 200,
      response: { answer: jobId },
      expires_at: "2099-01-01T00:00:00Z",
    });
  };
  api.handle = handler;
  return { jobs, submissions, handler };
}
