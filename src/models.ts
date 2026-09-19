import { z } from "zod";
import { ValidationError, isObject } from "./errors.js";
import {
  optional as opt,
  text,
  number,
  integer,
  boolean,
  flag,
  strictBoolean,
  timeoutSeconds,
  device,
  defineRequest,
  requireAny,
  exactlyOne,
  atMostOne,
  paired,
  requires,
  has,
  issue,
} from "./validation.js";
import {
  playApps,
  playGames,
  playBooks,
  playMovies,
  playProduct,
  playReviews,
  playRules,
  appleSearch,
  appleProduct,
  appleReviews,
} from "./stores.js";

export { ScrapeRequest } from "./validation.js";

const base = { timeout: opt(timeoutSeconds) };
const locale = { ...base, hl: opt(text), gl: opt(text), google_domain: opt(text) };
const origin = { location: opt(text), uule: opt(text) };
const originRules = [atMostOne("location", "uule")];
const safe = z.enum(["active", "off"]);
const search = {
  ...locale,
  ...origin,
  q: opt(text),
  ludocid: opt(text),
  kgmid: opt(text),
  lat: opt(number),
  lon: opt(number),
  radius: opt(number),
  lsig: opt(text),
  si: opt(text),
  ibp: opt(text),
  uds: opt(text),
  color_scheme: opt(z.enum(["light", "dark"])),
  cr: opt(text),
  lr: opt(text),
  tbs: opt(text),
  safe: opt(safe),
  nfpr: opt(flag),
  filter: opt(flag),
  pws: opt(flag),
  peek_pws: opt(flag),
  tbm: opt(z.enum(["lcl", "vid", "nws", "shop", "pts"])),
  start: opt(integer),
  num: opt(integer),
  device: opt(device),
  oq: opt(text),
  gs_lp: opt(text),
  sclient: opt(text),
  as_dt: opt(z.enum(["i", "e"])),
  as_epq: opt(text),
  as_eq: opt(text),
  as_lq: opt(text),
  as_nlo: opt(text),
  as_nhi: opt(text),
  as_oq: opt(text),
  as_q: opt(text),
  as_qdr: opt(text),
  as_rq: opt(text),
  as_sitesearch: opt(text),
};
const searchRules = [
  requireAny("q", "ludocid", "kgmid"),
  paired("lat", "lon"),
  atMostOne("location", "uule", "lat"),
  paired("as_nlo", "as_nhi"),
  requires("as_dt", "as_sitesearch"),
];

