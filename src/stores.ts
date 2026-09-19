import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { isObject } from "./errors.js";
import { optional as opt, has, issue, type Rule } from "./validation.js";

const cleanText = z
  .string()
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value), "Control characters are not allowed")
  .refine(
    (value) => !Array.from(value).some((c) => c.length === 1 && /[\ud800-\udfff]/.test(c)),
    "Use valid Unicode text",
  );
const query = cleanText
  .refine((value) => Buffer.byteLength(value.trim(), "utf8") <= 2048, "Use at most 2,048 UTF-8 bytes")
  .trim()
  .min(1)
  .max(2048);
const whole = z
  .union([
    z.number().int(),
    cleanText
      .trim()
      .regex(/^[+-]?\d+$/)
      .transform(Number),
  ])
  .pipe(z.number().int());
const category = cleanText
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
const identifier = cleanText
  .min(1)
  .max(512)
  .regex(/^[a-zA-Z0-9_.-]+$/);
const token = cleanText
  .min(1)
  .max(65536)
  .regex(/^[a-zA-Z0-9_=+/:.-]+$/);
const age = z.enum(["AGE_RANGE1", "AGE_RANGE2", "AGE_RANGE3"]);
const store = z.enum(["apps", "books", "audiobooks", "movies", "tv"]).default("apps");
const playLocale = {
  hl: cleanText
    .max(32)
    .regex(/^[a-zA-Z]{2,3}(?:[-_][a-zA-Z0-9]{2,8}){0,3}$/)
    .default("en"),
  gl: cleanText
    .regex(/^[a-zA-Z]{2}$/)
    .toLowerCase()
    .default("us"),
};
const listing = {
  ...playLocale,
  q: opt(query),
  chart: opt(category),
  next_page_token: opt(token),
  section_page_token: opt(token),
  see_more_token: opt(token),
};
export const playApps = {
  ...listing,
  apps_category: opt(category),
  age: opt(age),
  store_device: opt(z.enum(["phone", "tablet", "tv", "chromebook", "watch", "car"])),
};
export const playGames = {
  ...listing,
  games_category: opt(category),
  store_device: opt(z.enum(["phone", "tablet", "tv", "chromebook", "watch", "windows"])),
};
export const playBooks = {
  ...listing,
  books_category: opt(category),
  age: opt(age),
  price: opt(whole.pipe(z.number().min(1).max(2))),
};
export const playMovies = { ...listing, movies_category: opt(category), age: opt(age) };
export const playProduct = { ...playLocale, product_id: identifier, store, season_id: opt(identifier) };
export const playReviews = {
  ...playLocale,
  product_id: identifier,
  store,
  platform: z.enum(["phone", "tablet", "watch", "chromebook", "tv"]).default("phone"),
  rating: opt(whole.pipe(z.number().min(1).max(5))),
  sort_by: whole.pipe(z.number().min(1).max(3)).default(1),
  num: whole.pipe(z.number().min(1).max(199)).default(40),
  next_page_token: opt(token),
};

