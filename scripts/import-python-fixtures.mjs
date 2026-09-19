import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

// Mechanical import from the Python SDK; does not require Python or its dependencies.
const source = process.argv[2];
if (!source) throw new Error("Usage: node scripts/import-python-fixtures.mjs <python-sdk-checkout>");
const destination = new URL("../tests/fixtures/", import.meta.url);
mkdirSync(destination, { recursive: true });
copyFileSync(join(source, "tests/allowlists.json"), new URL("allowlists.json", destination));
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
const models = readFileSync(join(source, "src/litescrape_sdk/models.py"), "utf8");
const paths = Object.fromEntries(
  Array.from(models.matchAll(/path: ClassVar\[str\] = "([^"]+)"\s+endpoint: Literal\["([^"]+)"\]/g), (m) => [
    m[2],
    m[1],
  ]),
);
writeFileSync(new URL("paths.json", destination), JSON.stringify(paths, null, 2) + "\n");
console.log(
  `Imported ${Object.keys(paths).length} routes and ${fixtures.reduce((n, f) => n + f.cases.length, 0)} Store cases from ${resolve(source)}`,
);