export const GoogleSearch = defineRequest(
  "google_search",
  "/api/google/search",
  { ...search, fast_mode: opt(strictBoolean) },
  searchRules,
);
export const GoogleAiOverview = defineRequest(
  "google_ai_overview",
  "/api/google/ai-overview",
  search,
  searchRules,
);
export const GoogleAiMode = defineRequest(
  "google_ai_mode",
  "/api/google/ai-mode",
  {
    ...locale,
    ...origin,
    q: text,
    device: opt(device),
    continuable: opt(boolean),
    subsequent_request_token: opt(text),
    image_url: opt(text),
  },
  [...originRules, atMostOne("image_url", "subsequent_request_token")],
);
export const GoogleAds = defineRequest("google_ads", "/api/google/ads", {
  ...base,
  q: text,
  location: text,
  hl: opt(text),
  safe: opt(safe),
  nfpr: opt(flag),
  device: opt(device),
});
export const GoogleShopping = defineRequest(
  "google_shopping",
  "/api/google/shopping",
  {
    ...locale,
    ...origin,
    q: opt(text),
    shoprs: opt(text),
    min_price: opt(number),
    max_price: opt(number),
    sort_by: opt(
      z
        .union([z.enum(["1", "2", "3", "4"]), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
        .transform(String),
    ),
    free_shipping: opt(boolean),
    on_sale: opt(boolean),
    small_business: opt(boolean),
    start: opt(integer),
    num: opt(integer),
    device: opt(device),
  },
  [
    ...originRules,
    requireAny("q", "shoprs"),
    (p, c) => {
      if (
        [
          has(p, "min_price") || has(p, "max_price"),
          !!p.on_sale,
          !!p.free_shipping,
          !!p.small_business,
        ].filter(Boolean).length > 1
      )
        issue(c, "only one of a price range, on_sale, free_shipping, or small_business may be used");
    },
  ],
);
export const GoogleShoppingProduct = defineRequest(
  "google_shopping_product",
  "/api/google/shopping/product",
  {
    ...locale,
    ...origin,
    q: text,
    gpcid: opt(text),
    headline_offer_docid: opt(text),
    image_docid: opt(text),
    prds: opt(text),
    device: opt(device),
  },
  [
    ...originRules,
    exactlyOne("gpcid", "prds"),
    requires("headline_offer_docid", "gpcid"),
    requires("image_docid", "gpcid"),
  ],
);
export const GoogleLocal = defineRequest(
  "google_local",
  "/api/google/local",
  {
    ...locale,
    ...origin,
    q: text,
    ludocid: opt(text),
    tbs: opt(text),
    start: opt(integer),
    device: opt(device),
  },
  originRules,
);
export const GoogleMaps = defineRequest(
  "google_maps",
  "/api/google/maps",
  {
    ...locale,
    q: opt(text),
    ll: opt(text),
    location: opt(text),
    lat: opt(number),
    lon: opt(number),
    z: opt(number),
    m: opt(integer),
    nearby: opt(boolean),
    data: opt(text),
    place_id: opt(text),
    data_cid: opt(text),
    type: opt(z.enum(["search", "place"])),
    start: opt(integer),
    min_price: opt(integer),
    max_price: opt(integer),
    min_rating: opt(number),
    open_state: opt(z.enum(["now", "24h"])),
    open_on_day: opt(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])),
    open_at_hour: opt(integer),
  },
  [
    requireAny("q", "place_id", "data_cid", "data"),
    atMostOne("place_id", "data_cid", "data"),
    paired("lat", "lon"),
    atMostOne("ll", "lat", "location"),
    atMostOne("z", "m"),
    atMostOne("open_state", "open_on_day"),
    atMostOne("open_state", "open_at_hour"),
    requires("open_at_hour", "open_on_day"),
    (p, c) => {
      if (!["place_id", "data_cid", "data"].some((f) => has(p, f)) && !has(p, "type"))
        issue(c, "type is required when searching by q");
      if (p.type === "search" && !has(p, "q")) issue(c, "q is required when type=search");
    },
  ],
);
export const GoogleMapsLiveFootTraffic = defineRequest(
  "google_maps_live_foot_traffic",
  "/api/google/maps/popular-times",
  { ...locale, place_id: text },
);
export const GoogleMapsPosts = defineRequest("google_maps_posts", "/api/google/maps/posts", {
  ...locale,
  data_id: text,
  next_page_token: opt(text),
});
export const GoogleMapsPhoto = defineRequest("google_maps_photo", "/api/google/maps/photo-meta", {
  ...locale,
  data_id: text,
});
export const GoogleMapsWebResults = defineRequest("google_maps_web_results", "/api/google/maps/web", {
  ...locale,
  q: text,
  ibp: text,
  device: opt(z.literal("desktop")),
  start: opt(integer),
});
export const GoogleReviews = defineRequest(
  "google_reviews",
  "/api/google/reviews",
  {
    ...base,
    place_id: opt(text),
    data_id: opt(text),
    hl: opt(text),
    gl: opt(text),
    sort_by: opt(z.enum(["qualityScore", "newestFirst", "ratingHigh", "ratingLow"])),
    topic_id: opt(text),
    query: opt(text),
    num: opt(integer),
    next_page_token: opt(text),
    source_metadata: opt(boolean),
  },
  [exactlyOne("place_id", "data_id"), atMostOne("topic_id", "query")],
);
export const GoogleContributorReviews = defineRequest(
  "google_contributor_reviews",
  "/api/google/contributor-reviews",
  {
    ...base,
    contributor_id: text,
    hl: opt(text),
    gl: opt(text),
    limit: opt(integer),
  },
);
export const BingSearch = defineRequest(
  "bing_search",
  "/api/bing/search",
  {
    ...base,
    engine: opt(z.literal("bing")),
    q: text,
    location: opt(text),
    lat: opt(number),
    lon: opt(number),
    mkt: opt(text),
    cc: opt(text),
    first: opt(integer),
    safeSearch: opt(z.enum(["off", "moderate", "strict"])),
    filters: opt(text),
    device: opt(device),
  },
  [atMostOne("mkt", "cc")],
);
export const BingMaps = defineRequest(
  "bing_maps",
  "/api/bing/maps",
  {
    ...base,
    q: opt(text),
    place_id: opt(text),
    cp: opt(text),
    setlang: opt(text),
    first: opt(integer),
    count: opt(integer),
  },
  [requireAny("q", "place_id")],
);
export const DuckDuckGoSearch = defineRequest(
  "duckduckgo_search",
  "/api/duckduckgo/search",
  {
    ...base,
    q: text,
    kl: opt(text),
    search_assist: opt(boolean),
    safe: opt(
      z.union([z.enum(["1", "-1", "-2"]), z.literal(1), z.literal(-1), z.literal(-2)]).transform(String),
    ),
    df: opt(text),
    start: opt(integer),
    m: opt(integer),
  },
  [atMostOne("m", "search_assist")],
);
export const DuckDuckGoMaps = defineRequest(
  "duckduckgo_maps",
  "/api/duckduckgo/maps",
  {
    ...base,
    q: text,
    bbox: opt(text),
    lat: opt(number),
    lon: opt(number),
    strict_bbox: opt(boolean),
  },
  [paired("lat", "lon"), exactlyOne("bbox", "lat")],
);
export const YelpSearch = defineRequest("yelp_search", "/api/yelp/search", {
  ...base,
  find_desc: opt(text),
  find_loc: text,
  yelp_domain: opt(text),
  l: opt(text),
  cflt: opt(text),
  sortby: opt(z.enum(["recommended", "rating", "review_count"])),
  attrs: opt(text),
  start: opt(integer),
});
export const YelpReviews = defineRequest("yelp_reviews", "/api/yelp/reviews", {
  ...base,
  place_id: text,
  yelp_domain: opt(text),
  hl: opt(text),
  q: opt(text),
  sortby: opt(
    z.enum(["relevance_desc", "date_desc", "date_asc", "rating_desc", "rating_asc", "elites_desc"]),
  ),
  rating: opt(text),
  not_recommended: opt(boolean),
  start: opt(integer),
  num: opt(integer),
  not_recommended_start: opt(integer),
});
const tripadvisor = { ...base, tripadvisor_domain: opt(text), locale: opt(text) };
export const TripadvisorSearch = defineRequest(
  "tripadvisor_search",
  "/api/tripadvisor/search",
  {
    ...tripadvisor,
    q: text,
    geo_id: opt(integer),
    lat: opt(number),
    lon: opt(number),
    place_type: opt(z.enum(["all", "accommodation", "attraction", "attraction_product", "eatery", "geo"])),
    start: opt(integer),
    num: opt(integer),
  },
  [paired("lat", "lon")],
);
export const TripadvisorPlace = defineRequest("tripadvisor_place", "/api/tripadvisor/place", {
  ...tripadvisor,
  place_id: text,
  currency: opt(text),
  geo_id: opt(integer),
});
export const TripadvisorReviews = defineRequest("tripadvisor_reviews", "/api/tripadvisor/reviews", {
  ...tripadvisor,
  place_id: text,
  start: opt(integer),
  num: opt(integer),
  sort_by: opt(z.enum(["recent", "relevance"])),
  translate: opt(boolean),
});
export const AppleMapsPlaces = defineRequest("apple_maps_places", "/api/apple/maps/places", {
  ...base,
  muid: text,
  locale: opt(text),
});
export const AppleMapsReviews = defineRequest("apple_maps_reviews", "/api/apple/maps/reviews", {
  ...base,
  muid: text,
  locale: opt(text),
});
export const GooglePlayApps = defineRequest(
  "google_play_apps",
  "/api/google/play/apps",
  { ...base, ...playApps },
  playRules("apps"),
);
export const GooglePlayGames = defineRequest(
  "google_play_games",
  "/api/google/play/games",
  { ...base, ...playGames },
  playRules("games"),
);
export const GooglePlayBooks = defineRequest(
  "google_play_books",
  "/api/google/play/books",
  { ...base, ...playBooks },
  playRules("books"),
);
export const GooglePlayMovies = defineRequest(
  "google_play_movies",
  "/api/google/play/movies",
  { ...base, ...playMovies },
  playRules("movies"),
);
export const GooglePlayProduct = defineRequest(
  "google_play_product",
  "/api/google/play/product",
  { ...base, ...playProduct },
  playRules("product"),
);
export const GooglePlayReviews = defineRequest(
  "google_play_reviews",
  "/api/google/play/reviews",
  { ...base, ...playReviews },
  playRules("reviews"),
);
export const AppleAppStoreSearch = defineRequest("apple_app_store_search", "/api/apple/app-store/search", {
  ...base,
  ...appleSearch,
});
export const AppleAppStoreProduct = defineRequest("apple_app_store_product", "/api/apple/app-store/product", {
  ...base,
  ...appleProduct,
});
export const AppleAppStoreReviews = defineRequest("apple_app_store_reviews", "/api/apple/app-store/reviews", {
  ...base,
  ...appleReviews,
});

