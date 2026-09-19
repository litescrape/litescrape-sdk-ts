import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import * as sdk from "../dist/esm/index.js";

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const allowlists = fixture("allowlists");
const paths = fixture("paths");

test("registry matches every Python endpoint, path, and parameter allowlist", () => {
  assert.equal(Object.keys(sdk.REQUEST_TYPES).length, 34);
  assert.deepEqual(Object.keys(sdk.REQUEST_TYPES).sort(), Object.keys(allowlists).sort());
  for (const [slug, Constructor] of Object.entries(sdk.REQUEST_TYPES)) {
    assert.equal(Constructor.endpoint, slug);
    assert.equal(Constructor.path, paths[slug]);
    assert.deepEqual([...Constructor.parameters].sort(), [...allowlists[slug]].sort(), slug);
  }
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
