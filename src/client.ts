import {
  APIError,
  AuthenticationError,
  PaymentRequiredError,
  TransportError,
  ValidationError,
} from "./errors.js";
import {
  keyStatusSchema,
  parseRequest,
  type AnyRequest,
  type KeyStatus,
  type RequestItem,
} from "./models.js";
import { Result } from "./result.js";
import {
  DEFAULT_BASE_URL,
  Semaphore,
  each,
  keySemaphore,
  requestWithRetries,
  type Fetch,
  type RuntimeOptions,
} from "./runtime.js";
import { timeoutSeconds } from "./validation.js";

export interface ClientOptions {
  /** Defaults to LITESCRAPE_API_KEY. */
  apiKey?: string;
  /** Defaults to LITESCRAPE_API_URL or https://api.litescrape.com. */
  baseUrl?: string;
  /** Total transport attempts, including the first. Default: 5. */
  attempts?: number;
  /** HTTP transport timeout in seconds per attempt. Default: 120. */
  timeout?: number;
  /** Cancels local work; accepted durable jobs keep running on the server. */
  signal?: AbortSignal;
  /** Optional fetch implementation for custom transports and testing. */
  fetch?: Fetch;
}

export interface ScrapeOptions extends ClientOptions {
  /** Lowers the key's synchronous concurrency cap; batch requests default to 32. */
  concurrency?: number;
  /** Server deadline in seconds, >0 and <=90. An item's timeout overrides this. */
  requestTimeout?: number;
  batched?: boolean;
  /** Resume saved durable jobs; requires batched: true. Default: false. */
  useCache?: boolean;
  /** Defaults to LITESCRAPE_JOB_CACHE or ~/.cache/litescrape/jobs-ts.sqlite3. */
  cachePath?: string;
  /** Called once per result in completion order. Returned results stay in input order. */
  onProgress?: (completed: number, total: number, result: Result) => void;
}

function checkArgs(options: ScrapeOptions): void {
  for (const [name, value] of [
    ["attempts", options.attempts ?? 5],
    ["concurrency", options.concurrency ?? 1],
  ] as const)
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  const timeout = options.timeout ?? 120;
  if (
    typeof timeout !== "number" ||
    !Number.isFinite(timeout) ||
    timeout <= 0 ||
    timeout * 1000 > 2 ** 31 - 1
  )
    throw new RangeError("timeout must be a finite positive number of seconds within the timer range");
  if (options.requestTimeout !== undefined && !timeoutSeconds.safeParse(options.requestTimeout).success)
    throw new RangeError("requestTimeout must be a finite number greater than 0 and at most 90");
  if (options.useCache && !options.batched) throw new RangeError("useCache requires batched: true");
}

function runtimeOptions(options: ClientOptions): RuntimeOptions {
  const apiKey = (options.apiKey || process.env.LITESCRAPE_API_KEY || "").trim();
  if (!apiKey)
    throw new AuthenticationError("Pass apiKey or set the LITESCRAPE_API_KEY environment variable.", {
      statusCode: null,
      errorCode: "missing_api_key",
    });
  const url = new URL(options.baseUrl || process.env.LITESCRAPE_API_URL || DEFAULT_BASE_URL);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new TypeError("baseUrl must be an HTTP(S) URL without credentials, a query, or a fragment");
  return {
    apiKey,
    baseUrl: url.toString().replace(/\/+$/, ""),
    attempts: options.attempts ?? 5,
    timeout: options.timeout ?? 120,
    fetch: options.fetch ?? globalThis.fetch,
    signal: options.signal,
  };
}

async function fetchStatus(options: RuntimeOptions): Promise<KeyStatus> {
  const outcome = await requestWithRetries("/api/keys/status", options);
  if (outcome.error) throw outcome.error;
  const status = keyStatusSchema.safeParse({ ...outcome.data, request_id: outcome.requestId });
  if (!status.success)
    throw new TransportError(`Unexpected key status body: ${status.error.message}`, {
      retryable: false,
      cause: status.error,
    });
  return status.data;
}

/** Read the key's balance and limits. This endpoint is not billed. */
export async function keyStatus(options: ClientOptions = {}): Promise<KeyStatus> {
  checkArgs(options);
  options.signal?.throwIfAborted();
  return fetchStatus(runtimeOptions(options));
}

/** Validate all inputs first, then return one Result per input, in input order. */
export async function scrape(
  requests: readonly RequestItem[],
  options: ScrapeOptions = {},
): Promise<Result[]> {
  checkArgs(options);
  options.signal?.throwIfAborted();
  if (!Array.isArray(requests)) throw new TypeError("requests must be an array");
  const problems: Array<[number, string]> = [];
  const items: AnyRequest[] = [];
  for (const [index, input] of requests.entries()) {
    try {
      let item = parseRequest(input);
      if (item.timeout == null && options.requestTimeout !== undefined)
        item = item.withTimeout(options.requestTimeout);
      items.push(item);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      problems.push([index, error.problems.map(([, message]) => message).join("; ")]);
    }
  }
  if (problems.length) throw new ValidationError(problems);
  if (!items.length) return [];

  const context = runtimeOptions(options);
  let completed = 0;
  const onResult = (result: Result) => options.onProgress?.(++completed, items.length, result);
  if (options.batched) {
    const { runBatch } = await import("./batch.js");
    return runBatch(items, {
      ...context,
      concurrency: options.concurrency,
      useCache: options.useCache ?? false,
      cachePath: options.cachePath,
      onResult,
    });
  }

  const status = await fetchStatus(context);
  if (status.remaining_calls < items.length)
    throw new PaymentRequiredError(
      `This batch needs ${items.length} calls but the key has ${status.remaining_calls} remaining.`,
      { statusCode: 402, errorCode: "payment_required", requestId: status.request_id },
    );
  const keyLimit = Math.max(1, status.concurrency_limit || 25);
  const limit = Math.min(keyLimit, options.concurrency ?? keyLimit);
  const shared = keySemaphore(context.apiKey, context.baseUrl, keyLimit);
  const semaphores = [new Semaphore(limit), shared.semaphore];
  let fatal: APIError | null = null;
  const results: Result[] = new Array(items.length);
  const started = performance.now();
  try {
    await each(
      items.map((_, i) => i),
      limit,
      async (index) => {
        const request = items[index]!;
        const outcome = await requestWithRetries(request.path, {
          ...context,
          params: request.queryParams(),
          semaphores,
          gate: () => fatal,
          onOutcome: (outcome) => {
            const error = outcome.error;
            if (
              error instanceof APIError &&
              ([401, 402].includes(error.statusCode ?? 0) || error.errorCode === "api_key_disabled")
            )
              fatal = error;
          },
        });
        const result = new Result(index, request, outcome, (performance.now() - started) / 1000);
        results[index] = result;
        onResult(result);
      },
    );
    return results;
  } finally {
    shared.release();
  }
}

// JavaScript is asynchronous throughout; these aliases ease migration from Python.
export const ascrape = scrape;
export const key_status = keyStatus;
export const akey_status = keyStatus;
