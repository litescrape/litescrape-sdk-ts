import {
  scrape,
  GoogleSearch,
  GoogleMaps,
  GoogleAds,
  GooglePlayApps,
  GooglePlayReviews,
  AppleAppStoreSearch,
  REQUEST_TYPES,
  type AnyRequest,
  type RequestInput,
  type Result,
} from "litescrape-sdk";

const search: GoogleSearch = new GoogleSearch({ q: "coffee", nfpr: true, num: "10" });
const request: RequestInput = { endpoint: "google_maps", q: "coffee", type: "search" };
const typed: AnyRequest = new GoogleMaps({ place_id: "id" });
const returned: Promise<Result[]> = scrape([search, request, typed], { apiKey: "key", requestTimeout: 15 });
void returned;
const q: string | null | undefined = search.q;
const num: number | null | undefined = search.num;
void q;
void num;
new GooglePlayApps({});
new GooglePlayReviews({ product_id: "com.example", num: "10" });
new AppleAppStoreSearch({ term: "coffee", country: "UK" });
new REQUEST_TYPES.google_search({ q: "coffee" });

// @ts-expect-error Endpoint discriminator must be valid.
scrape([{ endpoint: "google", q: "x" }]);
// @ts-expect-error Required endpoint parameters are reflected in constructors.
new GoogleAds({ q: "x" });
// @ts-expect-error Unknown query parameters must be rejected at compile time too.
new GoogleSearch({ q: "x", bogus: 1 });
// @ts-expect-error Store identifiers are strictly strings.
new GooglePlayReviews({ product_id: 123 });
// @ts-expect-error Deadline values are strictly numbers.
new GoogleSearch({ q: "x", timeout: "15" });
// @ts-expect-error Enums preserve literal types.
new GoogleMaps({ q: "x", type: "invalid" });
// @ts-expect-error Fast mode does not accept numeric boolean lookalikes.
new GoogleSearch({ q: "x", fast_mode: 1 });
// @ts-expect-error Validated fields are immutable.
search.q = "changed";

function discriminate(value: AnyRequest): void {
  if (value.endpoint === "google_play_reviews") {
    const identifier: string = value.product_id;
    const count: number = value.num;
    void identifier;
    void count;
  }
}
void discriminate;
