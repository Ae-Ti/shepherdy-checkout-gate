#!/usr/bin/env node
// Fix loop: build → start → gate → (BLOCKED) brief → fix agent → integrity check → commit → gate again.
// npm run loop [-- --rounds 2] [-- --manual] [-- --static-only]
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { loadAppEnv, maskDeep, secretValues } from "../gate/lib/env.mjs";
import { appendHistory, rerender } from "../gate/lib/report.mjs";
import { buildBrief } from "./lib/brief.mjs";
import { compare, copyPaths, restore, snapshot } from "./lib/integrity.mjs";
import { runFixer } from "./fixer.mjs";

const { values } = parseArgs({
  options: {
    rounds: { type: "string", default: "2" },
    port: { type: "string", default: "3100" }, // its own port, so a dev server on 3000 never answers for it
    manual: { type: "boolean", default: false },
    "static-only": { type: "boolean", default: false },
  },
});

const appDir = process.cwd();
const outDir = path.join(appDir, ".gate");
const PROTECTED = ["gate", "playbook", "agent", "gate.config.json"];
const env = loadAppEnv(appDir);
const secrets = secretValues(env);
const rounds = Math.max(1, Number(values.rounds) || 2);
const baseUrl = `http://127.0.0.1:${values.port}`;
const log = (...a) => console.log(...a);
const sh = (cmd, args) => execFileSync(cmd, args, { cwd: appDir, encoding: "utf8" });

function tail(text, n = 60) {
  return maskDeep(String(text).split("\n").slice(-n).join("\n"), secrets);
}

function build() {
  log("  building (npm run build)…");
  const res = spawnSync("npm", ["run", "build"], { cwd: appDir, encoding: "utf8", env: process.env });
  return { ok: res.status === 0, log: `${res.stdout ?? ""}\n${res.stderr ?? ""}` };
}

async function startServer() {
  const busy = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
  if (busy) throw new Error(`Something is already running on ${baseUrl}. Stop it or pass --port.`);
  const child = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", values.port], { cwd: appDir, detached: true, stdio: "ignore", env: process.env });
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  stopServer(child);
  throw new Error(`The app did not start on ${baseUrl}.`);
}

function stopServer(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // already gone
  }
}

function buildFailedReport(buildLog) {
  return {
    verdict: "BLOCKED",
    checks: [
      {
        id: "B0",
        rule: "PP-00",
        title: "The app builds",
        status: "blocked",
        summary: "`npm run build` failed.",
        evidence: [{ label: "Build log (last lines)", actual: tail(buildLog, 40) }],
      },
    ],
  };
}

if (sh("git", ["status", "--porcelain"]).trim()) {
  console.error("Commit or stash your changes first: the loop commits each fix separately.");
  process.exit(2);
}

// The gate and playbook run from a copy taken before the agent starts, and must still match afterwards.
const before = snapshot(appDir, PROTECTED);
const pristine = path.join(outDir, "pristine");
fs.rmSync(pristine, { recursive: true, force: true });
copyPaths(appDir, pristine, PROTECTED);
const rules = JSON.parse(fs.readFileSync(path.join(pristine, "playbook", "rules.json"), "utf8"));

for (let round = 1; round <= rounds; round++) {
  log(`\n━━ Round ${round}/${rounds} on ${sh("git", ["rev-parse", "--short", "HEAD"]).trim()} ━━`);
  let report;
  const b = build();
  if (!b.ok) {
    log("  build failed");
    report = buildFailedReport(b.log);
  } else {
    let server = null;
    try {
      if (!values["static-only"]) server = await startServer();
      const args = [path.join(pristine, "gate", "run.mjs"), "--app", appDir, "--base-url", baseUrl, "--note", `fix loop round ${round}`];
      if (values.manual) args.push("--manual");
      if (values["static-only"]) args.push("--static-only");
      spawnSync(process.execPath, args, { cwd: appDir, stdio: "inherit", env: process.env });
    } finally {
      if (server) stopServer(server);
    }
    report = JSON.parse(fs.readFileSync(path.join(outDir, "report.json"), "utf8"));
  }

  if (report.verdict === "READY") {
    log("\nREADY: every check passed against PayPal's records.");
    process.exit(0);
  }
  if (report.verdict === "INCONCLUSIVE") {
    log("\nNOT PROVEN: fix the setup items in the report, then run again.");
    process.exit(2);
  }
  if (round === rounds) {
    log("\nBLOCKED: still failing after the last round.");
    process.exit(1);
  }

  const brief = buildBrief(report, rules);
  fs.writeFileSync(path.join(outDir, "fix-brief.md"), brief.text);
  log(`\n  fix agent ← ${brief.failedIds.join(", ")} (${brief.ruleIds.join(", ")})`);
  const fix = await runFixer({ appDir, outDir, brief, env, log });

  const touched = compare(appDir, before, PROTECTED);
  if (touched.touched.length) {
    restore(pristine, appDir, PROTECTED, touched);
    appendHistory(outDir, { kind: "tamper", summary: `The fix touched protected files (${touched.touched.join(", ")}). Restored them; this round is BLOCKED.` });
    rerender(outDir);
    console.error("\nBLOCKED: the fix agent changed the gate or the playbook.");
    process.exit(1);
  }
  if (!fix.changedFiles.length) {
    log("\nBLOCKED: the fix agent made no changes.");
    process.exit(1);
  }

  sh("git", ["add", "-A", "--", ...fix.changedFiles]);
  const summary = maskDeep(fix.summary || "", secrets).trim();
  sh("git", ["commit", "-m", `fix(agent): satisfy ${brief.ruleIds.join(", ")}`, "-m", summary || `Fixes ${brief.failedIds.join(", ")}.`]);
  const diff = tail(sh("git", ["show", "--stat", "--patch", "--format=", "HEAD"]), 160);
  appendHistory(outDir, { kind: "fix", agent: fix.agent, files: fix.changedFiles, summary, diff });
  rerender(outDir);
  log(`  committed ${sh("git", ["rev-parse", "--short", "HEAD"]).trim()}: ${fix.changedFiles.join(", ")}`);
}
