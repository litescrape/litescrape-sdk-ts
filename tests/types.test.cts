import sdk = require("litescrape-sdk");

const search: sdk.GoogleSearch = new sdk.GoogleSearch({ q: "coffee" });
const results: Promise<sdk.Result[]> = sdk.scrape([search]);
void results;
// @ts-expect-error CommonJS declarations must retain constructor validation.
new sdk.GoogleAds({ q: "coffee" });
