# litescrape-sdk

TypeScript and JavaScript SDK for the [Litescrape API](https://litescrape.com): validated,
concurrent, retrying calls to all 139 endpoints of the v3 catalog (search engines, AI answers, maps
and reviews, app stores, social media, retail and marketplaces, jobs, real estate, and web fetch),
with results returned in input order.

Request validation follows the API's v3 OpenAPI contract; runtime behavior follows the
[Python SDK](https://github.com/litescrape/litescrape-sdk). Supports Node.js 22.13+ with ESM,
CommonJS, and TypeScript declarations. This is a server-side SDK: keep your API key on the server.

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

`REQUEST_TYPES` maps every endpoint slug to its request constructor. Constructors expose `path`,
`method`, and `parameters`; instances expose immutable normalized fields, `path`, `method`,
`queryParams()`, and `body()`. Use strings or `bigint` for numeric IDs larger than JavaScript's
safe integer range, such as TikTok, X, and Google Shopping IDs. Store IDs are strictly strings,
matching the Python Store contracts.

Most endpoints are called with `GET` and `queryParams()`. Array parameters, such as job search
filters, are sent as JSON text in the query string, as the API expects. Endpoints whose requests
contain nested JSON (`WebFetch`, `WebScreenshot`, `GoogleShoppingMerchantUrls`, and
`CopilotChatCompletions`) are sent as JSON `POST` bodies built by `body()`; their `method` is
`"POST"`. Durable batch submissions always send JSON bodies.

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

| Request class                | Endpoint slug                   | Route                                     |
| ---------------------------- | ------------------------------- | ----------------------------------------- |
| `GoogleSearch`               | `google_search`                 | `/api/google/search`                      |
| `GoogleAiOverview`           | `google_ai_overview`            | `/api/google/ai-overview`                 |
| `GoogleAiMode`               | `google_ai_mode`                | `/api/google/ai-mode`                     |
| `GoogleAds`                  | `google_ads`                    | `/api/google/ads`                         |
| `GoogleShopping`             | `google_shopping`               | `/api/google/shopping`                    |
| `GoogleShoppingProduct`      | `google_shopping_product`       | `/api/google/shopping/product`            |
| `GoogleLocal`                | `google_local`                  | `/api/google/local`                       |
| `GoogleMaps`                 | `google_maps`                   | `/api/google/maps`                        |
| `GoogleMapsLiveFootTraffic`  | `google_maps_live_foot_traffic` | `/api/google/maps/popular-times`          |
| `GoogleMapsPosts`            | `google_maps_posts`             | `/api/google/maps/posts`                  |
| `GoogleMapsPhoto`            | `google_maps_photo`             | `/api/google/maps/photo-meta`             |
| `GoogleReviews`              | `google_reviews`                | `/api/google/reviews`                     |
| `GoogleContributorReviews`   | `google_contributor_reviews`    | `/api/google/contributor-reviews`         |
| `BingSearch`                 | `bing_search`                   | `/api/bing/search`                        |
| `BingMaps`                   | `bing_maps`                     | `/api/bing/maps`                          |
| `DuckDuckGoSearch`           | `duckduckgo_search`             | `/api/duckduckgo/search`                  |
| `DuckDuckGoMaps`             | `duckduckgo_maps`               | `/api/duckduckgo/maps`                    |
| `YelpSearch`                 | `yelp_search`                   | `/api/yelp/search`                        |
| `YelpReviews`                | `yelp_reviews`                  | `/api/yelp/reviews`                       |
| `TripadvisorSearch`          | `tripadvisor_search`            | `/api/tripadvisor/search`                 |
| `TripadvisorPlace`           | `tripadvisor_place`             | `/api/tripadvisor/place`                  |
| `TripadvisorReviews`         | `tripadvisor_reviews`           | `/api/tripadvisor/reviews`                |
| `AppleMapsPlaces`            | `apple_maps_places`             | `/api/apple/maps/places`                  |
| `AppleMapsReviews`           | `apple_maps_reviews`            | `/api/apple/maps/reviews`                 |
| `GooglePlayApps`             | `google_play_apps`              | `/api/google/play/apps`                   |
| `GooglePlayGames`            | `google_play_games`             | `/api/google/play/games`                  |
| `GooglePlayBooks`            | `google_play_books`             | `/api/google/play/books`                  |
| `GooglePlayMovies`           | `google_play_movies`            | `/api/google/play/movies`                 |
| `GooglePlayProduct`          | `google_play_product`           | `/api/google/play/product`                |
| `GooglePlayReviews`          | `google_play_reviews`           | `/api/google/play/reviews`                |
| `AppleAppStoreSearch`        | `apple_app_store_search`        | `/api/apple/app-store/search`             |
| `AppleAppStoreProduct`       | `apple_app_store_product`       | `/api/apple/app-store/product`            |
| `AppleAppStoreReviews`       | `apple_app_store_reviews`       | `/api/apple/app-store/reviews`            |
| `WebFetch`                   | `web_fetch`                     | `POST /api/web/fetch`                     |
| `WebScreenshot`              | `web_screenshot`                | `POST /api/web/screenshot`                |
| `GoogleImages`               | `google_images`                 | `/api/google/images`                      |
| `GoogleGemini`               | `google_gemini`                 | `/api/google/gemini`                      |
| `GoogleShoppingMerchantUrls` | `google_shopping_merchant_urls` | `POST /api/google/shopping/merchant-urls` |
| `GoogleJobs`                 | `google_jobs`                   | `/api/google/jobs`                        |
| `IndeedSearch`               | `indeed_search`                 | `/api/indeed/search`                      |
| `GlassdoorSearch`            | `glassdoor_search`              | `/api/glassdoor/search`                   |
| `AshbySearch`                | `ashby_search`                  | `/api/ashby/search`                       |
| `ZipRecruiterSearch`         | `ziprecruiter_search`           | `/api/ziprecruiter/search`                |
| `LevelsSearch`               | `levels_search`                 | `/api/levels/search`                      |
| `BingImages`                 | `bing_images`                   | `/api/bing/images`                        |
| `BingShopping`               | `bing_shopping`                 | `/api/bing/shopping`                      |
| `BingProduct`                | `bing_product`                  | `/api/bing/product`                       |
| `BraveSearch`                | `brave_search`                  | `/api/brave/search`                       |
| `BraveAiMode`                | `brave_ai_mode`                 | `/api/brave/ai-mode`                      |
| `BaiduSearch`                | `baidu_search`                  | `/api/baidu/search`                       |
| `YandexSearch`               | `yandex_search`                 | `/api/yandex/search`                      |
| `YandexImages`               | `yandex_images`                 | `/api/yandex/images`                      |
| `NaverSearch`                | `naver_search`                  | `/api/naver/search`                       |
| `NaverAiOverview`            | `naver_ai_overview`             | `/api/naver/ai-overview`                  |
| `YahooSearch`                | `yahoo_search`                  | `/api/yahoo/search`                       |
| `YahooImages`                | `yahoo_images`                  | `/api/yahoo/images`                       |
| `YelpPlace`                  | `yelp_place`                    | `/api/yelp/place`                         |
| `AirbnbSearch`               | `airbnb_search`                 | `/api/airbnb/search`                      |
| `YouTubeSearch`              | `youtube_search`                | `/api/youtube/search`                     |
| `YouTubeChannel`             | `youtube_channel`               | `/api/youtube/channel`                    |
| `InstagramSearchPopular`     | `instagram_search_popular`      | `/api/instagram/search-popular`           |
| `InstagramProfile`           | `instagram_profile`             | `/api/instagram/profile`                  |
| `InstagramPosts`             | `instagram_posts`               | `/api/instagram/posts`                    |
| `InstagramPost`              | `instagram_post`                | `/api/instagram/post`                     |
| `InstagramProfilePostCount`  | `instagram_profile_post_count`  | `/api/instagram/profile-post-count`       |
| `InstagramEmbed`             | `instagram_embed`               | `/api/instagram/embed`                    |
| `TikTokProfile`              | `tiktok_profile`                | `/api/tiktok/profile`                     |
| `TikTokVideo`                | `tiktok_video`                  | `/api/tiktok/video`                       |
| `TikTokTranscript`           | `tiktok_transcript`             | `/api/tiktok/transcript`                  |
| `TikTokSearchSuggestions`    | `tiktok_search_suggestions`     | `/api/tiktok/search-suggestions`          |
| `TikTokUserLive`             | `tiktok_user_live`              | `/api/tiktok/user-live`                   |
| `TikTokLive`                 | `tiktok_live`                   | `/api/tiktok/live`                        |
| `TikTokSong`                 | `tiktok_song`                   | `/api/tiktok/song`                        |
| `TikTokProfileVideos`        | `tiktok_profile_videos`         | `/api/tiktok/profile-videos`              |
| `TikTokComments`             | `tiktok_comments`               | `/api/tiktok/comments`                    |
| `TikTokCommentReplies`       | `tiktok_comment_replies`        | `/api/tiktok/comment-replies`             |
| `TikTokFollowing`            | `tiktok_following`              | `/api/tiktok/following`                   |
| `TikTokFollowers`            | `tiktok_followers`              | `/api/tiktok/followers`                   |
| `TikTokSearchKeyword`        | `tiktok_search_keyword`         | `/api/tiktok/search-keyword`              |
| `TikTokSearchTop`            | `tiktok_search_top`             | `/api/tiktok/search-top`                  |
| `TikTokSearchHashtag`        | `tiktok_search_hashtag`         | `/api/tiktok/search-hashtag`              |
| `TikTokSongVideos`           | `tiktok_song_videos`            | `/api/tiktok/song-videos`                 |
| `TikTokTrendingFeed`         | `tiktok_trending_feed`          | `/api/tiktok/trending-feed`               |
| `TikTokCollectionVideos`     | `tiktok_collection_videos`      | `/api/tiktok/collection-videos`           |
| `AmazonSearch`               | `amazon_search`                 | `/api/amazon/search`                      |
| `AmazonProduct`              | `amazon_product`                | `/api/amazon/product`                     |
| `AmazonAutocomplete`         | `amazon_autocomplete`           | `/api/amazon/autocomplete`                |
| `AmazonFeaturedReviews`      | `amazon_featured_reviews`       | `/api/amazon/featured-reviews`            |
| `AmazonMediaReviews`         | `amazon_media_reviews`          | `/api/amazon/media-reviews`               |
| `CopilotChatCompletions`     | `copilot_chat_completions`      | `POST /api/copilot/chat/completions`      |
| `EbaySearch`                 | `ebay_search`                   | `/api/ebay/search`                        |
| `EbayProduct`                | `ebay_product`                  | `/api/ebay/product`                       |
| `EbaySeller`                 | `ebay_seller`                   | `/api/ebay/seller`                        |
| `XProfile`                   | `x_profile`                     | `/api/x/profile`                          |
| `XPost`                      | `x_post`                        | `/api/x/post`                             |
| `XUserPosts`                 | `x_user_posts`                  | `/api/x/user-posts`                       |
| `XCommunityPosts`            | `x_community_posts`             | `/api/x/community-posts`                  |
| `XCommunity`                 | `x_community`                   | `/api/x/community`                        |
| `EventbriteSearch`           | `eventbrite_search`             | `/api/eventbrite/search`                  |
| `WalmartSearch`              | `walmart_search`                | `/api/walmart/search`                     |
| `WalmartProduct`             | `walmart_product`               | `/api/walmart/product`                    |
| `HomeDepotSearch`            | `homedepot_search`              | `/api/homedepot/search`                   |
| `HomeDepotProduct`           | `homedepot_product`             | `/api/homedepot/product`                  |
| `TargetSearch`               | `target_search`                 | `/api/target/search`                      |
| `TargetProduct`              | `target_product`                | `/api/target/product`                     |
| `EtsySearch`                 | `etsy_search`                   | `/api/etsy/search`                        |
| `EtsyProduct`                | `etsy_product`                  | `/api/etsy/product`                       |
| `BestBuySearch`              | `bestbuy_search`                | `/api/bestbuy/search`                     |
| `BestBuyProduct`             | `bestbuy_product`               | `/api/bestbuy/product`                    |
| `WayfairSearch`              | `wayfair_search`                | `/api/wayfair/search`                     |
| `WayfairProduct`             | `wayfair_product`               | `/api/wayfair/product`                    |
| `AliExpressSearch`           | `aliexpress_search`             | `/api/aliexpress/search`                  |
| `AliExpressProduct`          | `aliexpress_product`            | `/api/aliexpress/product`                 |
| `KrogerSearch`               | `kroger_search`                 | `/api/kroger/search`                      |
| `KrogerProduct`              | `kroger_product`                | `/api/kroger/product`                     |
| `SproutsSearch`              | `sprouts_search`                | `/api/sprouts/search`                     |
| `SproutsProduct`             | `sprouts_product`               | `/api/sprouts/product`                    |
| `WholeFoodsSearch`           | `wholefoods_search`             | `/api/wholefoods/search`                  |
| `WholeFoodsProduct`          | `wholefoods_product`            | `/api/wholefoods/product`                 |
| `IkeaSearch`                 | `ikea_search`                   | `/api/ikea/search`                        |
| `IkeaProduct`                | `ikea_product`                  | `/api/ikea/product`                       |
| `ZillowSearch`               | `zillow_search`                 | `/api/zillow/search`                      |
| `ZillowProperty`             | `zillow_property`               | `/api/zillow/property`                    |
| `ZillowLocations`            | `zillow_locations`              | `/api/zillow/locations`                   |
| `RedfinSearch`               | `redfin_search`                 | `/api/redfin/search`                      |
| `RedfinProperty`             | `redfin_property`               | `/api/redfin/property`                    |
| `RealtorSearch`              | `realtor_search`                | `/api/realtor/search`                     |
| `RealtorProperty`            | `realtor_property`              | `/api/realtor/property`                   |
| `ApartmentsSearch`           | `apartments_search`             | `/api/apartments/search`                  |
| `ApartmentsProperty`         | `apartments_property`           | `/api/apartments/property`                |
| `HomesSearch`                | `homes_search`                  | `/api/homes/search`                       |
| `HomesProperty`              | `homes_property`                | `/api/homes/property`                     |
| `FacebookSearchPages`        | `facebook_search_pages`         | `/api/facebook/search-pages`              |
| `FacebookSearchProfiles`     | `facebook_search_profiles`      | `/api/facebook/search-profiles`           |
| `FacebookHashtagPosts`       | `facebook_hashtag_posts`        | `/api/facebook/hashtag-posts`             |
| `FacebookPost`               | `facebook_post`                 | `/api/facebook/post`                      |
| `FacebookPagePosts`          | `facebook_page_posts`           | `/api/facebook/page-posts`                |
| `FacebookMarketplaceBrowse`  | `facebook_marketplace_browse`   | `/api/facebook/marketplace-browse`        |
| `FacebookReel`               | `facebook_reel`                 | `/api/facebook/reel`                      |

Version 0.3.0 removed `GoogleMapsWebResults` (`google_maps_web_results`, `/api/google/maps/web`),
which the v3 API no longer serves.

`num` on `GoogleSearch` and `GoogleAiOverview` accepts 1 to 10, the most Google returns on one page.
Use `start` to page further, or pass a returned `page_token` alone:
`new GoogleSearch({ page_token })`. The token already carries the original search parameters.

Continuation tokens such as `page_token`, `next_page_token`, and `continuation_token` must be
reused with the same endpoint. Where the API requires it (YouTube, Zillow locations, Amazon media
reviews, Google Search), send the token without the original search parameters.

## Chat endpoints

`CopilotChatCompletions` and `GoogleGemini` return a completed text reply; streaming is not supported.

```typescript
import { CopilotChatCompletions, scrape } from "litescrape-sdk";

const [result] = await scrape([
  new CopilotChatCompletions({
    messages: [{ role: "user", content: "What is the weather near me right now?" }],
    country: "US",
    state: "CA",
  }),
]);
console.log(result.raiseForError());
```

Messages end with a `user` message, total at most 32,000 characters, and `state` requires
`country: "US"`. For Gemini, set `continuable: true` and send the returned
`subsequent_request_token` with the next `prompt`.

## Fetch and screenshots (Alpha)

`WebFetch` renders a public web page and returns its content as Markdown, HTML, plain text, or front
matter. `WebScreenshot` returns a base64 PNG in `screenshot_base64`; set `full_page: true` for the
whole page.

```typescript
import { WebFetch, WebScreenshot, scrape } from "litescrape-sdk";

const [page, shot] = await scrape([
  new WebFetch({
    url: "https://example.com",
    respond_with: "markdown",
    target_selector: ["main", "article"],
  }),
  new WebScreenshot({ url: "https://example.com", viewport: { width: 1440, height: 900 } }),
]);
console.log(page.raiseForError().content);
```

`respond_with` accepts `content` (default), `markdown`, `html`, `text`, or `frontmatter`, or a `+`
combination such as `markdown+frontmatter`. Version 0.3.0 follows the v3 contract: `wait_until`,
`with_links`, and `with_images` were replaced by `respond_timing`, `retain_links`, and
`retain_images`, and screenshots moved to `WebScreenshot`. Selectors accept one selector or a list of
up to 16. Both endpoints also accept `set_cookies`, `inject_page_script`, `inject_frame_script`,
`viewport`, `referer`, `assert_status_code`, `robots_txt`, `remove_overlay`, `detach_invisibles`,
`user_agent`, `locale`, and `page_timeout`. A rendered error page is still a successful, billed
capture unless you set `assert_status_code`.

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
they require no API key or paid requests. The tests include all 139 endpoint allowlists and documented
examples from the v3 OpenAPI contract, the Python SDK's 547 Store boundary cases,
recovery/idempotency scenarios, cancellation, ESM/CommonJS consumers, and positive/negative
TypeScript type checks. Refresh the catalog fixtures with
`node scripts/import-v3-catalog.mjs https://api.litescrape.com/api/openapi.json`. CI runs on Linux and Windows, including Node 22.13,
22, 24, and 26. The package smoke test installs the tarball into a fresh consumer without build scripts.

Update both `package.json` and `src/version.ts` for a release; regenerate the lockfile. A `v*` tag
triggers tests, package verification, and the publish workflow, which requires the tag to match the
package version. No tag or npm release is created by normal pushes.

Tagged releases use [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for GitHub
repository `litescrape/litescrape-sdk-ts`, workflow `publish.yml`, and environment `npm`. GitHub
authenticates to npm through OIDC; no npm token is stored in this repository. Releases from this
public repository include provenance attestations. If the repository becomes private, the workflow
disables provenance as required by npm.