export const REQUEST_TYPES = Object.freeze({
  google_search: GoogleSearch,
  google_ai_overview: GoogleAiOverview,
  google_ai_mode: GoogleAiMode,
  google_ads: GoogleAds,
  google_shopping: GoogleShopping,
  google_shopping_product: GoogleShoppingProduct,
  google_local: GoogleLocal,
  google_maps: GoogleMaps,
  google_maps_live_foot_traffic: GoogleMapsLiveFootTraffic,
  google_maps_posts: GoogleMapsPosts,
  google_maps_photo: GoogleMapsPhoto,
  google_maps_web_results: GoogleMapsWebResults,
  google_reviews: GoogleReviews,
  google_contributor_reviews: GoogleContributorReviews,
  bing_search: BingSearch,
  bing_maps: BingMaps,
  duckduckgo_search: DuckDuckGoSearch,
  duckduckgo_maps: DuckDuckGoMaps,
  yelp_search: YelpSearch,
  yelp_reviews: YelpReviews,
  tripadvisor_search: TripadvisorSearch,
  tripadvisor_place: TripadvisorPlace,
  tripadvisor_reviews: TripadvisorReviews,
  apple_maps_places: AppleMapsPlaces,
  apple_maps_reviews: AppleMapsReviews,
  google_play_apps: GooglePlayApps,
  google_play_games: GooglePlayGames,
  google_play_books: GooglePlayBooks,
  google_play_movies: GooglePlayMovies,
  google_play_product: GooglePlayProduct,
  google_play_reviews: GooglePlayReviews,
  apple_app_store_search: AppleAppStoreSearch,
  apple_app_store_product: AppleAppStoreProduct,
  apple_app_store_reviews: AppleAppStoreReviews,
});
export type Endpoint = keyof typeof REQUEST_TYPES;
export type AnyRequest = InstanceType<(typeof REQUEST_TYPES)[Endpoint]>;
export type RequestInput = {
  [E in Endpoint]: { endpoint: E } & ConstructorParameters<(typeof REQUEST_TYPES)[E]>[0];
}[Endpoint];
export type RequestItem = RequestInput | AnyRequest;

