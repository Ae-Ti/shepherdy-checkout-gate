#!/usr/bin/env node
// Shepherdy Checkout Gate: npm run gate [-- --manual] [-- --static-only] [-- --base-url https://your-app.example]
import { parseArgs } from "node:util";
import { runGate } from "./lib/gate.mjs";
import { EXIT_CODE } from "./lib/verdict.mjs";

const { values } = parseArgs({
  options: {
    app: { type: "string" },
    "base-url": { type: "string" },
    manual: { type: "boolean", default: false },
    "static-only": { type: "boolean", default: false },
    "no-fail-fast": { type: "boolean", default: false },
    out: { type: "string" },
    note: { type: "string" },
    quiet: { type: "boolean", default: false },
  },
});

const report = await runGate({
  appDir: values.app ?? process.cwd(),
  baseUrl: values["base-url"],
  manual: values.manual,
  staticOnly: values["static-only"],
  failFast: !values["no-fail-fast"],
  outDir: values.out,
  note: values.note,
  quiet: values.quiet,
});
process.exit(EXIT_CODE[report.verdict] ?? 2);
