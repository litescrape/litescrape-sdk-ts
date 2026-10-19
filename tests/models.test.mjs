import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import * as sdk from "../dist/esm/index.js";

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const allowlists = fixture("allowlists");
const paths = fixture("paths");
const examples = fixture("examples");

test("registry matches every v3 endpoint, path, and parameter allowlist", () => {
  assert.equal(Object.keys(sdk.REQUEST_TYPES).length, 139);
  assert.deepEqual(Object.keys(sdk.REQUEST_TYPES).sort(), Object.keys(allowlists).sort());
  for (const [slug, Constructor] of Object.entries(sdk.REQUEST_TYPES)) {
    assert.equal(Constructor.endpoint, slug);
    assert.equal(Constructor.path, paths[slug]);
    assert.deepEqual([...Constructor.parameters].sort(), [...allowlists[slug]].sort(), slug);
  }
  assert.equal(sdk.REQUEST_TYPES.google_maps_web_results, undefined);
});

for (const [slug, params] of Object.entries(examples.requests))
  test(`v3 documented example validates: ${slug}`, () => {
    const request = sdk.parseRequest({ endpoint: slug, ...params });
    const Constructor = sdk.REQUEST_TYPES[slug];
    assert.equal(request.method, Constructor.method);
    if (examples.postOnly.includes(slug)) assert.equal(request.method, "POST");
    const wire = request.method === "POST" ? request.body() : request.queryParams();
    assert.ok(Object.keys(wire).every((name) => allowlists[slug].includes(name)));
    assert.deepEqual(new Constructor(params).body(), request.body());
  });

function expand(value) {
  if (value?.$repeat) return value.$repeat.repeat(value.count);
  if (value?.$gzip) return gunzipSync(Buffer.from(value.$gzip, "base64")).toString("utf8");
  if (Array.isArray(value)) return value.map(expand);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v)]));
  return value;
}
for (const surface of fixture("stores")) {
  for (const [index, item] of surface.cases.entries()) {
    test(`Python Store contract ${surface.mode} #${index}: ${item.label}`, () => {
      const input = { endpoint: surface.mode.replaceAll("-", "_"), ...expand(item.params) };
      if (!item.valid) return assert.throws(() => sdk.parseRequest(input), sdk.ValidationError);
      const request = sdk.parseRequest(input);
      assert.equal(request.path, surface.path);
      assert.ok(!("endpoint" in request.queryParams()));
      assert.ok(Object.keys(request.queryParams()).every((name) => surface.parameters.includes(name)));
    });
  }
}

