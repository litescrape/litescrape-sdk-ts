# litescrape-sdk

TypeScript and JavaScript SDK for the [Litescrape API](https://litescrape.com): validated,
concurrent, retrying calls to all 34 search, maps, reviews, Google Play, and Apple App Store
endpoints, with results returned in input order.

Follows the contracts and behavior of the [Python SDK](https://github.com/litescrape/litescrape-sdk)
v0.5.2. Supports Node.js 22.13+ with ESM, CommonJS, and TypeScript declarations. This is a
server-side SDK: keep your API key on the server.

Install the [`litescrape-sdk`](https://www.npmjs.com/package/litescrape-sdk) package from npm:

```sh
npm install litescrape-sdk
```

```typescript
import { GoogleMaps, scrape } from "litescrape-sdk";

// Set LITESCRAPE_API_KEY in your environment, or pass { apiKey: "ls_live_..." }.
const results = await scrape([
  { endpoint: "google_search", q: "coffee grinders", gl: "us" },
  new GoogleMaps({ q: "coffee", type: "search", ll: "@40.745,-73.988,14z" }),
]);

for (const result of results) {
  console.log(result.ok, result.data ?? result.error);
}
```

CommonJS: `const { GoogleMaps, scrape } = require("litescrape-sdk");`.
All network calls return promises. `ascrape` is an alias of `scrape`.

## Requests and results

Pass plain objects with an `endpoint` discriminator or construct typed request objects such as
`new GoogleSearch({ q: "coffee" })`. Constructors and `scrape` validate at runtime; unknown
parameters, invalid values, missing required fields, and incompatible parameter combinations
are rejected. Every input is validated before the first HTTP call. A `ValidationError` contains
`problems`, an array of `[inputIndex, message]` pairs. `parseRequest(unknown)` validates external input.

`REQUEST_TYPES` maps every endpoint slug to its request constructor. Constructors expose `path`
and `parameters`; instances expose immutable normalized fields, `path`, and `queryParams()`.
Use strings or `bigint` for numeric IDs larger than JavaScript's safe integer range. Store IDs
are strictly strings, matching the Python Store contracts.

Each `Result` has `index`, `request`, `ok`, `data`, `error`, `statusCode`, `requestId`, `attempts`,
`elapsed` (seconds), and `jobId` (empty outside batch mode). `raiseForError()` throws the error or
returns the data. Response data is a `Record<string, unknown>`; provider response fields are not
validated or discarded.

The Python names `query_params()`, `raise_for_error()`, `status_code`, `request_id`, `job_id`,
`error_code`, and `retry_after` are also available. SDK options use camelCase; provider parameters
retain their API spelling, such as `place_id`, `fast_mode`, and `safeSearch`.

```typescript
import { keyStatus } from "litescrape-sdk";

const status = await keyStatus(); // Unbilled GET /api/keys/status
console.log(status.remaining_calls, status.concurrency_limit);
```

`key_status` and `akey_status` are aliases of `keyStatus` and take the same options object.

## Options

```typescript
await scrape(requests, {
  apiKey: process.env.LITESCRAPE_API_KEY,
  baseUrl: "https://api.litescrape.com",
  attempts: 5,
  concurrency: 10,
  timeout: 120,
  requestTimeout: 15,
  signal: AbortSignal.timeout(60_000),
  onProgress: (completed, total, result) => console.log(completed, total, result.ok),
});
```

| Option           | Default                                              | Meaning                                                                                                                        |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `apiKey`         | `LITESCRAPE_API_KEY`                                 | Bearer key.                                                                                                                    |
| `baseUrl`        | `LITESCRAPE_API_URL` or `https://api.litescrape.com` | API URL.                                                                                                                       |
| `attempts`       | `5`                                                  | Total attempts per HTTP operation; `1` disables retries.                                                                       |
| `concurrency`    | Key limit, or `25`; batch mode `32`                  | Synchronous calls can lower, never raise, the key limit. Batch submission/poll concurrency is independent of server execution. |
| `timeout`        | `120`                                                | HTTP transport timeout in seconds for each attempt, including reading its body.                                                |
| `requestTimeout` | Omitted                                              | Default server deadline in seconds: greater than zero, at most 90.                                                             |
| `batched`        | `false`                                              | Submit durable server jobs, then poll.                                                                                         |
| `useCache`       | `false`                                              | Recover saved durable jobs; requires `batched: true`.                                                                          |
| `cachePath`      | See below                                            | SQLite job cache.                                                                                                              |
| `signal`         | Omitted                                              | Abort local requests, queued work, retries, and polling.                                                                       |
| `onProgress`     | Omitted                                              | Called once per result in completion order. Returned results remain in input order.                                            |
| `fetch`          | Native `fetch`                                       | Custom fetch-compatible transport, including for tests.                                                                        |

There is no automatic terminal progress bar. `keyStatus` accepts `apiKey`, `baseUrl`, `attempts`,
`timeout`, `signal`, and `fetch`.

Before synchronous scrapes, the SDK checks the key's balance and concurrency limit. Too few
remaining calls raises `PaymentRequiredError` before scraping. Overlapping `scrape` calls in the
same Node.js runtime share the key limit. Worker threads and separate processes have independent
limits. The server remains the final authority on concurrency.

Retries cover connection failures, transport timeouts, unusable success bodies, HTTP 429/5xx,
retryable envelopes, and the Python SDK's transient-capacity error codes. Other 400/401/402/403/404/422
responses are not retried unless the API explicitly marks them retryable. Backoff grows exponentially
with jitter and honors `Retry-After`, capped at 30 seconds. A 401, 402, or `api_key_disabled` error stops
unsent synchronous work. Each affected item still gets a `Result`.

Per-item failures appear as `Result.error`. Setup/status failures reject the entire call. Exported
errors are `LitescrapeError`, `ValidationError`, `TransportError`, `APIError`, `AuthenticationError`,
`PaymentRequiredError`, `NotFoundError`, `RateLimitError`, and `RequestDeadlineExceededError`.
API errors preserve `statusCode`, `errorCode`, `requestId`, `retryable`, `retryAfter`, and `body`.
Cancellation rejects with the abort signal's reason. A thrown `onProgress` callback rejects the call;
avoid throwing from progress callbacks.

Only successful API attempts are billed. A synchronous response lost in transit may already have
been billed, and retrying can incur another charge. Use durable batches for idempotent submission.

## Durable batches and recovery

Requires an API deployment with durable batch support. The SDK saves the entire workload's
submission intentions and batch IDs in a SQLite transaction before sending the first input, saves
acknowledged job IDs, submits all inputs, and then polls. Accepted jobs keep running if your process
exits or your connection drops. Results are retained for 24 hours after completion.

```typescript
import { GoogleSearch, scrape } from "litescrape-sdk";

const queries = [new GoogleSearch({ q: "coffee grinders" }), new GoogleSearch({ q: "espresso machines" })];
const options = { batched: true, cachePath: "./my-batch.sqlite3" };
const results = await scrape(queries, options);

// After a crash or disconnect, rerun with the same inputs, key, and cache path:
const recovered = await scrape(queries, { ...options, useCache: true });
for (const result of recovered) console.log(result.jobId, result.data ?? result.error);
```

`useCache: false` creates fresh jobs. `useCache: true` matches by API key, API URL, endpoint, normalized
parameters, and the occurrence number of duplicate inputs. Distinct inputs can be reordered.
Submission retries and recovery after a lost acknowledgement reuse their idempotency key and batch
ID. Replacements are created only after the server confirms a job is missing or expired; a polling
outage does not authorize another charge. Keep separate cache files for independently resumable batches.

The default cache is `~/.cache/litescrape/jobs-ts.sqlite3`, overridden by `LITESCRAPE_JOB_CACHE` or
`cachePath`. It stores request fingerprints and job/submission IDs, without raw API keys, query text,
or responses. The TypeScript and Python cache files are separate and are not interchangeable.
Batch storage uses Node's built-in [SQLite module](https://nodejs.org/api/sqlite.html), which may emit
an experimental-feature warning on Node 22/24. No native npm add-on is needed.

New jobs reserve one credit; terminal failures refund that reservation. Polling and retrying the same
submission do not consume more credits. Batch mode skips the synchronous balance check, so previously
paid jobs can be recovered with zero credits. Check each result for submission errors, including
insufficient credits. `attempts` controls submission/poll transport retries; provider retries and
execution capacity are managed by the server. `Result.attempts` reports the final HTTP operation's
attempt count, matching Python; it is not a sum of polls or server worker attempts.

## Google Search fast mode and request deadlines

`new GoogleSearch({ q: "coffee", fast_mode: true })` requests organic results plus metadata and
parameters. It skips AI Overview and other response groups. The default returns the full response;
fast mode is unavailable on `GoogleAiOverview`.

```typescript
import { GoogleSearch, RequestDeadlineExceededError, scrape } from "litescrape-sdk";

const [result] = await scrape([new GoogleSearch({ q: "coffee grinders", timeout: 10 })], {
  requestTimeout: 15,
  attempts: 1,
});
if (result.error instanceof RequestDeadlineExceededError) {
  console.log(result.error.requestId, result.error.retryable, result.error.message);
} else {
  console.log(result.raiseForError());
}
```

An item's `timeout` overrides `requestTimeout`; both accept fractional seconds greater than zero
and at most 90. The server deadline covers each synchronous attempt from gateway receipt through
admission, scraping, and billing. Expiry returns HTTP 503 `request_deadline_exceeded`, is retryable,
and that attempt is not charged. In batch mode it limits each worker attempt after queueing.

SDK queueing, the status check, transport, backoff, and the full workload are outside that server
deadline. The SDK option `timeout` remains the HTTP transport timeout; keep it longer than the server
deadline. A `TransportError` alone does not establish whether an attempt was billed.

## Endpoints

| Request class               | Endpoint slug                   |
| --------------------------- | ------------------------------- |
| `GoogleSearch`              | `google_search`                 |
| `GoogleAiOverview`          | `google_ai_overview`            |
| `GoogleAiMode`              | `google_ai_mode`                |
| `GoogleAds`                 | `google_ads`                    |
| `GoogleShopping`            | `google_shopping`               |
| `GoogleShoppingProduct`     | `google_shopping_product`       |
| `GoogleLocal`               | `google_local`                  |
| `GoogleMaps`                | `google_maps`                   |
| `GoogleMapsLiveFootTraffic` | `google_maps_live_foot_traffic` |
| `GoogleMapsPosts`           | `google_maps_posts`             |
| `GoogleMapsPhoto`           | `google_maps_photo`             |
| `GoogleMapsWebResults`      | `google_maps_web_results`       |
| `GoogleReviews`             | `google_reviews`                |
| `GoogleContributorReviews`  | `google_contributor_reviews`    |
| `BingSearch`                | `bing_search`                   |
| `BingMaps`                  | `bing_maps`                     |
| `DuckDuckGoSearch`          | `duckduckgo_search`             |
| `DuckDuckGoMaps`            | `duckduckgo_maps`               |
| `YelpSearch`                | `yelp_search`                   |
| `YelpReviews`               | `yelp_reviews`                  |
| `TripadvisorSearch`         | `tripadvisor_search`            |
| `TripadvisorPlace`          | `tripadvisor_place`             |
| `TripadvisorReviews`        | `tripadvisor_reviews`           |
| `AppleMapsPlaces`           | `apple_maps_places`             |
| `AppleMapsReviews`          | `apple_maps_reviews`            |
| `GooglePlayApps`            | `google_play_apps`              |
| `GooglePlayGames`           | `google_play_games`             |
| `GooglePlayBooks`           | `google_play_books`             |
| `GooglePlayMovies`          | `google_play_movies`            |
| `GooglePlayProduct`         | `google_play_product`           |
| `GooglePlayReviews`         | `google_play_reviews`           |
| `AppleAppStoreSearch`       | `apple_app_store_search`        |
| `AppleAppStoreProduct`      | `apple_app_store_product`       |
| `AppleAppStoreReviews`      | `apple_app_store_reviews`       |

## Store APIs (Alpha)

All nine Store operations use your existing key. Fields depend on the storefront's response.

```typescript
import { GooglePlayApps, GooglePlayProduct, AppleAppStoreSearch, scrape } from "litescrape-sdk";

const results = await scrape([
  new GooglePlayApps({ q: "coffee", hl: "en", gl: "us" }),
  new GooglePlayProduct({ product_id: "com.duolingo" }),
  new AppleAppStoreSearch({ term: "coffee", country: "us", num: 10 }),
]);
```

Follow `litescrape_pagination.next` or use returned continuation tokens with the same operation and
parameters. Google Play's `chart`, `next_page_token`, `section_page_token`, and `see_more_token` are
mutually exclusive. Queries exclude category filters and charts. Apps/games charts require an omitted
device or `store_device: "phone"`; omit `store_device` with a query or category. Games queries use shared
Android app search; omit `q` or choose `games_category` to browse games.

Search text is limited to 2,048 UTF-8 bytes; Apple terms also have a 4,096 URL-encoded-byte limit.
Apple review pages start at one; exhausted pages return an empty list. Successful pages consume one
call. `search_metadata.raw_file` and `prettify_file`, when present, link to authenticated response
artifacts. Download them with the same bearer key; downloads are unbilled.

See the [API reference](https://litescrape.com/docs) for provider parameters and response groups.

## Development and releases

```sh
npm ci
npm run check
npm pack
npm run test:package
```

`npm run format` formats the source. Tests use local mock transports and a loopback HTTP server;
they require no API key or paid requests. The tests include all 34 endpoint allowlists, the Python
SDK's 547 Store boundary cases, recovery/idempotency scenarios, cancellation, ESM/CommonJS consumers,
and positive/negative TypeScript type checks. CI runs on Linux and Windows, including Node 22.13,
22, 24, and 26. The package smoke test installs the tarball into a fresh consumer without build scripts.

Update both `package.json` and `src/version.ts` for a release; regenerate the lockfile. A `v*` tag
triggers tests, package verification, and the publish workflow, which requires the tag to match the
package version. No tag or npm release is created by normal pushes.

Tagged releases use [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for GitHub
repository `litescrape/litescrape-sdk-ts`, workflow `publish.yml`, and environment `npm`. GitHub
authenticates to npm through OIDC; no npm token is stored in this repository. Releases from this
public repository include provenance attestations. If the repository becomes private, the workflow
disables provenance as required by npm.
