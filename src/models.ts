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
  jsonBoolean,
  timeoutSeconds,
  device,
  string,
  int,
  decimal,
  choice,
  isoDate,
  list,
  defineRequest,
  requireAny,
  exactlyOne,
  atMostOne,
  paired,
  requires,
  ordered,
  alone,
  unless,
  has,
  issue,
  type Rule,
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
  lat: opt(decimal(-90, 90)),
  lon: opt(decimal(-180, 180)),
  radius: opt(decimal(1, 1000)),
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
  start: opt(int(0)),
  // Google returns at most ten organic rows per page.
  num: opt(integer.pipe(z.number().min(1).max(10))),
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
const searchRules: Rule[] = [
  requireAny("q", "ludocid", "kgmid"),
  paired("lat", "lon"),
  atMostOne("location", "uule", "lat"),
  (p, c) => {
    if (!has(p, "radius")) return;
    if (!has(p, "location") && !has(p, "lat")) issue(c, "radius requires location or lat/lon");
    if ((p.device ?? "desktop") === "desktop" && (p.radius as number) > 199)
      issue(c, "desktop radius must be between 1 and 199 meters");
  },
  paired("as_nlo", "as_nhi"),
  requires("as_dt", "as_sitesearch"),
];

export const GoogleSearch = defineRequest(
  "google_search",
  "/api/google/search",
  // page_token carries the original search parameters and is sent alone.
  { ...search, fast_mode: opt(strictBoolean), page_token: opt(string(undefined, 32768)) },
  [alone("page_token"), unless("page_token", searchRules)],
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
// Web routes take structured JSON (selector lists, cookies, viewport), so they are sent as POST bodies.
const selector = z.string().min(1).max(2048);
const selectors = z.union([selector, list(selector, 1, 16)]);
const scripts = list(z.string().min(1).max(8192), 1, 8);
const browser = {
  ...base,
  url: z.string().min(1).max(8192),
  remove_overlay: opt(jsonBoolean),
  detach_invisibles: opt(jsonBoolean),
  wait_for_selector: opt(selectors),
  set_cookies: opt(list(z.string().min(3).max(4096), 1, 100)),
  user_agent: opt(z.string().min(1).max(1024)),
  inject_page_script: opt(scripts),
  inject_frame_script: opt(scripts),
  page_timeout: opt(int(1, 180)),
  locale: opt(
    z
      .string()
      .min(2)
      .max(64)
      .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/),
  ),
  referer: opt(z.string().min(1).max(8192)),
  assert_status_code: opt(int(100, 599)),
  viewport: opt(
    z.strictObject({
      width: int(1, 4096),
      height: int(1, 4096),
      device_scale_factor: opt(number.pipe(z.number().gt(0).max(4))),
      is_mobile: opt(jsonBoolean),
      is_landscape: opt(jsonBoolean),
      has_touch: opt(jsonBoolean),
    }),
  ),
  robots_txt: opt(z.string().min(1).max(256)),
  respond_timing: opt(
    z.enum(["html", "visible-content", "mutation-idle", "resource-idle", "media-idle", "network-idle"]),
  ),
};
const formats = ["content", "markdown", "html", "text", "frontmatter"];
export const WebFetch = defineRequest(
  "web_fetch",
  "/api/web/fetch",
  {
    ...browser,
    // One format, or a "+" combination such as "markdown+frontmatter". Screenshots use WebScreenshot.
    respond_with: opt(
      z
        .string()
        .min(3)
        .max(64)
        .transform((value) => value.toLowerCase())
        .refine(
          (value) => {
            const parts = value.split("+");
            return parts.every((part) => formats.includes(part)) && new Set(parts).size === parts.length;
          },
          `respond_with must be one of, or a '+' combination of: ${formats.join(", ")}`,
        ),
    ),
    with_links_summary: opt(z.union([jsonBoolean, z.literal("all")])),
    with_images_summary: opt(jsonBoolean),
    retain_images: opt(z.enum(["none", "all", "alt"])),
    retain_links: opt(z.enum(["none", "all", "text", "gpt-oss"])),
    retain_media: opt(z.enum(["none", "text", "link", "image", "html"])),
    preset: opt(z.enum(["reader", "index", "research", "agent", "spider"])),
    no_gfm: opt(z.union([jsonBoolean, z.literal("table")])),
    target_selector: opt(selectors),
    remove_selector: opt(selectors),
    keep_img_data_url: opt(jsonBoolean),
    with_iframe: opt(z.union([jsonBoolean, z.literal("quoted")])),
    with_shadow_dom: opt(jsonBoolean),
    engine: opt(z.enum(["auto", "browser", "curl"])),
    token_budget: opt(int(1, 10_000_000)),
    markdown: opt(
      z.strictObject({
        heading_style: opt(z.enum(["setext", "atx"])),
        hr: opt(z.string().min(1).max(128)),
        bullet_list_marker: opt(z.enum(["-", "+", "*"])),
        em_delimiter: opt(z.enum(["_", "*"])),
        strong_delimiter: opt(z.enum(["__", "**"])),
        link_style: opt(z.enum(["inlined", "referenced", "discarded"])),
        link_reference_style: opt(z.enum(["full", "collapsed", "shortcut", "discarded"])),
      }),
    ),
    markdown_chunking: opt(
      z.enum(["true", "h1", "h2", "h3", "h4", "h5", "structured", "s1", "s2", "s3", "s4", "s5"]),
    ),
    max_tokens: opt(int(500, 10_000_000)),
    base: opt(z.enum(["initial", "final"])),
  },
  [],
  "POST",
);
export const WebScreenshot = defineRequest(
  "web_screenshot",
  "/api/web/screenshot",
  { ...browser, full_page: opt(jsonBoolean) },
  [],
  "POST",
);