const invalid = [
  ["google_search", {}],
  ["google_search", { q: "x", lat: 1 }],
  ["google_search", { q: "x", location: "a", uule: "b" }],
  ["google_search", { q: "x", location: "a", lat: 1, lon: 2 }],
  ["google_search", { q: "x", as_nlo: "1" }],
  ["google_search", { q: "x", as_dt: "i" }],
  ["google_ads", { q: "x" }],
  ["google_ai_mode", { q: "x", image_url: "https://a.test/img", subsequent_request_token: "t" }],
  ["google_ai_mode", { q: "x", location: "a", uule: "b" }],
  ["google_shopping", {}],
  ["google_shopping", { q: "x", on_sale: true, free_shipping: true }],
  ["google_shopping", { q: "x", min_price: 1, on_sale: true }],
  ["google_shopping_product", { q: "x" }],
  ["google_shopping_product", { q: "x", gpcid: "1", prds: "p" }],
  ["google_shopping_product", { q: "x", prds: "p", image_docid: "1" }],
  ["google_maps", {}],
  ["google_maps", { q: "coffee" }],
  ["google_maps", { type: "search" }],
  ["google_maps", { place_id: "p", data_cid: "1" }],
  ["google_maps", { q: "c", type: "search", ll: "@1,2,14z", lat: 1, lon: 2 }],
  ["google_maps", { q: "c", type: "search", z: 14, m: 100 }],
  ["google_maps", { q: "c", type: "search", open_at_hour: 5 }],
  ["google_maps", { q: "c", type: "search", open_state: "now", open_on_day: "mon" }],
  ["google_reviews", {}],
  ["google_reviews", { place_id: "a", data_id: "b" }],
  ["google_reviews", { place_id: "a", topic_id: "t", query: "q" }],
  ["bing_search", { q: "x", mkt: "en-US", cc: "US" }],
  ["bing_maps", {}],
  ["duckduckgo_search", { q: "x", m: 10, search_assist: false }],
  ["duckduckgo_maps", { q: "x" }],
  ["duckduckgo_maps", { q: "x", lat: 1 }],
  ["duckduckgo_maps", { q: "x", bbox: "1,2,3,4", lat: 1, lon: 2 }],
  ["tripadvisor_search", { q: "x", lat: 1 }],
  ["yelp_search", { find_desc: "x" }],
  ["apple_maps_places", {}],
  ["google_search", { page_token: "t", q: "x" }],
  ["google_search", { q: "x", radius: 5 }],
  ["google_search", { q: "x", location: "Austin", radius: 500 }],
  ["google_search", { q: "x", lat: 91, lon: 0 }],
  ["google_ai_overview", { q: "x", page_token: "t" }],
  ["google_jobs", { q: "x", page_token: "t" }],
  ["google_jobs", { q: "x", radius: 5 }],
  ["google_shopping_merchant_urls", { products: [] }],
  ["google_shopping_merchant_urls", { products: [{ headline_offer_docid: "1" }] }],
  ["copilot_chat_completions", { messages: [{ role: "assistant", content: "hi" }] }],
  ["copilot_chat_completions", { messages: [{ role: "user", content: " " }] }],
  ["copilot_chat_completions", { messages: [{ role: "user", content: "hi" }], stream: true }],
  ["copilot_chat_completions", { messages: [{ role: "user", content: "hi" }], state: "CA" }],
  ["amazon_search", {}],
  ["amazon_search", { k: "x", node: "1" }],
  ["amazon_media_reviews", {}],
  ["amazon_media_reviews", { page_token: "ar1.abc", asin: "B00FLYWNYQ" }],
  ["tiktok_profile", {}],
  ["tiktok_profile", { handle: "a", user_id: "1" }],
  ["tiktok_comments", { url: "https://www.tiktok.com/@a/video/1", video_id: "1" }],
  ["tiktok_collection_videos", {}],
  ["tiktok_search_top", { query: "x", count: 36 }],
  ["glassdoor_search", { q: "x", location_id: 1 }],
  ["glassdoor_search", { q: "x", job_type: "fulltime", job_types: ["parttime"] }],
  ["glassdoor_search", { q: "x", company_sizes: [6] }],
  ["indeed_search", { q: "x", salary_min: 10, salary_max: 5 }],
  ["indeed_search", { q: "x", page_token: "abc", page: 1 }],
  ["levels_search", { company: "a", companies: ["b"] }],
  ["levels_search", { company_valuations: [[5, 1]] }],
  ["ziprecruiter_search", { q: "x" }],
  ["ziprecruiter_search", { q: "x", location: "y", salary_min: 5, salary_max: 5 }],
  ["ebay_search", {}],
  ["ebay_search", { _nkw: "x", _sop: 2 }],
  ["ebay_search", { _nkw: "x", _ipg: 30 }],
  ["ebay_product", { product_id: "123456789012", lang: "en" }],
  ["ebay_seller", { seller_id: "a" }],
  ["airbnb_search", {}],
  ["airbnb_search", { q: "x", check_in_date: "2026-11-02" }],
  ["airbnb_search", { q: "x", check_in_date: "2026-11-02", check_out_date: "2026-11-01" }],
  ["airbnb_search", { q: "x", page: 16 }],
  ["zillow_search", {}],
  ["zillow_search", { q: "x", map_bounds: "1,2,3,4" }],
  ["zillow_search", { q: "x", min_price: 5, max_price: 1 }],
  ["zillow_property", {}],
  ["zillow_locations", { page_token: "t", q: "x" }],
  ["redfin_search", { region_id: 1 }],
  ["redfin_search", { url: "https://www.redfin.com/x", map_bounds: "1,2,3,4" }],
  ["redfin_search", { url: "https://www.redfin.com/x", sold_within_days: 5 }],
  ["youtube_search", {}],
  ["youtube_search", { q: "x", sp: "EgIQAQ", type: "video" }],
  ["youtube_search", { q: "x", type: "channel", duration: "over_20_min" }],
  ["youtube_channel", {}],
  ["youtube_channel", { channel_id: "x", search_query: "y", tab: "videos" }],
  ["youtube_channel", { channel_id: "x", tab: "posts", sort: "latest" }],
  ["naver_search", { query: "x", num: 10 }],
  ["naver_search", { query: "x", where: "news", sort_by: "r" }],
  ["naver_ai_overview", {}],
  ["yandex_images", {}],
  ["yandex_images", { text: "x", crop: "0;0;1;1" }],
  ["yandex_images", { text: "x", width: 10 }],
  ["brave_ai_mode", { q: "x", lat: 1 }],
  ["bing_images", { q: "x", mkt: "en-US", cc: "US" }],
  ["baidu_search", { q: "x", rn: 30 }],
  ["yelp_place", { place_id: "x", menu_name: "Dinner" }],
  ["facebook_marketplace_browse", { query: "bike" }],
  ["facebook_marketplace_browse", { location: "austin", min_price: 1 }],
  ["facebook_post", { url: "https://facebook.com/NASA/posts/1" }],
  ["homedepot_search", { query: "drill", page: 2 }],
  ["target_search", { query: "x", store_id: "abc" }],
  ["walmart_product", { url: "" }],
  ["instagram_profile", { handle: "bad handle" }],
  ["x_profile", { username: "this_is_much_too_long" }],
  ["web_fetch", { url: "https://example.com", respond_with: "screenshot" }],
  ["web_screenshot", { url: "https://example.com", respond_with: "markdown" }],
];
for (const [index, [endpoint, params]] of invalid.entries())
  test(`presence rule #${index}: ${endpoint}`, () => {
    assert.throws(() => sdk.parseRequest({ endpoint, ...params }), sdk.ValidationError);
  });

