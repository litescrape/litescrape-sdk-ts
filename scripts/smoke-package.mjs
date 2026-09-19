import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const tarballs = readdirSync(".").filter((name) => /^litescrape-sdk-.*\.tgz$/.test(name));
assert.equal(tarballs.length, 1, "Run npm pack in a clean checkout first");
const directory = mkdtempSync(join(tmpdir(), "litescrape-package-smoke-"));
try {
  writeFileSync(join(directory, "package.json"), JSON.stringify({ private: true, type: "module" }));
  // Use npm's JS CLI to avoid shell quoting, including on Windows paths with spaces.
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error("Run this script with npm run test:package");
  execFileSync(
    process.execPath,
    [npm, "install", "--ignore-scripts", "--no-audit", "--no-fund", resolve(tarballs[0])],
    { cwd: directory, stdio: "inherit" },
  );
  const require = createRequire(join(directory, "package.json"));
  const common = require("litescrape-sdk");
  assert.equal(new common.GoogleSearch({ q: "packaged" }).queryParams().q, "packaged");
  assert.deepEqual(await common.scrape([]), []);
  const consumer = join(directory, "consumer.mjs");
  writeFileSync(
    consumer,
    `import assert from 'node:assert/strict';
import { GoogleSearch, scrape } from 'litescrape-sdk';
assert.equal(new GoogleSearch({ q: 'packaged' }).queryParams().q, 'packaged');
assert.deepEqual(await scrape([]), []);
`,
  );
  execFileSync(process.execPath, [consumer], { cwd: directory, stdio: "inherit" });
  console.log("Installed tarball works in ESM and CommonJS without build scripts.");
} finally {
  // This directory was created above and contains only the disposable consumer project.
  rmSync(directory, { recursive: true, force: true });
}