export type GoogleSearch = InstanceType<typeof GoogleSearch>;
export type GoogleAiOverview = InstanceType<typeof GoogleAiOverview>;
export type GoogleAiMode = InstanceType<typeof GoogleAiMode>;
export type GoogleAds = InstanceType<typeof GoogleAds>;
export type GoogleShopping = InstanceType<typeof GoogleShopping>;
export type GoogleShoppingProduct = InstanceType<typeof GoogleShoppingProduct>;
export type GoogleLocal = InstanceType<typeof GoogleLocal>;
export type GoogleMaps = InstanceType<typeof GoogleMaps>;
export type GoogleMapsLiveFootTraffic = InstanceType<typeof GoogleMapsLiveFootTraffic>;
export type GoogleMapsPosts = InstanceType<typeof GoogleMapsPosts>;
export type GoogleMapsPhoto = InstanceType<typeof GoogleMapsPhoto>;
export type GoogleMapsWebResults = InstanceType<typeof GoogleMapsWebResults>;
export type GoogleReviews = InstanceType<typeof GoogleReviews>;
export type GoogleContributorReviews = InstanceType<typeof GoogleContributorReviews>;
export type BingSearch = InstanceType<typeof BingSearch>;
export type BingMaps = InstanceType<typeof BingMaps>;
export type DuckDuckGoSearch = InstanceType<typeof DuckDuckGoSearch>;
export type DuckDuckGoMaps = InstanceType<typeof DuckDuckGoMaps>;
export type YelpSearch = InstanceType<typeof YelpSearch>;
export type YelpReviews = InstanceType<typeof YelpReviews>;
export type TripadvisorSearch = InstanceType<typeof TripadvisorSearch>;
export type TripadvisorPlace = InstanceType<typeof TripadvisorPlace>;
export type TripadvisorReviews = InstanceType<typeof TripadvisorReviews>;
export type AppleMapsPlaces = InstanceType<typeof AppleMapsPlaces>;
export type AppleMapsReviews = InstanceType<typeof AppleMapsReviews>;
export type GooglePlayApps = InstanceType<typeof GooglePlayApps>;
export type GooglePlayGames = InstanceType<typeof GooglePlayGames>;
export type GooglePlayBooks = InstanceType<typeof GooglePlayBooks>;
export type GooglePlayMovies = InstanceType<typeof GooglePlayMovies>;
export type GooglePlayProduct = InstanceType<typeof GooglePlayProduct>;
export type GooglePlayReviews = InstanceType<typeof GooglePlayReviews>;
export type AppleAppStoreSearch = InstanceType<typeof AppleAppStoreSearch>;
export type AppleAppStoreProduct = InstanceType<typeof AppleAppStoreProduct>;
export type AppleAppStoreReviews = InstanceType<typeof AppleAppStoreReviews>;

