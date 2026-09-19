import { writeFileSync } from "node:fs";

// Declarations and JavaScript in this directory must both resolve as CommonJS.
writeFileSync(new URL("../dist/cjs/package.json", import.meta.url), '{"type":"commonjs"}\n');
