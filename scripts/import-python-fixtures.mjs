import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

// Mechanical import of the Store contract cases from the Python SDK; does not require Python.
// The endpoint catalog (allowlists, paths, examples) comes from scripts/import-v3-catalog.mjs.
const source = process.argv[2];
if (!source) throw new Error("Usage: node scripts/import-python-fixtures.mjs <python-sdk-checkout>");
const destination = new URL("../tests/fixtures/", import.meta.url);
mkdirSync(destination, { recursive: true });
const contract = JSON.parse(readFileSync(join(source, "tests/store_contract.json"), "utf8"));
// Keep all cases readable without checking in megabytes of repeated boundary strings.
function compact(value) {
  if (typeof value === "string" && value.length > 256) {
    const characters = Array.from(value);
    if (characters.every((c) => c === characters[0]))
      return { $repeat: characters[0], count: characters.length };
    return { $gzip: gzipSync(value, { mtime: 0 }).toString("base64") };
  }
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, compact(v)]));
  return value;
}
const fixtures = contract.map(({ mode, path, parameters, cases }) =>
  compact({ mode, path, parameters, cases }),
);
writeFileSync(new URL("stores.json", destination), JSON.stringify(fixtures, null, 2) + "\n");
console.log(
  `Imported ${fixtures.reduce((n, f) => n + f.cases.length, 0)} Store cases from ${resolve(source)}`,
);
