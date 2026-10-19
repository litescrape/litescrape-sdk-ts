import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Mechanical import of the endpoint catalog from the API's OpenAPI contract
// (https://api.litescrape.com/api/openapi.json, or a saved copy of it).
const source = process.argv[2];
if (!source) throw new Error("Usage: node scripts/import-v3-catalog.mjs <openapi.json path or URL>");
const spec = /^https?:\/\//.test(source)
  ? await (await fetch(source)).json()
  : JSON.parse(readFileSync(source, "utf8"));
const destination = new URL("../tests/fixtures/", import.meta.url);
// Slugs released before the v3 catalog keep their names.
const legacy = {
  "/api/google/maps/popular-times": "google_maps_live_foot_traffic",
  "/api/google/maps/photo-meta": "google_maps_photo",
};
const schemas = spec.components.schemas;
const allowlists = {};
const paths = {};
const examples = {};
const postOnly = [];
for (const [path, operations] of Object.entries(spec.paths)) {
  const operation = operations.post;
  const reference = operation?.requestBody?.content?.["application/json"]?.schema?.$ref;
  if (!path.startsWith("/api/") || path.endsWith("/async") || !operation?.["x-litescrape"] || !reference)
    continue;
  const schema = schemas[reference.split("/").at(-1)];
  const slug = legacy[path] ?? path.slice("/api/".length).replace(/[/-]/g, "_");
  paths[slug] = path;
  allowlists[slug] = [...Object.keys(schema.properties ?? {}), "timeout"].sort();
  examples[slug] = schema.examples?.[0] ?? {};
  if (operation["x-litescrape"].postOnly) postOnly.push(slug);
}
const sorted = (value) => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
const write = (name, value) =>
  writeFileSync(new URL(`${name}.json`, destination), JSON.stringify(value, null, 2) + "\n");
write("allowlists", sorted(allowlists));
write("paths", sorted(paths));
write("examples", { postOnly: postOnly.sort(), requests: sorted(examples) });
console.log(
  `Imported ${Object.keys(paths).length} routes from ${/^https?:/.test(source) ? source : resolve(source)}`,
);