test("dictionary and typed inputs normalize identically and omit nulls", () => {
  const typed = new sdk.GoogleSearch({ q: "x", num: 10, nfpr: true, hl: null });
  assert.deepEqual(
    sdk.parseRequest({ endpoint: "google_search", q: "x", num: "10", nfpr: 1 }).queryParams(),
    typed.queryParams(),
  );
  assert.deepEqual(typed.queryParams(), { q: "x", num: "10", nfpr: "1" });
  assert.equal(typed.q, "x");
  assert.throws(() => {
    typed.q = "changed";
  }, TypeError);
  assert.equal(
    new sdk.AppleMapsPlaces({ muid: 4372355869446211302n }).queryParams().muid,
    "4372355869446211302",
  );
});
test("valid alternative selectors and presence rules", () => {
  const items = [
    new sdk.GoogleSearch({ kgmid: "/m/0k8z" }),
    new sdk.GoogleSearch({ q: "x", lat: 1, lon: 2, as_nlo: "1", as_nhi: "9" }),
    new sdk.GoogleSearch({ q: "x", as_dt: "i", as_sitesearch: "example.com" }),
    new sdk.GoogleAds({ q: "x", location: "Austin" }),
    new sdk.GoogleShopping({ shoprs: "abc" }),
    new sdk.GoogleShopping({ q: "x", on_sale: true, free_shipping: false }),
    new sdk.GoogleShoppingProduct({ q: "x", gpcid: "1", image_docid: "1" }),
    new sdk.GoogleMaps({ q: "c", type: "search", lat: 1, lon: 2, z: 14 }),
    new sdk.GoogleMaps({ place_id: "p" }),
    new sdk.GoogleMaps({ q: "c", type: "search", open_on_day: "mon", open_at_hour: 5 }),
    new sdk.GoogleReviews({ data_id: "0x1:0x2" }),
    new sdk.BingSearch({ q: "x", lat: 1 }),
    new sdk.BingMaps({ place_id: "x" }),
    new sdk.DuckDuckGoMaps({ q: "x", lat: 1, lon: 2 }),
    new sdk.DuckDuckGoMaps({ q: "x", bbox: "1,2,3,4" }),
  ];
  assert.equal(items.length, 15);
});
test("flags, string enums, booleans and empty strings serialize", () => {
  assert.deepEqual(new sdk.GoogleSearch({ q: "x", hl: "", pws: 0, peek_pws: true }).queryParams(), {
    hl: "",
    q: "x",
    pws: "0",
    peek_pws: "1",
  });
  assert.equal(new sdk.GoogleShopping({ q: "x", sort_by: 2, on_sale: false }).queryParams().sort_by, "2");
  assert.equal(new sdk.DuckDuckGoSearch({ q: "x", safe: -1 }).queryParams().safe, "-1");
  for (const value of [true, false, "true", "false"])
    assert.equal(new sdk.GoogleSearch({ q: "x", fast_mode: value }).queryParams().fast_mode, String(value));
  for (const value of [0, 1, "", "TRUE", "yes", "1", " true"])
    assert.throws(() => new sdk.GoogleSearch({ q: "x", fast_mode: value }), sdk.ValidationError);
  assert.throws(() => new sdk.GoogleAiOverview({ q: "x", fast_mode: true }), sdk.ValidationError);
});
test("invalid deadlines, unknown fields, endpoint names and types fail locally", () => {
  for (const timeout of [0, -1, 90.01, NaN, Infinity, false, "15"])
    assert.throws(() => new sdk.GoogleSearch({ q: "x", timeout }), sdk.ValidationError);
  for (const input of [
    null,
    "x",
    {},
    { endpoint: "toString" },
    { endpoint: "google" },
    { endpoint: "google_search", q: "x", bogus: 1 },
    { endpoint: "google_search", q: "x", device: "Desktop" },
  ])
    assert.throws(() => sdk.parseRequest(input), sdk.ValidationError);
  assert.equal(new sdk.GoogleSearch({ q: "x", timeout: 0.125 }).queryParams().timeout, "0.125");
});

