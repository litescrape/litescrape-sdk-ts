import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AnyRequest } from "./models.js";

export interface CacheEntry {
  submission: string;
  job_id: string | null;
  batch_key: string;
  batch_size: number;
}
export const newId = (): string => randomUUID().replaceAll("-", "");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Fingerprints include the key, origin, all parameters, and duplicate occurrence. */
export function cacheKeys(items: readonly AnyRequest[], apiKey: string, baseUrl: string): string[] {
  const identity = hash(apiKey);
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    const params = item.queryParams();
    const sorted = Object.fromEntries(
      Object.keys(params)
        .sort()
        .map((key) => [key, params[key]]),
    );
    const canonical = JSON.stringify([identity, baseUrl, item.path, sorted]);
    const occurrence = occurrences.get(canonical) ?? 0;
    occurrences.set(canonical, occurrence + 1);
    return hash(`${canonical}:${occurrence}`);
  });
}

/** SQLite FULL commits persist the entire workload before its first POST. */
export class JobCache {
  readonly path: string;
  private readonly db: DatabaseSync;

  constructor(path?: string) {
    this.path = resolve(
      path || process.env.LITESCRAPE_JOB_CACHE || join(homedir(), ".cache", "litescrape", "jobs-ts.sqlite3"),
    );
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(this.path);
    try {
      if (process.platform !== "win32") chmodSync(this.path, 0o600);
      this.db.exec(`PRAGMA busy_timeout=30000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS jobs (
          cache_key TEXT PRIMARY KEY, submission TEXT NOT NULL, job_id TEXT,
          expires_at TEXT, updated_at REAL NOT NULL
        );`);
      this.transaction(() => {
        const columns = this.db
          .prepare("PRAGMA table_info(jobs)")
          .all()
          .map((row) => row.name);
        if (!columns.includes("batch_key")) this.db.exec("ALTER TABLE jobs ADD COLUMN batch_key TEXT");
        if (!columns.includes("batch_size")) this.db.exec("ALTER TABLE jobs ADD COLUMN batch_size INTEGER");
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  prepareMany(keys: readonly string[], useCache: boolean, batchKey: string, batchSize: number): CacheEntry[] {
    return this.transaction(() =>
      keys.map((key) => {
        const row = this.db
          .prepare("SELECT submission,job_id,batch_key,batch_size FROM jobs WHERE cache_key=?")
          .get(key);
        if (useCache && row) {
          if (!row.batch_key) {
            row.batch_key = batchKey;
            row.batch_size = batchSize;
            this.db
              .prepare("UPDATE jobs SET batch_key=?,batch_size=? WHERE cache_key=?")
              .run(batchKey, batchSize, key);
          }
          return row as unknown as CacheEntry;
        }
        const entry: CacheEntry = {
          submission: newId(),
          job_id: null,
          batch_key: batchKey,
          batch_size: batchSize,
        };
        this.db
          .prepare(
            `INSERT INTO jobs(cache_key,submission,updated_at,batch_key,batch_size) VALUES (?,?,?,?,?)
        ON CONFLICT(cache_key) DO UPDATE SET submission=excluded.submission,job_id=NULL,expires_at=NULL,
          updated_at=excluded.updated_at,batch_key=excluded.batch_key,batch_size=excluded.batch_size`,
          )
          .run(key, entry.submission, Date.now() / 1000, batchKey, batchSize);
        return entry;
      }),
    );
  }

  save(key: string, submission: string, jobId: string, expiresAt?: unknown): void {
    // A concurrent fresh run can replace a slot; its submission must not be overwritten.
    this.db
      .prepare("UPDATE jobs SET job_id=?,expires_at=?,updated_at=? WHERE cache_key=? AND submission=?")
      .run(jobId, typeof expiresAt === "string" ? expiresAt : null, Date.now() / 1000, key, submission);
  }

  close(): void {
    this.db.close();
  }
}