const googleHl = string(undefined, undefined, /^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/);
const googleGl = string(undefined, undefined, /^[a-z]{2}$/);
export const GoogleImages = defineRequest("google_images", "/api/google/images", {
  ...base,
  q: string(1, 2048),
  hl: opt(googleHl),
  gl: opt(googleGl),
  safe: opt(safe),
  tbs: opt(string(undefined, 4096)),
  start: opt(int(0, 1000)),
  num: opt(int(1, 100)),
  device: opt(device),
});
export const GoogleGemini = defineRequest("google_gemini", "/api/google/gemini", {
  ...base,
  prompt: string(1, 32000),
  hl: opt(string(undefined, undefined, /^[a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?$/)),
  continuable: opt(boolean),
  subsequent_request_token: opt(string(1, 32768)),
});
const offerId = string(undefined, undefined, /^[0-9]{1,20}$/);
export const GoogleShoppingMerchantUrls = defineRequest(
  "google_shopping_merchant_urls",
  "/api/google/shopping/merchant-urls",
  {
    ...base,
    products: list(
      z.strictObject({ gpcid: opt(offerId), headline_offer_docid: offerId, merchant: string(1, 200) }),
      1,
      100,
    ),
    gl: opt(string(undefined, undefined, /^[a-zA-Z]{2}$/)),
    hl: opt(string(undefined, undefined, /^[a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?$/)),
  },
  [],
  "POST",
);

// Job search arrays are JSON-encoded in query strings, as the API expects for GET.
const jobText = string(1, 512);
const jobPage = { page: opt(int(1)) };
const jobToken = string(1, 32768, /^[A-Za-z0-9+/=_-]+$/);
const continuation: Rule = (p, c) => {
  if (has(p, "page_token") && (p.page ?? 1) === 1) issue(c, "page_token requires page greater than 1");
};
const jobList = list(string(1, 512));
export const GoogleJobs = defineRequest(
  "google_jobs",
  "/api/google/jobs",
  {
    ...base,
    ...jobPage,
    q: jobText,
    page_token: opt(jobToken),
    hl: opt(googleHl),
    gl: opt(googleGl),
    location: opt(jobText),
    uule: opt(string(1, 2048)),
    lat: opt(decimal(-90, 90)),
    lon: opt(decimal(-180, 180)),
    radius: opt(decimal(1, 199)),
    uds: opt(string(1, 16384)),
    tbs: opt(string(1, 2048)),
    include_filters: opt(boolean),
  },
  [continuation, paired("lat", "lon"), atMostOne("location", "uule", "lat"), requires("radius", "lat")],
);
export const IndeedSearch = defineRequest(
  "indeed_search",
  "/api/indeed/search",
  {
    ...base,
    ...jobPage,
    q: opt(jobText),
    page_token: opt(jobToken),
    location: opt(jobText),
    radius: opt(int(0, 100)),
    radius_unit: opt(z.enum(["miles", "kilometers"])),
    country: opt(string(undefined, undefined, /^[A-Z]{2}$/)),
    locale: opt(string(undefined, undefined, /^[a-z]{2,3}-[A-Z]{2}$/)),
    limit: opt(int(1, 100)),
    sort: opt(z.enum(["relevance", "date"])),
    fromage: opt(int(1)),
    job_type: opt(
      z.enum([
        "fulltime",
        "parttime",
        "contract",
        "temporary",
        "internship",
        "permanent",
        "temp_to_hire",
        "freelance",
      ]),
    ),
    workplace: opt(z.enum(["remote", "hybrid"])),
    easy_apply: opt(boolean),
    education: opt(z.enum(["high_school", "associate", "bachelor", "master", "doctoral"])),
    no_experience: opt(boolean),
    experience_level: opt(z.enum(["entry", "mid", "senior"])),
    salary_min: opt(int(0)),
    salary_max: opt(int(0)),
    experience_months_min: opt(int(0)),
    experience_months_max: opt(int(0)),
    job_language: opt(string(undefined, undefined, /^[a-z]{2,3}$/)),
    employer_keys: opt(jobList),
    attribute_keys: opt(jobList),
    any_attribute_keys: opt(jobList),
  },
  [
    continuation,
    ordered("salary_min", "salary_max"),
    ordered("experience_months_min", "experience_months_max"),
  ],
);
export const GlassdoorSearch = defineRequest(
  "glassdoor_search",
  "/api/glassdoor/search",
  {
    ...base,
    ...jobPage,
    q: opt(jobText),
    location: opt(jobText),
    page_token: opt(jobToken),
    location_id: opt(int(1)),
    location_type: opt(z.enum(["C", "S", "N"])),
    location_country: opt(string(undefined, undefined, /^[A-Z]{2}$/)),
    radius: opt(int(0, 100)),
    job_type: opt(z.enum(["fulltime", "parttime", "contract", "temporary", "internship", "permanent"])),
    job_types: opt(jobList),
    from_age: opt(int(1, 30)),
    salary_min: opt(int(0)),
    salary_max: opt(int(0)),
    remote: opt(boolean),
    easy_apply: opt(boolean),
    seniority: opt(z.enum(["internship", "entrylevel", "midseniorlevel", "director", "executive"])),
    company_id: opt(int(1)),
    company_sizes: opt(list(choice(1, 2, 3, 4, 5))),
    industry_id: opt(int(1)),
    occupation_id: opt(int(1)),
    city_id: opt(int(1)),
    min_rating: opt(decimal(0, 5)),
    sort: opt(z.enum(["relevance", "date_asc", "date_desc"])),
    include_filters: opt(boolean),
  },
  [
    continuation,
    paired("location_id", "location_type"),
    atMostOne("location", "location_id"),
    requires("location_country", "location"),
    atMostOne("job_type", "job_types"),
    ordered("salary_min", "salary_max"),
  ],
);
export const AshbySearch = defineRequest("ashby_search", "/api/ashby/search", {
  ...base,
  ...jobPage,
  board: string(undefined, undefined, /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  q: opt(jobText),
  location: opt(jobText),
  department: opt(jobText),
  team: opt(jobText),
  workplace_type: opt(z.enum(["OnSite", "Remote", "Hybrid"])),
  country: opt(jobText),
  region: opt(jobText),
  city: opt(jobText),
  remote: opt(boolean),
  employment_type: opt(z.enum(["FullTime", "PartTime", "Intern", "Contract", "Temporary"])),
  limit: opt(int(1, 100)),
  include_compensation: opt(boolean),
});
export const ZipRecruiterSearch = defineRequest(
  "ziprecruiter_search",
  "/api/ziprecruiter/search",
  {
    ...base,
    ...jobPage,
    q: jobText,
    location: jobText,
    radius: opt(int(0, 5000)),
    days: opt(int(1)),
    employment_types: opt(
      list(
        z.enum(["full_time", "part_time", "contract", "contract_to_hire", "temporary", "as_needed", "other"]),
      ),
    ),
    location_type: opt(z.enum(["no_remote", "only_remote", "hybrid"])),
    salary_min: opt(int(0)),
    salary_max: opt(int(0)),
    experience_level: opt(z.enum(["no_experience", "junior", "mid", "senior"])),
    easy_apply: opt(boolean),
  },
  [ordered("salary_min", "salary_max", true)],
);
const slug = string(undefined, undefined, /^[a-z0-9][a-z0-9-]{0,127}$/);
export const LevelsSearch = defineRequest(
  "levels_search",
  "/api/levels/search",
  {
    ...base,
    ...jobPage,
    q: opt(jobText),
    company: opt(slug),
    location: opt(slug),
    sort: opt(z.enum(["relevance", "date_published", "total_compensation"])),
    limit: opt(int(1, 20)),
    jobs_per_company: opt(int(1, 15)),
    companies: opt(list(slug)),
    locations: opt(list(slug)),
    job_families: opt(list(slug)),
    levels: opt(
      list(z.enum(["internship", "entry", "mid_staff", "principal", "manager", "director", "executive"])),
    ),
    employment_types: opt(
      list(z.enum(["full_time", "part_time", "contract", "temporary", "internship", "volunteer", "other"])),
    ),
    work_arrangements: opt(list(z.enum(["remote", "office", "hybrid"]))),
    min_base_compensation: opt(int(0)),
    min_total_compensation: opt(int(0)),
    company_types: opt(
      list(z.enum(["private", "public", "nonprofit", "government", "education", "delisted"])),
    ),
    company_sizes: opt(list(z.enum(["seed", "early", "mid", "large", "enterprise"]))),
    company_valuations: opt(
      list(
        z
          .tuple([int(0), int(0)])
          .refine(([low, high]) => high >= low, "company valuation ranges must be ordered"),
      ),
    ),
    perk_ids: opt(list(int(1))),
    posted_within: opt(int(1)),
    posted_within_unit: opt(z.enum(["days", "weeks", "months"])),
  },
  [atMostOne("company", "companies"), atMostOne("location", "locations")],
);

const bingMarket = {
  mkt: opt(string(undefined, undefined, /^[a-zA-Z]{2}-[a-zA-Z]{2}$/)),
  cc: opt(string(undefined, undefined, /^[a-zA-Z]{2}$/)),
};
const safeSearch = z.enum(["off", "moderate", "strict"]);
export const BingImages = defineRequest(
  "bing_images",
  "/api/bing/images",
  {
    ...base,
    ...bingMarket,
    q: string(1, 2048),
    first: opt(int(1, 10000)),
    count: opt(int(1, 100)),
    safeSearch: opt(safeSearch),
    imagesize: opt(z.enum(["small", "medium", "large", "wallpaper"])),
    photo: opt(z.enum(["photo", "clipart", "linedrawing", "animatedgif", "transparent"])),
    aspect: opt(z.enum(["square", "wide", "tall"])),
    color2: opt(
      z.enum([
        "color",
        "bw",
        "FGcls_RED",
        "FGcls_ORANGE",
        "FGcls_YELLOW",
        "FGcls_GREEN",
        "FGcls_TEAL",
        "FGcls_BLUE",
        "FGcls_PURPLE",
        "FGcls_PINK",
        "FGcls_BROWN",
        "FGcls_BLACK",
        "FGcls_GRAY",
        "FGcls_WHITE",
      ]),
    ),
    face: opt(z.enum(["face", "portrait"])),
    age: opt(z.enum(["lt1440", "lt10080", "lt43200", "lt525600"])),
    license: opt(
      z.enum([
        "L1",
        "L2",
        "L3",
        "L4",
        "L5",
        "L6",
        "L7",
        "L2_L3",
        "L2_L3_L4",
        "L2_L3_L5_L6",
        "L2_L3_L4_L5_L6_L7",
        "creativecommons",
      ]),
    ),
    qft: opt(string(undefined, 2048)),
  },
  [atMostOne("mkt", "cc")],
);
export const BingShopping = defineRequest(
  "bing_shopping",
  "/api/bing/shopping",
  {
    ...base,
    ...bingMarket,
    q: string(1, 2048),
    efirst: opt(int(0, Number.MAX_SAFE_INTEGER)),
    filters: opt(string(undefined, 6000)),
  },
  [atMostOne("mkt", "cc")],
);
export const BingProduct = defineRequest("bing_product", "/api/bing/product", {
  ...base,
  product_token: string(1, 24000),
});

const braveCountry = string(undefined, undefined, /^(?:[a-z]{2}|all)$/);
const braveLanguage = string(undefined, undefined, /^[a-z]{2}(?:-[a-z]{2})?$/);
export const BraveSearch = defineRequest("brave_search", "/api/brave/search", {
  ...base,
  q: string(1, 2048),
  offset: opt(int(0, 9)),
  country: opt(braveCountry),
  ui_lang: opt(braveLanguage),
  safesearch: opt(safeSearch),
  tf: opt(z.enum(["pd", "pw", "pm", "py"])),
  spellcheck: opt(boolean),
});
export const BraveAiMode = defineRequest(
  "brave_ai_mode",
  "/api/brave/ai-mode",
  {
    ...base,
    q: string(1, 2048),
    location: opt(string(1, 256)),
    lat: opt(decimal(-90, 90)),
    lon: opt(decimal(-180, 180)),
    country: opt(braveCountry),
    language: opt(braveLanguage),
    safeSearch: opt(safeSearch),
    units_of_measurement: opt(z.enum(["us", "metric"])),
    continuation_token: opt(string(1, 4096, /^ct2_[A-Za-z0-9_-]{100,}$/)),
  },
  [paired("lat", "lon")],
);
export const BaiduSearch = defineRequest("baidu_search", "/api/baidu/search", {
  ...base,
  q: string(1, 500),
  pn: opt(int(0, 750)),
  rn: opt(choice(10, 20, 50)),
});
const yandex = {
  ...base,
  yandex_domain: opt(
    z.enum(["yandex.com", "yandex.ru", "yandex.by", "yandex.kz", "yandex.uz", "yandex.com.tr"]),
  ),
  family_mode: opt(choice(0, 1, 2)),
  p: opt(int(0)),
};
export const YandexSearch = defineRequest("yandex_search", "/api/yandex/search", {
  ...yandex,
  text: string(1, 400),
  lang: opt(text),
  lr: opt(int(0)),
  fix_typo: opt(boolean),
  groups_on_page: opt(int(1)),
  sort_mode: opt(z.enum(["relevance", "date"])),
  period: opt(z.enum(["all", "day", "last_two_weeks", "month"])),
});
export const YandexImages = defineRequest(
  "yandex_images",
  "/api/yandex/images",
  {
    ...yandex,
    text: opt(string(1)),
    width: opt(int(1)),
    height: opt(int(1)),
    file_type: opt(z.enum(["jpg", "png", "gifan"])),
    color: opt(
      z.enum([
        "color",
        "gray",
        "red",
        "orange",
        "yellow",
        "cyan",
        "green",
        "blue",
        "violet",
        "white",
        "black",
      ]),
    ),
    orientation: opt(z.enum(["horizontal", "vertical", "square"])),
    image_type: opt(z.enum(["photo", "clipart", "lineart", "demotivator", "face"])),
    site: opt(text),
    recent: opt(boolean),
    url: opt(text),
    crop: opt(text),
    crop_id: opt(text),
    tab: opt(z.enum(["about", "similar"])),
  },
  [
    requireAny("text", "url"),
    paired("width", "height"),
    atMostOne("crop", "crop_id"),
    requires("crop", "url"),
    requires("crop_id", "url"),
    requires("tab", "url"),
  ],
);
const naverInteger = /^[0-9]+$/;
export const NaverSearch = defineRequest(
  "naver_search",
  "/api/naver/search",
  {
    ...base,
    query: string(1, 4096),
    start: opt(int(0)),
    page: opt(int(1)),
    num: opt(int(1, 100)),
    where: opt(z.enum(["nexearch", "web", "video", "news", "image"])),
    sort_by: opt(text.pipe(z.enum(["r", "dd", "0", "1", "2"]))),
    period: opt(text),
  },
  [
    (p, c) => {
      const where = p.where ?? "nexearch";
      if (has(p, "num") && where !== "image") issue(c, "num is only supported for image search");
      const sorts = where === "news" ? ["0", "1", "2"] : ["r", "dd"];
      if (has(p, "sort_by") && !sorts.includes(p.sort_by as string))
        issue(c, "sort_by must be 0, 1, or 2 for news, or r or dd for other searches");
      for (const name of ["start", "page", "num"])
        if (has(p, name) && !naverInteger.test(String(p[name]))) issue(c, `${name} must be an integer`);
    },
  ],
);
export const NaverAiOverview = defineRequest(
  "naver_ai_overview",
  "/api/naver/ai-overview",
  { ...base, query: opt(string(1, 4096)), page_token: opt(string(1, 2048)) },
  [exactlyOne("query", "page_token")],
);
const yahoo = {
  ...base,
  p: string(1, 2000),
  yahoo_domain: opt(text),
  b: opt(int(1, 10001)),
  device: opt(device),
};
export const YahooSearch = defineRequest("yahoo_search", "/api/yahoo/search", {
  ...yahoo,
  vc: opt(string(undefined, undefined, /^[a-z]{2}$/)),
  vl: opt(string(undefined, undefined, /^lang_(?:[a-z]{2}|zh_chs|zh_cht)$/)),
  vm: opt(z.enum(["r", "i", "p"])),
  vs: opt(string(undefined, 500)),
  vf: opt(string(undefined, 80)),
  fr2: opt(string(undefined, 1000)),
  d: opt(string(undefined, 4096)),
});
export const YahooImages = defineRequest("yahoo_images", "/api/yahoo/images", {
  ...yahoo,
  imgsz: opt(z.enum(["small", "medium", "large", "wallpaper"])),
  imgc: opt(
    z.enum([
      "color",
      "bw",
      "red",
      "orange",
      "yellow",
      "green",
      "teal",
      "blue",
      "purple",
      "pink",
      "brown",
      "black",
      "gray",
      "white",
    ]),
  ),
  imgty: opt(z.enum(["photo", "clipart", "linedrawing", "gif", "transparent"])),
  imga: opt(z.enum(["square", "wide", "tall"])),
  imgf: opt(z.enum(["face", "portrait", "nonportrait"])),
  imgt: opt(z.enum(["day", "week", "month", "year"])),
  imgl: opt(z.enum(["cc", "pd", "fsu", "fsuc", "fmsu", "fmsuc"])),
});
export const YelpPlace = defineRequest(
  "yelp_place",
  "/api/yelp/place",
  {
    ...base,
    place_id: string(1, 128, /^[A-Za-z0-9_-]+$/),
    yelp_domain: opt(text),
    business_alert: opt(boolean),
    full_menu: opt(boolean),
    menu_name: opt(string(undefined, 200)),
  },
  [
    (p, c) => {
      if (p.menu_name && !p.full_menu) issue(c, "menu_name requires full_menu=true");
    },
  ],
);
export const AirbnbSearch = defineRequest(
  "airbnb_search",
  "/api/airbnb/search",
  {
    ...base,
    q: opt(string(undefined, 500)),
    map_bounds: opt(text),
    airbnb_domain: opt(text),
    currency: opt(text),
    check_in_date: opt(isoDate),
    check_out_date: opt(isoDate),
    adults: opt(int(0)),
    children: opt(int(0)),
    infants: opt(int(0)),
    pets: opt(int(0)),
    room_type: opt(z.enum(["entire_home", "private_room"])),
    min_price: opt(decimal(0)),
    max_price: opt(decimal(0)),
    bedrooms: opt(int(0)),
    beds: opt(int(0)),
    bathrooms: opt(decimal(0)),
    property_types: opt(text),
    amenities: opt(text),
    accessibility_features: opt(text),
    host_languages: opt(text),
    instant_book: opt(boolean),
    self_check_in: opt(boolean),
    guest_favorite: opt(boolean),
    luxe: opt(boolean),
    page: opt(int(1, 15)),
  },
  [
    (p, c) => {
      if (!(typeof p.q === "string" && p.q.trim()) && !p.map_bounds)
        issue(c, "one of q, map_bounds is required");
      if (
        has(p, "check_in_date") &&
        has(p, "check_out_date") &&
        (p.check_out_date as string) <= (p.check_in_date as string)
      )
        issue(c, "check_out_date must be later than check_in_date");
    },
    paired("check_in_date", "check_out_date"),
    ordered("min_price", "max_price"),
  ],
);

const youtubeLocale = {
  hl: opt(string(undefined, undefined, /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,2}$/)),
  gl: opt(string(undefined, undefined, /^[A-Za-z]{2}$/)),
};
const youtubeToken = string(1, 32768, /^ct2_[A-Za-z0-9_-]{100,}$/);
export const YouTubeSearch = defineRequest(
  "youtube_search",
  "/api/youtube/search",
  {
    ...base,
    ...youtubeLocale,
    q: opt(string(1, 2048)),
    type: opt(z.enum(["video", "shorts", "channel", "playlist", "movie"])),
    upload_date: opt(z.enum(["today", "this_week", "this_month", "this_year"])),
    duration: opt(z.enum(["under_3_min", "between_3_and_20_min", "over_20_min"])),
    features: opt(string(1, 160)),
    sort_by: opt(z.enum(["relevance", "popularity"])),
    sp: opt(string(1, 2048, /^[a-zA-Z0-9_+/=%-]+$/)),
    page_token: opt(youtubeToken),
  },
  [
    alone("page_token"),
    requireAny("q", "page_token"),
    (p, c) => {
      const named = ["type", "upload_date", "duration", "features", "sort_by"].filter((f) => has(p, f));
      if (has(p, "sp") && named.length) issue(c, `sp cannot be combined with ${named.join(", ")}`);
      if (
        ["channel", "playlist"].includes(p.type as string) &&
        named.some((f) => f !== "type" && f !== "sort_by")
      )
        issue(c, "channel and playlist searches cannot use upload_date, duration or features");
      if (p.type === "shorts" && has(p, "duration")) issue(c, "shorts searches cannot use duration");
    },
  ],
);
export const YouTubeChannel = defineRequest(
  "youtube_channel",
  "/api/youtube/channel",
  {
    ...base,
    ...youtubeLocale,
    channel_id: opt(string(1, 100)),
    tab: opt(z.enum(["videos", "shorts", "streams", "podcasts", "playlists", "posts"])),
    sort: opt(z.enum(["latest", "popular", "oldest", "dd", "lad"])),
    search_query: opt(string(1, 2048)),
    about: opt(boolean),
    next_page_token: opt(youtubeToken),
  },
  [
    alone("next_page_token"),
    requireAny("channel_id", "next_page_token"),
    (p, c) => {
      if (has(p, "search_query") && (has(p, "tab") || has(p, "sort")))
        issue(c, "use search_query without tab or sort");
      if (has(p, "sort")) {
        const tab = (p.tab as string | undefined) ?? "videos";
        const allowed = tab === "playlists" ? ["dd", "lad"] : ["latest", "popular", "oldest"];
        if (["podcasts", "posts"].includes(tab) || !allowed.includes(p.sort as string))
          issue(c, "sort is not available for the selected channel tab");
      }
    },
  ],
);

const instagramHandle = string(undefined, undefined, /^[A-Za-z0-9_.]{1,30}$/);
export const InstagramSearchPopular = defineRequest(
  "instagram_search_popular",
  "/api/instagram/search-popular",
  { ...base, query: string(1, 200), cursor: opt(string(1, 8192)) },
);
export const InstagramProfile = defineRequest("instagram_profile", "/api/instagram/profile", {
  ...base,
  handle: instagramHandle,
  trim: opt(boolean),
});
export const InstagramPosts = defineRequest("instagram_posts", "/api/instagram/posts", {
  ...base,
  handle: instagramHandle,
  trim: opt(boolean),
  next_max_id: opt(string(1, 8192)),
  num: opt(int(1, 50)),
});
export const InstagramPost = defineRequest("instagram_post", "/api/instagram/post", {
  ...base,
  url: text,
  trim: opt(boolean),
});
export const InstagramProfilePostCount = defineRequest(
  "instagram_profile_post_count",
  "/api/instagram/profile-post-count",
  { ...base, handle: instagramHandle },
);
export const InstagramEmbed = defineRequest("instagram_embed", "/api/instagram/embed", {
  ...base,
  handle: instagramHandle,
});

// Pass large TikTok IDs as strings or bigints; JavaScript numbers lose precision past 2^53.
const tiktokId = string(undefined, undefined, /^[0-9]{1,25}$/);
const tiktokHandle = string(undefined, undefined, /^@?[A-Za-z0-9_.]{1,24}$/);
const tiktokPage = { ...base, cursor: opt(tiktokId), count: opt(int(1, 35)) };
const tiktokUser = { handle: opt(tiktokHandle), user_id: opt(tiktokId) };
const tiktokPost = { url: opt(string(undefined, 2048)), video_id: opt(tiktokId) };
const tiktokSearch = {
  query: string(1, 500),
  search_id: opt(string(undefined, undefined, /^[A-Za-z0-9_-]{1,128}$/)),
};
const oneUser = [exactlyOne("handle", "user_id")];
const onePost = [exactlyOne("url", "video_id")];
export const TikTokProfile = defineRequest(
  "tiktok_profile",
  "/api/tiktok/profile",
  { ...base, ...tiktokUser },
  oneUser,
);
export const TikTokVideo = defineRequest(
  "tiktok_video",
  "/api/tiktok/video",
  { ...base, ...tiktokPost },
  onePost,
);
export const TikTokTranscript = defineRequest(
  "tiktok_transcript",
  "/api/tiktok/transcript",
  {
    ...base,
    ...tiktokPost,
    language: opt(string(undefined, undefined, /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)),
  },
  onePost,
);
export const TikTokSearchSuggestions = defineRequest(
  "tiktok_search_suggestions",
  "/api/tiktok/search-suggestions",
  { ...base, query: string(1, 500) },
);
export const TikTokUserLive = defineRequest("tiktok_user_live", "/api/tiktok/user-live", {
  ...base,
  handle: tiktokHandle,
});
export const TikTokLive = defineRequest("tiktok_live", "/api/tiktok/live", { ...base, room_id: tiktokId });
export const TikTokSong = defineRequest("tiktok_song", "/api/tiktok/song", { ...base, clip_id: tiktokId });
export const TikTokProfileVideos = defineRequest(
  "tiktok_profile_videos",
  "/api/tiktok/profile-videos",
  { ...tiktokPage, ...tiktokUser },
  oneUser,
);
export const TikTokComments = defineRequest(
  "tiktok_comments",
  "/api/tiktok/comments",
  { ...tiktokPage, ...tiktokPost },
  onePost,
);
export const TikTokCommentReplies = defineRequest(
  "tiktok_comment_replies",
  "/api/tiktok/comment-replies",
  { ...tiktokPage, ...tiktokPost, comment_id: tiktokId },
  onePost,
);
export const TikTokFollowing = defineRequest(
  "tiktok_following",
  "/api/tiktok/following",
  { ...tiktokPage, ...tiktokUser },
  oneUser,
);
export const TikTokFollowers = defineRequest(
  "tiktok_followers",
  "/api/tiktok/followers",
  { ...tiktokPage, ...tiktokUser },
  oneUser,
);
export const TikTokSearchKeyword = defineRequest("tiktok_search_keyword", "/api/tiktok/search-keyword", {
  ...tiktokPage,
  ...tiktokSearch,
});
export const TikTokSearchTop = defineRequest("tiktok_search_top", "/api/tiktok/search-top", {
  ...tiktokPage,
  ...tiktokSearch,
});
export const TikTokSearchHashtag = defineRequest("tiktok_search_hashtag", "/api/tiktok/search-hashtag", {
  ...tiktokPage,
  hashtag: string(1, 100, /^#?[^\s#/&?=]+$/),
});
export const TikTokSongVideos = defineRequest("tiktok_song_videos", "/api/tiktok/song-videos", {
  ...tiktokPage,
  clip_id: tiktokId,
});
export const TikTokTrendingFeed = defineRequest("tiktok_trending_feed", "/api/tiktok/trending-feed", {
  ...base,
  count: opt(int(1, 35)),
});
export const TikTokCollectionVideos = defineRequest(
  "tiktok_collection_videos",
  "/api/tiktok/collection-videos",
  { ...tiktokPage, url: opt(string(undefined, 2048)), collection_id: opt(tiktokId) },
  [exactlyOne("url", "collection_id")],
);

const asin = string(undefined, undefined, /^[A-Z0-9]{10}$/);
const amazonText = string(1, 4096);
const amazonLocale = {
  ...base,
  amazon_domain: opt(text),
  language: opt(string(undefined, undefined, /^[a-z]{2}_[A-Z]{2}$/)),
  delivery_zip: opt(string(1, 32)),
  shipping_location: opt(string(undefined, undefined, /^[A-Z]{2}$/)),
};
export const AmazonSearch = defineRequest(
  "amazon_search",
  "/api/amazon/search",
  {
    ...amazonLocale,
    k: opt(amazonText),
    node: opt(string(undefined, undefined, /^[0-9]+$/)),
    s: opt(
      z.enum([
        "relevanceblender",
        "price-asc-rank",
        "price-desc-rank",
        "review-rank",
        "date-desc-rank",
        "exact-aware-popularity-rank",
      ]),
    ),
    rh: opt(string(undefined, 4096)),
    dc: opt(boolean),
    page: opt(int(1)),
  },
  [exactlyOne("k", "node")],
);
export const AmazonProduct = defineRequest("amazon_product", "/api/amazon/product", {
  ...amazonLocale,
  asin,
  other_sellers: opt(boolean),
  all_related_products: opt(boolean),
});
export const AmazonAutocomplete = defineRequest("amazon_autocomplete", "/api/amazon/autocomplete", {
  ...base,
  amazon_domain: opt(text),
  k: amazonText,
  amazon_department: opt(string(1, 4096, /^[a-zA-Z0-9_-]+$/)),
});
const reviewDomain = z.enum([
  "amazon.ae",
  "amazon.ca",
  "amazon.co.jp",
  "amazon.co.uk",
  "amazon.co.za",
  "amazon.com",
  "amazon.com.au",
  "amazon.com.be",
  "amazon.com.br",
  "amazon.com.mx",
  "amazon.com.tr",
  "amazon.de",
  "amazon.eg",
  "amazon.es",
  "amazon.fr",
  "amazon.ie",
  "amazon.in",
  "amazon.it",
  "amazon.nl",
  "amazon.pl",
  "amazon.sa",
  "amazon.se",
  "amazon.sg",
]);
export const AmazonFeaturedReviews = defineRequest(
  "amazon_featured_reviews",
  "/api/amazon/featured-reviews",
  { ...base, asin, amazon_domain: opt(reviewDomain) },
);
export const AmazonMediaReviews = defineRequest(
  "amazon_media_reviews",
  "/api/amazon/media-reviews",
  {
    ...base,
    asin: opt(asin),
    amazon_domain: opt(reviewDomain),
    view: opt(z.enum(["media", "images", "videos"])),
    page_token: opt(string(5, 8196, /^ar1\.[A-Za-z0-9_-]+$/)),
  },
  [alone("page_token"), requireAny("asin", "page_token")],
);

const upperCode = string(undefined, undefined, /^[A-Za-z]{2}$/).transform((value) => value.toUpperCase());
export const CopilotChatCompletions = defineRequest(
  "copilot_chat_completions",
  "/api/copilot/chat/completions",
  {
    ...base,
    messages: list(
      z.strictObject({
        role: z.enum(["system", "user", "assistant"]),
        content: z
          .string()
          .min(1)
          .max(32000)
          .refine((value) => value.trim().length > 0, "message content must not be blank"),
      }),
      1,
      32,
    ),
    model: opt(z.literal("copilot")),
    stream: opt(z.literal(false)),
    country: opt(upperCode),
    state: opt(upperCode),
  },
  [
    (p, c) => {
      const messages = p.messages as Array<{ role: string; content: string }>;
      if (messages.at(-1)?.role !== "user") issue(c, "the final message must have role user");
      if (messages.reduce((total, message) => total + message.content.length, 0) > 32000)
        issue(c, "total message content exceeds 32,000 characters");
      if (has(p, "state") && p.country !== "US") issue(c, "state requires country=US");
    },
  ],
  "POST",
);

const ebayDomain = z.enum([
  "ebay.com",
  "ebay.co.uk",
  "ebay.ca",
  "ebay.com.au",
  "ebay.de",
  "ebay.fr",
  "ebay.it",
  "ebay.es",
  "ebay.at",
  "ebay.be",
  "ebay.ch",
  "ebay.ie",
  "ebay.nl",
  "ebay.com.hk",
  "ebay.com.my",
  "ebay.pl",
  "ebay.com.sg",
]);
const ebayPage = int(1, 2 ** 31 - 1);
export const EbaySearch = defineRequest(
  "ebay_search",
  "/api/ebay/search",
  {
    ...base,
    ebay_domain: opt(ebayDomain),
    _nkw: opt(string(1, 500)),
    category_id: opt(int(1, 2 ** 31 - 1)),
    _pgn: opt(ebayPage),
    _ipg: opt(choice(25, 50, 100, 200)),
    _sop: opt(choice(1, 2, 3, 7, 10, 12, 15, 16, 18, 19)),
    _udlo: opt(decimal(0)),
    _udhi: opt(decimal(0)),
    buying_format: opt(z.enum(["Auction", "BIN", "BO"])),
    LH_ItemCondition: opt(string(undefined, undefined, /^[0-9]{1,4}(\|[0-9]{1,4}){0,9}$/)),
    _stpos: opt(string(1, 20)),
    _salic: opt(integer),
    _blrs: opt(z.literal("spell_auto_correct")),
    show_only: opt(string(undefined, 100)),
    _sasl: opt(string(undefined, 1000)),
    _saslop: opt(choice(1, 2)),
    popular_filters: opt(string(undefined, 4000)),
    _dmd: opt(z.enum(["Grid", "List"])),
    LH_PrefLoc: opt(z.enum(["Domestic", "Regional", "Worldwide"])),
  },
  [
    requireAny("_nkw", "category_id"),
    ordered("_udlo", "_udhi"),
    (p, c) => {
      const domain = (p.ebay_domain as string | undefined) ?? "ebay.com";
      if ([2, 3].includes(p._sop as number) && domain === "ebay.com")
        issue(c, "_sop 2 and 3 are unavailable on ebay.com");
      const noBest = [
        "ebay.ca",
        "ebay.de",
        "ebay.com.my",
        "ebay.nl",
        "ebay.com.sg",
        "ebay.co.uk",
        "ebay.com",
      ];
      if ([18, 19].includes(p._sop as number) && noBest.includes(domain))
        issue(c, "_sop 18 and 19 are unavailable on this marketplace");
    },
  ],
);
export const EbayProduct = defineRequest(
  "ebay_product",
  "/api/ebay/product",
  {
    ...base,
    ebay_domain: opt(ebayDomain),
    product_id: string(undefined, undefined, /^[0-9]{12}$/),
    locale: opt(text),
    lang: opt(string(undefined, 12, /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/)),
    shipping_country: opt(text),
  },
  [
    (p, c) => {
      if (has(p, "lang") && (!p.locale || (p.ebay_domain ?? "ebay.com") !== "ebay.com"))
        issue(c, "lang requires locale and ebay_domain=ebay.com");
    },
  ],
);
export const EbaySeller = defineRequest("ebay_seller", "/api/ebay/seller", {
  ...base,
  ebay_domain: opt(ebayDomain),
  seller_id: string(undefined, undefined, /^[A-Za-z0-9][A-Za-z0-9_.*-]{0,99}$/),
  type: z.enum(["user", "store"]),
  _pgn: opt(ebayPage),
  _ipg: opt(choice(24, 48, 72)),
  _sop: opt(choice(1, 7, 10, 12, 15, 16)),
  buying_format: opt(choice(0, 1, 2)),
  LH_ItemCondition: opt(string(undefined, 20, /^(?:3|4|10)(?:\|(?:3|4|10))*$/)),
  free_shipping: opt(boolean),
});

const xId = string(undefined, undefined, /^[1-9][0-9]{0,19}$/);
const xUsername = string(undefined, undefined, /^[A-Za-z0-9_]{1,15}$/);
export const XProfile = defineRequest("x_profile", "/api/x/profile", { ...base, username: xUsername });
export const XPost = defineRequest("x_post", "/api/x/post", { ...base, post_id: xId });
export const XUserPosts = defineRequest("x_user_posts", "/api/x/user-posts", {
  ...base,
  username: xUsername,
  cursor: opt(string(1, 4096, /^[A-Za-z0-9_+/=-]+$/)),
});
export const XCommunityPosts = defineRequest("x_community_posts", "/api/x/community-posts", {
  ...base,
  community_id: xId,
});
export const XCommunity = defineRequest("x_community", "/api/x/community", { ...base, community_id: xId });

export const EventbriteSearch = defineRequest("eventbrite_search", "/api/eventbrite/search", {
  ...base,
  location: opt(string(undefined, 150, /^[a-z0-9]+(?:-[a-z0-9]+|--[a-z0-9]+)*$/)),
  q: opt(string(1, 200, /^\S+(?: \S+)*$/)),
  page: opt(int(1, 100)),
});

// Retailers share one search contract and one product-URL contract.
const retailSearch = (lastPage = 100) => ({ ...base, query: string(1, 500), page: opt(int(1, lastPage)) });
const retailProduct = { ...base, url: string(1, 4096) };
const storeId = { store_id: opt(string(1, 8, /^[0-9]{1,8}$/)) };
export const WalmartSearch = defineRequest("walmart_search", "/api/walmart/search", retailSearch());
export const WalmartProduct = defineRequest("walmart_product", "/api/walmart/product", retailProduct);
export const HomeDepotSearch = defineRequest("homedepot_search", "/api/homedepot/search", retailSearch(1));
export const HomeDepotProduct = defineRequest("homedepot_product", "/api/homedepot/product", retailProduct);
export const TargetSearch = defineRequest("target_search", "/api/target/search", {
  ...retailSearch(),
  ...storeId,
});
export const TargetProduct = defineRequest("target_product", "/api/target/product", {
  ...retailProduct,
  ...storeId,
});
export const EtsySearch = defineRequest("etsy_search", "/api/etsy/search", retailSearch());
export const EtsyProduct = defineRequest("etsy_product", "/api/etsy/product", retailProduct);
export const BestBuySearch = defineRequest("bestbuy_search", "/api/bestbuy/search", {
  ...retailSearch(),
  ...storeId,
});
export const BestBuyProduct = defineRequest("bestbuy_product", "/api/bestbuy/product", {
  ...retailProduct,
  ...storeId,
});
export const WayfairSearch = defineRequest("wayfair_search", "/api/wayfair/search", retailSearch());
export const WayfairProduct = defineRequest("wayfair_product", "/api/wayfair/product", retailProduct);
export const AliExpressSearch = defineRequest("aliexpress_search", "/api/aliexpress/search", retailSearch());
export const AliExpressProduct = defineRequest(
  "aliexpress_product",
  "/api/aliexpress/product",
  retailProduct,
);
export const KrogerSearch = defineRequest("kroger_search", "/api/kroger/search", {
  ...retailSearch(1),
  ...storeId,
});
export const KrogerProduct = defineRequest("kroger_product", "/api/kroger/product", {
  ...retailProduct,
  ...storeId,
});
export const SproutsSearch = defineRequest("sprouts_search", "/api/sprouts/search", {
  ...retailSearch(),
  ...storeId,
});
export const SproutsProduct = defineRequest("sprouts_product", "/api/sprouts/product", {
  ...retailProduct,
  ...storeId,
});
export const WholeFoodsSearch = defineRequest("wholefoods_search", "/api/wholefoods/search", {
  ...retailSearch(),
  ...storeId,
});
export const WholeFoodsProduct = defineRequest("wholefoods_product", "/api/wholefoods/product", {
  ...retailProduct,
  ...storeId,
});
export const IkeaSearch = defineRequest("ikea_search", "/api/ikea/search", { ...retailSearch(), ...storeId });
export const IkeaProduct = defineRequest("ikea_product", "/api/ikea/product", {
  ...retailProduct,
  ...storeId,
});

const listingUrl = { ...base, url: string(undefined, 4096) };
const propertyUrl = { ...base, url: string(undefined, 2048) };
const homeRanges = {
  min_price: opt(int(0)),
  max_price: opt(int(0)),
  min_beds: opt(int(0, 20)),
  max_beds: opt(int(0, 20)),
  min_baths: opt(decimal(0, 20)),
  min_sqft: opt(int(0)),
  max_sqft: opt(int(0)),
};
const rangeRules = [
  ordered("min_price", "max_price"),
  ordered("min_beds", "max_beds"),
  ordered("min_sqft", "max_sqft"),
];
export const ZillowSearch = defineRequest(
  "zillow_search",
  "/api/zillow/search",
  {
    ...base,
    ...homeRanges,
    q: opt(string(1, 200)),
    map_bounds: opt(text),
    status: opt(z.enum(["for_sale", "for_rent", "sold"])),
    property_type: opt(
      z.enum(["house", "condo", "townhouse", "multi_family", "land", "manufactured", "apartment"]),
    ),
    sort: opt(z.enum(["recommended", "newest", "price_asc", "price_desc", "beds", "sqft"])),
    page: opt(int(1, 20)),
  },
  [exactlyOne("q", "map_bounds"), ...rangeRules],
);
export const ZillowProperty = defineRequest(
  "zillow_property",
  "/api/zillow/property",
  { ...base, zpid: opt(int(1)), url: opt(string(undefined, 2048)) },
  [exactlyOne("zpid", "url")],
);
export const ZillowLocations = defineRequest(
  "zillow_locations",
  "/api/zillow/locations",
  {
    ...base,
    q: opt(string(1, 200)),
    type: opt(z.enum(["regions", "addresses"])),
    limit: opt(int(1, 100)),
    page_token: opt(string(1, 32768)),
  },
  [alone("page_token"), requireAny("q", "page_token")],
);
export const RedfinSearch = defineRequest(
  "redfin_search",
  "/api/redfin/search",
  {
    ...base,
    ...homeRanges,
    url: opt(string(undefined, 2048)),
    region_id: opt(int(1)),
    region_type: opt(choice(1, 2, 5, 6, 11)),
    map_bounds: opt(text),
    status: opt(z.enum(["for_sale", "sold"])),
    sold_within_days: opt(int(1, 365)),
    property_type: opt(
      z.enum(["house", "condo", "townhouse", "multi_family", "land", "other", "manufactured", "co_op"]),
    ),
    sort: opt(z.enum(["recommended", "newest", "price_asc", "price_desc", "sqft"])),
    limit: opt(int(1, 350)),
  },
  [
    paired("region_id", "region_type"),
    exactlyOne("url", "region_id", "map_bounds"),
    (p, c) => {
      if (has(p, "sold_within_days") && p.status !== "sold")
        issue(c, "sold_within_days requires status=sold");
    },
    ...rangeRules,
  ],
);
export const RedfinProperty = defineRequest("redfin_property", "/api/redfin/property", propertyUrl);
export const RealtorSearch = defineRequest("realtor_search", "/api/realtor/search", {
  ...listingUrl,
  limit: opt(int(1, 200)),
});
export const RealtorProperty = defineRequest("realtor_property", "/api/realtor/property", propertyUrl);
export const ApartmentsSearch = defineRequest("apartments_search", "/api/apartments/search", listingUrl);
export const ApartmentsProperty = defineRequest(
  "apartments_property",
  "/api/apartments/property",
  propertyUrl,
);
export const HomesSearch = defineRequest("homes_search", "/api/homes/search", listingUrl);
export const HomesProperty = defineRequest("homes_property", "/api/homes/property", propertyUrl);

const facebookQuery = string(1, 200, /^\S(?:.*\S)?$/);
const facebookName = string(undefined, undefined, /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
export const FacebookSearchPages = defineRequest("facebook_search_pages", "/api/facebook/search-pages", {
  ...base,
  query: facebookQuery,
  limit: opt(int(1, 15)),
  country: opt(string(undefined, undefined, /^[A-Z]{2}$/)),
  ad_type: opt(z.enum(["ALL", "POLITICAL_AND_ISSUE_ADS"])),
});
export const FacebookSearchProfiles = defineRequest(
  "facebook_search_profiles",
  "/api/facebook/search-profiles",
  { ...base, query: facebookQuery, limit: opt(int(1, 12)) },
);
export const FacebookHashtagPosts = defineRequest("facebook_hashtag_posts", "/api/facebook/hashtag-posts", {
  ...base,
  tag: string(undefined, undefined, /^#?[A-Za-z0-9_]{1,100}$/),
  limit: opt(int(1, 20)),
  continuation_token: opt(string(1, 32768)),
});
export const FacebookPost = defineRequest("facebook_post", "/api/facebook/post", {
  ...base,
  url: string(
    undefined,
    400,
    /^https:\/\/www\.facebook\.com\/[A-Za-z0-9][A-Za-z0-9._-]*\/posts\/(?:[0-9]+|pfbid[A-Za-z0-9]+)\/?$/,
  ),
});
export const FacebookPagePosts = defineRequest("facebook_page_posts", "/api/facebook/page-posts", {
  ...base,
  handle: facebookName,
});
export const FacebookMarketplaceBrowse = defineRequest(
  "facebook_marketplace_browse",
  "/api/facebook/marketplace-browse",
  {
    ...base,
    limit: opt(int(1, 26)),
    location: opt(facebookName),
    query: opt(facebookQuery),
    radius_km: opt(int(1, 500)),
    min_price: opt(decimal(0, 10_000_000)),
    max_price: opt(decimal(0, 10_000_000)),
    sort_by: opt(z.enum(["price_ascend", "price_descend", "creation_time_descend"])),
    condition: opt(z.enum(["new", "used_like_new", "used_good", "used_fair"])),
    days_since_listed: opt(int(1, 30)),
    continuation_token: opt(string(1, 32768, /^m1\.[A-Za-z0-9_-]+$/)),
  },
  [
    requires("query", "location"),
    requires("radius_km", "location"),
    ...["min_price", "max_price", "sort_by", "condition", "days_since_listed", "continuation_token"].map(
      (f) => requires(f, "query"),
    ),
    ordered("min_price", "max_price"),
  ],
);
export const FacebookReel = defineRequest("facebook_reel", "/api/facebook/reel", {
  ...base,
  url: string(undefined, 150, /^https:\/\/www\.facebook\.com\/reel\/[0-9]{1,30}\/?$/),
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
  web_fetch: WebFetch,
  web_screenshot: WebScreenshot,
  google_images: GoogleImages,
  google_gemini: GoogleGemini,
  google_shopping_merchant_urls: GoogleShoppingMerchantUrls,
  google_jobs: GoogleJobs,
  indeed_search: IndeedSearch,
  glassdoor_search: GlassdoorSearch,
  ashby_search: AshbySearch,
  ziprecruiter_search: ZipRecruiterSearch,
  levels_search: LevelsSearch,
  bing_images: BingImages,
  bing_shopping: BingShopping,
  bing_product: BingProduct,
  brave_search: BraveSearch,
  brave_ai_mode: BraveAiMode,
  baidu_search: BaiduSearch,
  yandex_search: YandexSearch,
  yandex_images: YandexImages,
  naver_search: NaverSearch,
  naver_ai_overview: NaverAiOverview,
  yahoo_search: YahooSearch,
  yahoo_images: YahooImages,
  yelp_place: YelpPlace,
  airbnb_search: AirbnbSearch,
  youtube_search: YouTubeSearch,
  youtube_channel: YouTubeChannel,
  instagram_search_popular: InstagramSearchPopular,
  instagram_profile: InstagramProfile,
  instagram_posts: InstagramPosts,
  instagram_post: InstagramPost,
  instagram_profile_post_count: InstagramProfilePostCount,
  instagram_embed: InstagramEmbed,
  tiktok_profile: TikTokProfile,
  tiktok_video: TikTokVideo,
  tiktok_transcript: TikTokTranscript,
  tiktok_search_suggestions: TikTokSearchSuggestions,
  tiktok_user_live: TikTokUserLive,
  tiktok_live: TikTokLive,
  tiktok_song: TikTokSong,
  tiktok_profile_videos: TikTokProfileVideos,
  tiktok_comments: TikTokComments,
  tiktok_comment_replies: TikTokCommentReplies,
  tiktok_following: TikTokFollowing,
  tiktok_followers: TikTokFollowers,
  tiktok_search_keyword: TikTokSearchKeyword,
  tiktok_search_top: TikTokSearchTop,
  tiktok_search_hashtag: TikTokSearchHashtag,
  tiktok_song_videos: TikTokSongVideos,
  tiktok_trending_feed: TikTokTrendingFeed,
  tiktok_collection_videos: TikTokCollectionVideos,
  amazon_search: AmazonSearch,
  amazon_product: AmazonProduct,
  amazon_autocomplete: AmazonAutocomplete,
  amazon_featured_reviews: AmazonFeaturedReviews,
  amazon_media_reviews: AmazonMediaReviews,
  copilot_chat_completions: CopilotChatCompletions,
  ebay_search: EbaySearch,
  ebay_product: EbayProduct,
  ebay_seller: EbaySeller,
  x_profile: XProfile,
  x_post: XPost,
  x_user_posts: XUserPosts,
  x_community_posts: XCommunityPosts,
  x_community: XCommunity,
  eventbrite_search: EventbriteSearch,
  walmart_search: WalmartSearch,
  walmart_product: WalmartProduct,
  homedepot_search: HomeDepotSearch,
  homedepot_product: HomeDepotProduct,
  target_search: TargetSearch,
  target_product: TargetProduct,
  etsy_search: EtsySearch,
  etsy_product: EtsyProduct,
  bestbuy_search: BestBuySearch,
  bestbuy_product: BestBuyProduct,
  wayfair_search: WayfairSearch,
  wayfair_product: WayfairProduct,
  aliexpress_search: AliExpressSearch,
  aliexpress_product: AliExpressProduct,
  kroger_search: KrogerSearch,
  kroger_product: KrogerProduct,
  sprouts_search: SproutsSearch,
  sprouts_product: SproutsProduct,
  wholefoods_search: WholeFoodsSearch,
  wholefoods_product: WholeFoodsProduct,
  ikea_search: IkeaSearch,
  ikea_product: IkeaProduct,
  zillow_search: ZillowSearch,
  zillow_property: ZillowProperty,
  zillow_locations: ZillowLocations,
  redfin_search: RedfinSearch,
  redfin_property: RedfinProperty,
  realtor_search: RealtorSearch,
  realtor_property: RealtorProperty,
  apartments_search: ApartmentsSearch,
  apartments_property: ApartmentsProperty,
  homes_search: HomesSearch,
  homes_property: HomesProperty,
  facebook_search_pages: FacebookSearchPages,
  facebook_search_profiles: FacebookSearchProfiles,
  facebook_hashtag_posts: FacebookHashtagPosts,
  facebook_post: FacebookPost,
  facebook_page_posts: FacebookPagePosts,
  facebook_marketplace_browse: FacebookMarketplaceBrowse,
  facebook_reel: FacebookReel,
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
export type WebFetch = InstanceType<typeof WebFetch>;
export type WebScreenshot = InstanceType<typeof WebScreenshot>;
export type GoogleImages = InstanceType<typeof GoogleImages>;
export type GoogleGemini = InstanceType<typeof GoogleGemini>;
export type GoogleShoppingMerchantUrls = InstanceType<typeof GoogleShoppingMerchantUrls>;
export type GoogleJobs = InstanceType<typeof GoogleJobs>;
export type IndeedSearch = InstanceType<typeof IndeedSearch>;
export type GlassdoorSearch = InstanceType<typeof GlassdoorSearch>;
export type AshbySearch = InstanceType<typeof AshbySearch>;
export type ZipRecruiterSearch = InstanceType<typeof ZipRecruiterSearch>;
export type LevelsSearch = InstanceType<typeof LevelsSearch>;
export type BingImages = InstanceType<typeof BingImages>;
export type BingShopping = InstanceType<typeof BingShopping>;
export type BingProduct = InstanceType<typeof BingProduct>;
export type BraveSearch = InstanceType<typeof BraveSearch>;
export type BraveAiMode = InstanceType<typeof BraveAiMode>;
export type BaiduSearch = InstanceType<typeof BaiduSearch>;
export type YandexSearch = InstanceType<typeof YandexSearch>;
export type YandexImages = InstanceType<typeof YandexImages>;
export type NaverSearch = InstanceType<typeof NaverSearch>;
export type NaverAiOverview = InstanceType<typeof NaverAiOverview>;
export type YahooSearch = InstanceType<typeof YahooSearch>;
export type YahooImages = InstanceType<typeof YahooImages>;
export type YelpPlace = InstanceType<typeof YelpPlace>;
export type AirbnbSearch = InstanceType<typeof AirbnbSearch>;
export type YouTubeSearch = InstanceType<typeof YouTubeSearch>;
export type YouTubeChannel = InstanceType<typeof YouTubeChannel>;
export type InstagramSearchPopular = InstanceType<typeof InstagramSearchPopular>;
export type InstagramProfile = InstanceType<typeof InstagramProfile>;
export type InstagramPosts = InstanceType<typeof InstagramPosts>;
export type InstagramPost = InstanceType<typeof InstagramPost>;
export type InstagramProfilePostCount = InstanceType<typeof InstagramProfilePostCount>;
export type InstagramEmbed = InstanceType<typeof InstagramEmbed>;
export type TikTokProfile = InstanceType<typeof TikTokProfile>;
export type TikTokVideo = InstanceType<typeof TikTokVideo>;
export type TikTokTranscript = InstanceType<typeof TikTokTranscript>;
export type TikTokSearchSuggestions = InstanceType<typeof TikTokSearchSuggestions>;
export type TikTokUserLive = InstanceType<typeof TikTokUserLive>;
export type TikTokLive = InstanceType<typeof TikTokLive>;
export type TikTokSong = InstanceType<typeof TikTokSong>;
export type TikTokProfileVideos = InstanceType<typeof TikTokProfileVideos>;
export type TikTokComments = InstanceType<typeof TikTokComments>;
export type TikTokCommentReplies = InstanceType<typeof TikTokCommentReplies>;
export type TikTokFollowing = InstanceType<typeof TikTokFollowing>;
export type TikTokFollowers = InstanceType<typeof TikTokFollowers>;
export type TikTokSearchKeyword = InstanceType<typeof TikTokSearchKeyword>;
export type TikTokSearchTop = InstanceType<typeof TikTokSearchTop>;
export type TikTokSearchHashtag = InstanceType<typeof TikTokSearchHashtag>;
export type TikTokSongVideos = InstanceType<typeof TikTokSongVideos>;
export type TikTokTrendingFeed = InstanceType<typeof TikTokTrendingFeed>;
export type TikTokCollectionVideos = InstanceType<typeof TikTokCollectionVideos>;
export type AmazonSearch = InstanceType<typeof AmazonSearch>;
export type AmazonProduct = InstanceType<typeof AmazonProduct>;
export type AmazonAutocomplete = InstanceType<typeof AmazonAutocomplete>;
export type AmazonFeaturedReviews = InstanceType<typeof AmazonFeaturedReviews>;
export type AmazonMediaReviews = InstanceType<typeof AmazonMediaReviews>;
export type CopilotChatCompletions = InstanceType<typeof CopilotChatCompletions>;
export type EbaySearch = InstanceType<typeof EbaySearch>;
export type EbayProduct = InstanceType<typeof EbayProduct>;
export type EbaySeller = InstanceType<typeof EbaySeller>;
export type XProfile = InstanceType<typeof XProfile>;
export type XPost = InstanceType<typeof XPost>;
export type XUserPosts = InstanceType<typeof XUserPosts>;
export type XCommunityPosts = InstanceType<typeof XCommunityPosts>;
export type XCommunity = InstanceType<typeof XCommunity>;
export type EventbriteSearch = InstanceType<typeof EventbriteSearch>;
export type WalmartSearch = InstanceType<typeof WalmartSearch>;
export type WalmartProduct = InstanceType<typeof WalmartProduct>;
export type HomeDepotSearch = InstanceType<typeof HomeDepotSearch>;
export type HomeDepotProduct = InstanceType<typeof HomeDepotProduct>;
export type TargetSearch = InstanceType<typeof TargetSearch>;
export type TargetProduct = InstanceType<typeof TargetProduct>;
export type EtsySearch = InstanceType<typeof EtsySearch>;
export type EtsyProduct = InstanceType<typeof EtsyProduct>;
export type BestBuySearch = InstanceType<typeof BestBuySearch>;
export type BestBuyProduct = InstanceType<typeof BestBuyProduct>;
export type WayfairSearch = InstanceType<typeof WayfairSearch>;
export type WayfairProduct = InstanceType<typeof WayfairProduct>;
export type AliExpressSearch = InstanceType<typeof AliExpressSearch>;
export type AliExpressProduct = InstanceType<typeof AliExpressProduct>;
export type KrogerSearch = InstanceType<typeof KrogerSearch>;
export type KrogerProduct = InstanceType<typeof KrogerProduct>;
export type SproutsSearch = InstanceType<typeof SproutsSearch>;
export type SproutsProduct = InstanceType<typeof SproutsProduct>;
export type WholeFoodsSearch = InstanceType<typeof WholeFoodsSearch>;
export type WholeFoodsProduct = InstanceType<typeof WholeFoodsProduct>;
export type IkeaSearch = InstanceType<typeof IkeaSearch>;
export type IkeaProduct = InstanceType<typeof IkeaProduct>;
export type ZillowSearch = InstanceType<typeof ZillowSearch>;
export type ZillowProperty = InstanceType<typeof ZillowProperty>;
export type ZillowLocations = InstanceType<typeof ZillowLocations>;
export type RedfinSearch = InstanceType<typeof RedfinSearch>;
export type RedfinProperty = InstanceType<typeof RedfinProperty>;
export type RealtorSearch = InstanceType<typeof RealtorSearch>;
export type RealtorProperty = InstanceType<typeof RealtorProperty>;
export type ApartmentsSearch = InstanceType<typeof ApartmentsSearch>;
export type ApartmentsProperty = InstanceType<typeof ApartmentsProperty>;
export type HomesSearch = InstanceType<typeof HomesSearch>;
export type HomesProperty = InstanceType<typeof HomesProperty>;
export type FacebookSearchPages = InstanceType<typeof FacebookSearchPages>;
export type FacebookSearchProfiles = InstanceType<typeof FacebookSearchProfiles>;
export type FacebookHashtagPosts = InstanceType<typeof FacebookHashtagPosts>;
export type FacebookPost = InstanceType<typeof FacebookPost>;
export type FacebookPagePosts = InstanceType<typeof FacebookPagePosts>;
export type FacebookMarketplaceBrowse = InstanceType<typeof FacebookMarketplaceBrowse>;
export type FacebookReel = InstanceType<typeof FacebookReel>;

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