test("Google Search num accepts 1 to 10", () => {
  for (const Constructor of [sdk.GoogleSearch, sdk.GoogleAiOverview]) {
    assert.equal(new Constructor({ q: "x", num: 10 }).queryParams().num, "10");
    for (const num of [0, 11, 100])
      assert.throws(() => new Constructor({ q: "x", num }), sdk.ValidationError);
  }
});

test("WebFetch builds a native JSON body and rejects invalid options", () => {
  const request = new sdk.WebFetch({
    url: "https://example.com",
    respond_with: "Markdown+FrontMatter",
    target_selector: ["main", "article"],
    page_timeout: "30",
    with_iframe: "quoted",
    with_shadow_dom: "true",
    viewport: { width: 1440, height: 900, is_mobile: null },
    markdown: { link_style: "referenced" },
    set_cookies: ["session=abc; Path=/"],
  });
  assert.equal(request.path, "/api/web/fetch");
  assert.equal(request.method, "POST");
  assert.deepEqual(request.body(), {
    url: "https://example.com",
    respond_with: "markdown+frontmatter",
    target_selector: ["main", "article"],
    page_timeout: 30,
    with_iframe: "quoted",
    with_shadow_dom: true,
    viewport: { width: 1440, height: 900 },
    markdown: { link_style: "referenced" },
    set_cookies: ["session=abc; Path=/"],
  });
  assert.equal(request.queryParams().target_selector, JSON.stringify(["main", "article"]));
  assert.throws(() => {
    request.target_selector.push("nav");
  }, TypeError);
  for (const params of [
    {},
    { url: "" },
    { url: "https://example.com", respond_with: "pdf" },
    { url: "https://example.com", respond_with: "markdown+markdown" },
    { url: "https://example.com", page_timeout: 181 },
    { url: "https://example.com", wait_until: "load" },
    { url: "https://example.com", with_links: "inlined" },
    { url: "https://example.com", viewport: { width: 1 } },
    { url: "https://example.com", target_selector: [] },
    { url: "https://example.com", markdown: { bogus: 1 } },
  ]) {
    assert.throws(() => new sdk.WebFetch(params), sdk.ValidationError);
  }
  const shot = new sdk.WebScreenshot({ url: "https://example.com", full_page: true });
  assert.deepEqual(shot.body(), { url: "https://example.com", full_page: true });
});

test("Google Search continuation sends page_token alone", () => {
  assert.deepEqual(new sdk.GoogleSearch({ page_token: "next", timeout: 10 }).queryParams(), {
    page_token: "next",
    timeout: "10",
  });
  assert.equal(new sdk.GoogleSearch({ q: "x", location: "Austin", radius: 199 }).queryParams().radius, "199");
  assert.equal(new sdk.GoogleSearch({ q: "x", lat: 1, lon: 2, radius: 500, device: "mobile" }).radius, 500);
});

test("query-string routes JSON-encode arrays; structured routes keep native JSON", () => {
  const jobs = new sdk.LevelsSearch({ q: "x", companies: ["openai"], company_valuations: [["1", 2]] });
  assert.equal(jobs.method, "GET");
  assert.deepEqual(jobs.queryParams(), {
    q: "x",
    companies: JSON.stringify(["openai"]),
    company_valuations: JSON.stringify([[1, 2]]),
  });
  const merchant = new sdk.GoogleShoppingMerchantUrls({
    products: [
      { gpcid: 2786756917538688235n, headline_offer_docid: "5148952067814683768", merchant: "Target" },
    ],
  });
  assert.equal(merchant.method, "POST");
  assert.deepEqual(merchant.body().products, [
    { gpcid: "2786756917538688235", headline_offer_docid: "5148952067814683768", merchant: "Target" },
  ]);
  const chat = new sdk.CopilotChatCompletions({
    messages: [{ role: "user", content: "Weather?" }],
    country: "us",
    state: "ca",
  });
  assert.deepEqual(chat.body(), {
    messages: [{ role: "user", content: "Weather?" }],
    country: "US",
    state: "CA",
  });
  assert.equal(
    new sdk.TikTokVideo({ video_id: 7106686413101468970n }).queryParams().video_id,
    "7106686413101468970",
  );
  assert.equal(new sdk.BaiduSearch({ q: "x", rn: "20" }).rn, 20);
});
