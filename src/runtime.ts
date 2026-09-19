import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { APIError, LitescrapeError, TransportError, apiError, isObject } from "./errors.js";
import { VERSION } from "./version.js";

export const DEFAULT_BASE_URL = "https://api.litescrape.com";
export const USER_AGENT = `litescrape-sdk/${VERSION} (Node/${process.versions.node}; ${process.platform}; TypeScript)`;
export const CLIENT_HEADER_VALUE = `typescript-sdk/${VERSION}`;
export type Fetch = typeof globalThis.fetch;

export interface Outcome {
  data: Record<string, unknown> | null;
  error: LitescrapeError | null;
  statusCode: number | null;
  requestId: string;
  attempts: number;
}
export const emptyOutcome = (): Outcome => ({
  data: null,
  error: null,
  statusCode: null,
  requestId: "",
  attempts: 0,
});

/** FIFO gate. Waiting and backoff do not hold a network slot. */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<{ start: () => void; cancel: () => void }> = [];
  constructor(public limit: number) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const waiter = {
        start: () => {
          signal?.removeEventListener("abort", waiter.cancel);
          this.active++;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            this.active--;
            this.drain();
          });
        },
        cancel: () => {
          const index = this.queue.indexOf(waiter);
          if (index !== -1) this.queue.splice(index, 1);
          reject(signal?.reason);
        },
      };
      if (this.active < this.limit) waiter.start();
      else {
        this.queue.push(waiter);
        signal?.addEventListener("abort", waiter.cancel, { once: true });
      }
    });
  }

  resize(limit: number): void {
    this.limit = limit;
    this.drain();
  }
  private drain(): void {
    while (this.active < this.limit && this.queue.length) this.queue.shift()!.start();
  }
}

// One key-wide cap shared by overlapping scrape calls. Per-call limits are separate,
// so two callers with different overrides cannot accidentally multiply the key limit.
const sharedLimits = new Map<string, { semaphore: Semaphore; users: number }>();
export function keySemaphore(
  key: string,
  baseUrl: string,
  limit: number,
): { semaphore: Semaphore; release: () => void } {
  const identity = createHash("sha256")
    .update(JSON.stringify([key, baseUrl]))
    .digest("hex");
  let entry = sharedLimits.get(identity);
  if (!entry) {
    entry = { semaphore: new Semaphore(limit), users: 0 };
    sharedLimits.set(identity, entry);
  } else entry.semaphore.resize(limit);
  entry.users++;
  const held = entry;
  return {
    semaphore: held.semaphore,
    release: () => {
      held.users--;
      if (held.users === 0) sharedLimits.delete(identity);
    },
  };
}

export function shouldRetry(error: LitescrapeError): boolean {
  if (error instanceof TransportError) return error.retryable;
  return (
    error instanceof APIError &&
    (error.retryable ||
      error.statusCode === 429 ||
      (error.statusCode ?? 0) >= 500 ||
      ["proxy_capacity_unavailable", "upstream_session_unavailable", "service_unavailable"].includes(
        error.errorCode,
      ))
  );
}

export function backoff(attempt: number, retryAfter: number | null = null): number {
  if (retryAfter !== null) return Math.min(Math.max(retryAfter, 0), 30);
  const ceiling = Math.min(30, 2 ** Math.min(Math.max(attempt - 1, 0), 6));
  return ceiling * (0.5 + Math.random() / 2);
}

export async function sleep(seconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  try {
    await delay(seconds * 1000, undefined, { signal });
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
}

export interface RuntimeOptions {
  baseUrl: string;
  apiKey: string;
  attempts: number;
  timeout: number;
  fetch: Fetch;
  signal?: AbortSignal;
}
interface RequestOptions extends RuntimeOptions {
  params?: Record<string, string>;
  method?: "GET" | "POST";
  body?: Record<string, string>;
  headers?: Record<string, string>;
  acceptedStatuses?: number[];
  semaphores?: Semaphore[];
  gate?: () => APIError | null;
  onOutcome?: (outcome: Outcome) => void;
}

export async function requestWithRetries(path: string, options: RequestOptions): Promise<Outcome> {
  const { signal } = options;
  const outcome = emptyOutcome();
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    signal?.throwIfAborted();
    const release: Array<() => void> = [];
    try {
      for (const semaphore of options.semaphores ?? []) release.push(await semaphore.acquire(signal));
      signal?.throwIfAborted();
      const blocked = options.gate?.();
      if (blocked) {
        outcome.error = blocked;
        outcome.statusCode = blocked.statusCode;
        outcome.requestId = blocked.requestId;
        return outcome;
      }
      Object.assign(outcome, emptyOutcome(), { attempts: attempt });
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new DOMException("HTTP transport timed out", "TimeoutError")),
        options.timeout * 1000,
      );
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      try {
        const url = new URL(options.baseUrl + path);
        for (const [key, value] of Object.entries(options.params ?? {})) url.searchParams.set(key, value);
        const response = await options.fetch(url, {
          method: options.method ?? "GET",
          redirect: "manual",
          signal: combined,
          headers: {
            Accept: "application/json",
            "User-Agent": USER_AGENT,
            "X-Litescrape-Client": CLIENT_HEADER_VALUE,
            Authorization: `Bearer ${options.apiKey}`,
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers,
          },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        });
        outcome.statusCode = response.status;
        outcome.requestId = response.headers.get("x-request-id") ?? "";
        let data: unknown;
        let bodyError: unknown;
        try {
          data = await response.json();
        } catch (error) {
          bodyError = error;
        }
        signal?.throwIfAborted();
        if (!(options.acceptedStatuses ?? [200]).includes(response.status)) {
          outcome.error = apiError(response.status, data, response.headers);
          outcome.requestId = outcome.error instanceof APIError ? outcome.error.requestId : outcome.requestId;
        } else if (bodyError) {
          outcome.error = new TransportError("Response body was not JSON", {
            retryable: true,
            cause: bodyError,
          });
        } else if (!isObject(data)) {
          outcome.error = new TransportError("Response body was not a JSON object", { retryable: true });
        } else outcome.data = data;
      } catch (cause) {
        signal?.throwIfAborted();
        const retryable =
          controller.signal.aborted ||
          cause instanceof TypeError ||
          (cause instanceof DOMException && ["AbortError", "TimeoutError"].includes(cause.name));
        outcome.error = new TransportError(cause instanceof Error ? cause.message : String(cause), {
          retryable,
          cause,
        });
      } finally {
        clearTimeout(timeout);
      }
      // Set the fatal gate while the slot is held, before queued requests can start.
      options.onOutcome?.(outcome);
    } finally {
      for (const unlock of release.reverse()) unlock();
    }
    if (!outcome.error || attempt === options.attempts || !shouldRetry(outcome.error)) return outcome;
    await sleep(
      backoff(attempt, outcome.error instanceof APIError ? outcome.error.retryAfter : null),
      signal,
    );
  }
  return outcome;
}

/** A bounded worker pool; errors stop new work and settle all workers before returning. */
export async function each<T>(
  items: readonly T[],
  limit: number,
  operation: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const item = items[next++]!;
      try {
        await operation(item);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const settled = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, worker));
  const failure = settled.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}
