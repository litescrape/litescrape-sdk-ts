import type { LitescrapeError } from "./errors.js";
import type { AnyRequest } from "./models.js";
import type { Outcome } from "./runtime.js";

/** One outcome per input, including failed items. Elapsed time is in seconds. */
export class Result {
  readonly data: Record<string, unknown> | null;
  readonly error: LitescrapeError | null;
  readonly statusCode: number | null;
  readonly requestId: string;
  readonly attempts: number;

  constructor(
    public readonly index: number,
    public readonly request: AnyRequest,
    outcome: Outcome,
    public readonly elapsed: number,
    public readonly jobId = "",
  ) {
    this.data = outcome.data;
    this.error = outcome.error;
    this.statusCode = outcome.statusCode;
    this.requestId = outcome.requestId;
    this.attempts = outcome.attempts;
    Object.freeze(this);
  }

  get ok(): boolean {
    return this.error === null;
  }
  get status_code() {
    return this.statusCode;
  }
  get request_id() {
    return this.requestId;
  }
  get job_id() {
    return this.jobId;
  }

  raiseForError(): Record<string, unknown> {
    if (this.error) throw this.error;
    return this.data ?? {};
  }

  raise_for_error(): Record<string, unknown> {
    return this.raiseForError();
  }
}