const tokenFields = ["next_page_token", "section_page_token", "see_more_token"];
export const playRules = (operation: string): Rule[] => [
  (p, c) => {
    if (["apps", "games", "books", "movies"].includes(operation)) {
      if ([...tokenFields, "chart"].filter((f) => p[f]).length > 1)
        issue(c, "chart and pagination selectors are mutually exclusive");
      if (p.chart && p.q) issue(c, "chart and q are mutually exclusive");
      if (p.chart && has(p, "store_device") && p.store_device !== "phone")
        issue(c, "Device-specific storefronts do not support charts; omit chart or use phone");
      const categoryValue = p[`${operation}_category`];
      if (p.q && categoryValue) issue(c, "q and category are mutually exclusive");
      if (has(p, "store_device") && (p.q || categoryValue)) issue(c, "store_device excludes q and category");
      if (p.age && categoryValue !== (operation === "books" ? "coll_1689" : "FAMILY"))
        issue(c, "age requires the children's category");
      if (has(p, "price") && !p.q) issue(c, "price requires q");
    }
    if (p.season_id && p.store !== "tv") issue(c, "season_id requires store=tv");

    const context = Object.fromEntries(
      Object.entries(p).filter(([key, value]) => value != null && ![...tokenFields, "chart"].includes(key)),
    );
    if (["apps", "games"].includes(operation) && !p.q && !p[`${operation}_category`])
      context.store_device ??= "phone";
    for (const field of tokenFields) {
      const encoded = p[field];
      if (typeof encoded !== "string") continue;
      const kind =
        field === "next_page_token"
          ? operation === "reviews"
            ? "reviews"
            : "page"
          : field === "section_page_token"
            ? "section"
            : "collection";
      try {
        if (!/^[a-zA-Z0-9+/_-]*={0,2}$/.test(encoded) || encoded.replace(/=+$/, "").length % 4 === 1)
          throw new Error();
        const decoded: unknown = JSON.parse(
          new TextDecoder("utf8", { fatal: true }).decode(Buffer.from(encoded, "base64url")),
        );
        if (
          !isObject(decoded) ||
          decoded.v !== 1 ||
          decoded.operation !== operation ||
          decoded.kind !== kind ||
          !isDeepStrictEqual(decoded.context, context) ||
          typeof decoded.token !== "string" ||
          !/^[a-zA-Z0-9_=+/:.-]{1,12000}$/.test(decoded.token)
        )
          throw new Error();
      } catch {
        issue(c, "Use a returned token with the same operation and search parameters", [field]);
      }
    }
  },
];

const storefronts = new Set(
  "ae af ag ai al am ao ar at au az ba bb be bf bg bh bj bm bn bo br bs bt bw by bz ca cd cg ch ci cl cm cn co cr cv cy cz de dk dm do dz ec ee eg es fi fj fm fr ga gb gd ge gh gm gr gt gw gy hk hn hr hu id ie il in iq is it jm jo jp ke kg kh kn kr kw ky kz la lb lc lk lr lt lu lv ly ma md me mg mk ml mm mn mo mr ms mt mu mv mw mx my mz na ne ng ni nl no np nr nz om pa pe pg ph pk pl pt pw py qa ro rs ru rw sa sb sc se sg si sk sl sn sr st sv sz tc td th tj tm tn to tr tt tw tz ua ug us uy uz vc ve vg vn vu xk ye za zm zw".split(
    " ",
  ),
);
const appleLocale = {
  country: cleanText
    .regex(/^[a-zA-Z]{2}$/)
    .toLowerCase()
    .transform((value) => (value === "uk" ? "gb" : value))
    .refine((value) => storefronts.has(value), "Choose a supported Apple storefront country")
    .default("us"),
};
const productId = cleanText.regex(/^[1-9][0-9]{0,19}$/);
const quotePlus = (value: string) =>
  encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
export const appleSearch = {
  ...appleLocale,
  term: query.refine((value) => {
    try {
      return quotePlus(value).length <= 4096;
    } catch {
      return false;
    }
  }, "Use at most 4,096 URL-encoded bytes"),
  lang: cleanText
    .regex(/^[a-zA-Z]{2,3}-[a-zA-Z]{2}$/)
    .toLowerCase()
    .default("en-us"),
  num: whole.pipe(z.number().min(1).max(200)).default(10),
  disallow_explicit: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => value === true || value === "true")
    .default(false),
  property: opt(z.literal("developer")),
  category_id: opt(
    whole.pipe(
      z
        .number()
        .min(1)
        .max(2 ** 31 - 1),
    ),
  ),
  device: z.enum(["mobile", "tablet", "desktop"]).default("mobile"),
};
export const appleProduct = { ...appleLocale, product_id: productId, type: z.literal("app").default("app") };
export const appleReviews = {
  ...appleLocale,
  product_id: productId,
  sort: z.enum(["mostrecent", "mosthelpful"]).default("mostrecent"),
  page: whole
    .pipe(
      z
        .number()
        .min(1)
        .max(2 ** 31 - 1),
    )
    .default(1),
};