/** Validate an untrusted object, including its endpoint discriminator. */
export function parseRequest(input: unknown): AnyRequest {
  if (!isObject(input) || typeof input.endpoint !== "string" || !Object.hasOwn(REQUEST_TYPES, input.endpoint))
    throw new ValidationError([[0, `endpoint must be one of: ${Object.keys(REQUEST_TYPES).join(", ")}`]]);
  const { endpoint, ...params } = input;
  // A registry lookup selects one constructor; its schema validates the unknown parameters.
  const Constructor = REQUEST_TYPES[endpoint as Endpoint] as unknown as new (params: unknown) => AnyRequest;
  return new Constructor(params);
}

export const keyStatusSchema = z
  .object({
    remaining_calls: z.number().int(),
    concurrency_limit: z.number().int().nullish(),
    status: z.string().default(""),
    free_calls: z.number().int().nullish(),
    minimum_top_up_cents: z.number().int().nullish(),
    cents_per_1000_calls: z.number().int().nullish(),
    has_billing_email: z.boolean().nullish(),
    credit_expiry_months: z.number().int().nullish(),
    credits_expire_at: z.string().nullish(),
    expiring_calls: z.number().int().nullish(),
    request_id: z.string().default(""),
  })
  .passthrough();
export type KeyStatus = z.output<typeof keyStatusSchema>;
