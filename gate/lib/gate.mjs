import path from "node:path";
import { loadAppEnv, maskDeep, secretValues } from "./env.mjs";
import { doctor } from "./doctor.mjs";
import { staticChecks } from "./checks-static.mjs";
import { META as HTTP, httpChecks } from "./checks-http.mjs";
import { META as E2E, e2eChecks } from "./checks-e2e.mjs";
import { createPayPal } from "./paypal.mjs";
import { decide } from "./verdict.mjs";
import { writeReport } from "./report.mjs";
import { git, gitInfo, readJsonFile, skipped, writeJsonFile } from "./util.mjs";
import { mergeRoutes } from "./routes.mjs";

const DEFAULTS = {
  experienceId: "sunrise-kayak",
  expectedAmount: "120.00",
  currency: "USD",
  tamperedAmount: "0.01",
  baseUrl: "http://127.0.0.1:3000",
  sourceDirs: ["app", "components", "lib"],
  manualApprovalTimeoutSec: 300,
};

// The app's gate.config.json over the defaults; "routes" is merged key by key.
export function resolveConfig(raw = {}) {
  return { ...DEFAULTS, ...raw, routes: mergeRoutes(raw.routes) };
}

const MARK = { pass: "✔", blocked: "✖", inconclusive: "?", skipped: "–" };

function printSummary(report, log) {
  for (const c of report.checks) {
    log(`${MARK[c.status] ?? "·"} ${c.id.padEnd(3)} ${c.rule}  ${c.title}`);
    if (c.status !== "pass") log(`        ${c.summary}`);
  }
  log(`\nVERDICT: ${report.verdict}   report: ${path.join(report.outDir, "report.html")}`);
}

export async function runGate(opts) {
  const appDir = path.resolve(opts.appDir ?? process.cwd());
  const config = resolveConfig(readJsonFile(path.join(appDir, "gate.config.json"), {}));
  const env = loadAppEnv(appDir);
  const outDir = path.resolve(opts.outDir ?? path.join(appDir, ".gate"));
  const ctx = {
    appDir,
    config,
    env,
    outDir,
    baseUrl: String(opts.baseUrl || config.baseUrl).replace(/\/+$/, ""),
    manual: Boolean(opts.manual),
    staticOnly: Boolean(opts.staticOnly),
  };
  const log = opts.quiet ? () => {} : console.log;
  const started = Date.now();
  log(`Shepherdy Checkout Gate → ${ctx.staticOnly ? "static checks only" : ctx.baseUrl}\n`);

  const checks = [];
  const doc = await doctor(ctx);
  checks.push(...doc.checks);
  checks.push(...(await staticChecks(ctx)));

  const later = [HTTP.A1, HTTP.A2, HTTP.A3, E2E.E1, E2E.A4, E2E.A6, E2E.A5];
  if (ctx.staticOnly) {
    checks.push(...later.map((m) => skipped(m, "Static-only run: attacks and the sandbox payment were not run.")));
  } else if (!doc.paypalOk || !doc.appOk) {
    checks.push(...later.map((m) => skipped(m, "Setup checks did not pass, so the attacks were not run.")));
  } else {
    const paypal = createPayPal(env);
    checks.push(...(await httpChecks(ctx, paypal)));
    const failFast = opts.failFast !== false;
    if (failFast && checks.some((c) => c.status === "blocked")) {
      checks.push(...[E2E.E1, E2E.A4, E2E.A6, E2E.A5].map((m) => skipped(m, "Not run: earlier checks already block this commit.")));
    } else {
      checks.push(...(await e2eChecks(ctx, paypal, log)));
    }
  }

  const verdict = decide(checks);
  const info = gitInfo(appDir);
  const report = maskDeep(
    {
      tool: "shepherdy-checkout-gate",
      version: "0.1.0",
      verdict,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      target: ctx.staticOnly ? "static checks" : ctx.baseUrl,
      mode: ctx.manual ? "manual approval" : "automatic",
      ...info,
      note: opts.note ?? null,
      outDir,
      checks,
    },
    secretValues(env),
  );
  writeReport(outDir, report);
  if (verdict === "READY") {
    try {
      writeJsonFile(path.join(outDir, "last-ready.json"), { commit: git(appDir, ["rev-parse", "HEAD"]).trim(), at: report.finishedAt });
    } catch {
      // not a git repository
    }
  }
  printSummary(report, log);
  return report;
}
