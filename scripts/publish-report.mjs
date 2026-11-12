#!/usr/bin/env node
// npm run gate:publish
// Copies the last REAL gate run (.gate/report.json + history) to public/release/ so the site can show it at /gate.
// Secrets are masked again and local paths are removed. Nothing is invented: no run, nothing to publish.
import fs from "node:fs";
import path from "node:path";
import { loadAppEnv, maskDeep, secretValues } from "../gate/lib/env.mjs";

const appDir = process.cwd();
const src = path.join(appDir, ".gate");
const reportFile = path.join(src, "report.json");
if (!fs.existsSync(reportFile)) {
  console.error("No gate run found. Run `npm run gate` (or `npm run loop`) first.");
  process.exit(1);
}

const secrets = secretValues(loadAppEnv(appDir));
const clean = (value) => {
  const text = JSON.stringify(value).split(appDir).join(".");
  return maskDeep(JSON.parse(text), secrets);
};

const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
delete report.outDir;
const history = fs.existsSync(path.join(src, "history.json")) ? JSON.parse(fs.readFileSync(path.join(src, "history.json"), "utf8")) : [];

const out = path.join(appDir, "public", "release");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(clean({ ...report, publishedAt: new Date().toISOString() }), null, 2));
fs.writeFileSync(path.join(out, "history.json"), JSON.stringify(clean(history.slice(-12)), null, 2));
console.log(`Published the ${report.verdict} run on ${report.commit ?? "an uncommitted tree"} to public/release/.`);
console.log("Commit public/release and redeploy so /gate shows it.");
