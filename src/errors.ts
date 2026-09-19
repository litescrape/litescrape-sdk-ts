/** Base class for every error raised by the SDK. */
export class LitescrapeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** All invalid input indices are reported before any HTTP request is sent. */
export class ValidationError extends LitescrapeError {
  constructor(public readonly problems: ReadonlyArray<readonly [number, string]>) {
    super(
      `${problems.length} invalid request item(s):\n${problems.map(([i, m]) => `  [${i}] ${m}`).join("\n")}`,
    );
  }
}

export class TransportError extends LitescrapeError {
  readonly retryable: boolean;
  constructor(message: string, options: { retryable: boolean; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.retryable = options.retryable;
  }
}

export interface APIErrorOptions {
  statusCode: number | null;
  errorCode: string;
  requestId?: string;
  retryable?: boolean;
  body?: Record<string, unknown>;
  retryAfter?: number | null;
}

export class APIError extends LitescrapeError {
  readonly statusCode: number | null;
  readonly errorCode: string;
  readonly requestId: string;
  readonly retryable: boolean;
  readonly body: Record<string, unknown>;
  /** Retry-After in seconds. */
  readonly retryAfter: number | null;

  constructor(message: string, options: APIErrorOptions) {
    super(message);
    this.statusCode = options.statusCode;
    this.errorCode = options.errorCode;
    this.requestId = options.requestId ?? "";
    this.retryable = options.retryable ?? false;
    this.body = options.body ?? {};
    this.retryAfter = options.retryAfter ?? null;
  }

  get status_code() {
    return this.statusCode;
  }
  get error_code() {
    return this.errorCode;
  }
  get request_id() {
    return this.requestId;
  }
  get retry_after() {
    return this.retryAfter;
  }

  override toString(): string {
    const details = [this.errorCode];
    if (this.statusCode !== null) details.push(`HTTP ${this.statusCode}`);
    if (this.requestId) details.push(`request ${this.requestId}`);
    return `${this.message} (${details.join(", ")})`;
  }
}

export class AuthenticationError extends APIError {}
export class PaymentRequiredError extends APIError {}
export class NotFoundError extends APIError {}
export class RateLimitError extends APIError {}
export class RequestDeadlineExceededError extends APIError {}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRetryAfter(value: string | null): number | null {
  if (!value?.trim()) return null;
  if (/^\d+$/.test(value.trim())) {
    const seconds = Number(value);
    return Number.isFinite(seconds) ? seconds : null;
  }
  const when = Date.parse(value);
  return Number.isFinite(when) ? Math.max(0, (when - Date.now()) / 1000) : null;
}

export function apiError(status: number, data: unknown, headers = new Headers()): APIError {
  const body =
    isObject(data) && "error_code" in data
      ? data
      : {
          error: isObject(data) && data.detail ? String(data.detail) : `HTTP ${status}`,
          error_code: status === 404 ? "not_found" : "request_failed",
          status_code: status,
          request_id: headers.get("x-request-id") ?? "",
          retryable: status === 429 || status >= 500,
        };
  const ErrorClass =
    status === 503 && body.error_code === "request_deadline_exceeded"
      ? RequestDeadlineExceededError
      : ({ 401: AuthenticationError, 402: PaymentRequiredError, 404: NotFoundError, 429: RateLimitError }[
          status
        ] ?? APIError);
  return new ErrorClass(String(body.error || `HTTP ${status}`), {
    statusCode: status,
    errorCode: String(body.error_code),
    requestId: String(body.request_id || headers.get("x-request-id") || ""),
    retryable: body.retryable === true,
    body,
    retryAfter: parseRetryAfter(headers.get("retry-after")),
  });
}
