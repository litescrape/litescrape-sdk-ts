import { APIError, TransportError, apiError, isObject } from "./errors.js";
import { JobCache, cacheKeys, newId, type CacheEntry } from "./cache.js";
import type { AnyRequest } from "./models.js";
import { Result } from "./result.js";
import {
  Semaphore,
  backoff,
  each,
  requestWithRetries,
  sleep,
  type Outcome,
  type RuntimeOptions,
} from "./runtime.js";

interface BatchOptions extends RuntimeOptions {
  concurrency?: number;
  useCache: boolean;
  cachePath?: string;
  onResult: (result: Result) => void;
}
type Submission = { entry: CacheEntry; outcome: Outcome };

export async function runBatch(items: readonly AnyRequest[], options: BatchOptions): Promise<Result[]> {
  options.signal?.throwIfAborted();
  const cache = new JobCache(options.cachePath);
  const keys = cacheKeys(items, options.apiKey, options.baseUrl);
  const limit = options.concurrency ?? 32;
  const semaphores = [new Semaphore(limit)];
  const started = performance.now();
  const batchKey = newId();
  const indices = items.map((_, i) => i);
  const results: Result[] = new Array(items.length);

  try {
    const entries = cache.prepareMany(keys, options.useCache, batchKey, items.length);
    const pollOnce = (jobId: string) =>
      requestWithRetries(`/api/batch/jobs/${encodeURIComponent(jobId)}`, { ...options, semaphores });
    const replace = (index: number) => cache.prepareMany([keys[index]!], false, batchKey, items.length)[0]!;

    const submit = async (index: number, replaceExpired = false): Promise<Submission> => {
      let entry = replaceExpired ? replace(index) : entries[index]!;
      if (entry.job_id) {
        const outcome = await pollOnce(entry.job_id);
        // Only positive evidence of expiry/missing jobs permits a fresh reservation.
        if (
          (!outcome.error && outcome.data?.state !== "expired") ||
          (outcome.error && ![404, 410].includes(outcome.statusCode ?? 0))
        )
          return { entry, outcome };
        entry = replace(index);
      }
      const outcome = await requestWithRetries(items[index]!.path + "/async", {
        ...options,
        semaphores,
        method: "POST",
        body: items[index]!.queryParams(),
        acceptedStatuses: [200, 202],
        headers: {
          "Idempotency-Key": entry.submission,
          "X-Litescrape-Batch-ID": entry.batch_key,
          "X-Litescrape-Batch-Size": String(entry.batch_size),
        },
      });
      if (!outcome.error) {
        const job = outcome.data!;
        if (typeof job.job_id !== "string" || !job.job_id)
          outcome.error = new TransportError("Batch submission returned no job ID.", { retryable: true });
        else {
          entry.job_id = job.job_id;
          cache.save(keys[index]!, entry.submission, job.job_id, job.expires_at);
          if (job.state === "expired" && options.useCache && !replaceExpired) return submit(index, true);
        }
      }
      return { entry, outcome };
    };

    const submissions: Submission[] = new Array(items.length);
    await each(indices, limit, async (index) => {
      submissions[index] = await submit(index);
    });

    const resolve = (index: number, { entry, outcome }: Submission): Result | null => {
      if (!outcome.error) {
        const job = outcome.data!;
        if (typeof job.job_id !== "string" || !job.job_id || job.job_id !== entry.job_id) {
          outcome.error = new TransportError("Batch job returned an invalid job ID.", { retryable: false });
        } else if (job.state === "succeeded" || job.state === "failed") {
          const status = job.status_code;
          const payload = job.response;
          if (
            typeof status !== "number" ||
            !Number.isInteger(status) ||
            status < 100 ||
            status > 599 ||
            !isObject(payload) ||
            (job.state === "succeeded") !== (status === 200)
          ) {
            outcome.error = new TransportError("Batch job returned an invalid response.", {
              retryable: false,
            });
          } else {
            cache.save(keys[index]!, entry.submission, job.job_id, job.expires_at);
            return new Result(
              index,
              items[index]!,
              {
                data: status === 200 ? payload : null,
                error: status === 200 ? null : apiError(status, payload),
                statusCode: status,
                requestId: job.job_id,
                attempts: outcome.attempts,
              },
              (performance.now() - started) / 1000,
              job.job_id,
            );
          }
        } else if (job.state === "expired") {
          outcome.error = new APIError("The retained batch response expired.", {
            statusCode: 410,
            errorCode: "job_expired",
            requestId: entry.job_id ?? "",
          });
          outcome.statusCode = 410;
        } else if (job.state === "queued" || job.state === "running") return null;
        else outcome.error = new TransportError("Batch job returned an unknown state.", { retryable: false });
      }
      return new Result(
        index,
        items[index]!,
        { ...outcome, data: null, requestId: entry.job_id ?? outcome.requestId },
        (performance.now() - started) / 1000,
        entry.job_id ?? "",
      );
    };

    let pending = indices;
    let polls = 0;
    while (pending.length) {
      await each(pending, limit, async (index) => {
        let result = resolve(index, submissions[index]!);
        if (!result) {
          const entry = submissions[index]!.entry;
          submissions[index] = { entry, outcome: await pollOnce(entry.job_id!) };
          result = resolve(index, submissions[index]!);
        }
        if (result) {
          results[index] = result;
          options.onResult(result);
        }
      });
      pending = pending.filter((index) => !results[index]);
      if (pending.length) await sleep(backoff(++polls), options.signal);
    }
    return results;
  } finally {
    cache.close();
  }
}
