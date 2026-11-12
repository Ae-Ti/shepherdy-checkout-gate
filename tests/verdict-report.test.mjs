import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decide } from "../gate/lib/verdict.mjs";
import { maskDeep } from "../gate/lib/env.mjs";
import { renderHtml, writeReport } from "../gate/lib/report.mjs";
import { buildBrief } from "../agent/lib/brief.mjs";
import { compare, restore, snapshot, copyPaths } from "../agent/lib/integrity.mjs";

const pass = { status: "pass" };

test("verdict: blocked wins, anything unproven is inconclusive, all pass is ready", () => {
  assert.equal(decide([pass, { status: "blocked" }, { status: "inconclusive" }]), "BLOCKED");
  assert.equal(decide([pass, { status: "skipped" }]), "INCONCLUSIVE");
  assert.equal(decide([pass, { status: "inconclusive" }]), "INCONCLUSIVE");
  assert.equal(decide([pass, pass]), "READY");
});

const SECRET = "sk_sandbox_never_print_me_42";
const report = maskDeep(
  {
    verdict: "BLOCKED",
    commit: "abc1234",
    branch: "demo/risky",
    subject: "let the browser send the price",
    target: "http://127.0.0.1:3000",
    mode: "automatic",
    finishedAt: "2026-11-13T02:00:00Z",
    durationMs: 1000,
    checks: [
      {
        id: "A1",
        rule: "PP-01",
        group: "Attacks",
        title: "Paying $0.01 for a $120 booking is impossible",
        status: "blocked",
        summary: `PayPal recorded 0.01 USD (secret ${SECRET})`,
        evidence: [
          { label: "Browser sent", actual: "0.01 USD" },
          { label: "PayPal recorded", expected: "120.00 USD", actual: "0.01 USD", ok: false },
        ],
      },
    ],
  },
  [SECRET],
);

test("report HTML shows the verdict and PayPal evidence but never the secret", () => {
  const html = renderHtml(report, []);
  assert.match(html, /BLOCKED/);
  assert.match(html, /PayPal recorded/);
  assert.ok(!html.includes(SECRET));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-report-"));
  writeReport(dir, report);
  assert.ok(fs.existsSync(path.join(dir, "report.html")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "history.json"), "utf8")).length, 1);
});

test("fix brief lists the failed checks with rule text and no secrets", () => {
  const brief = buildBrief(report, { "PP-01": "The price comes only from the server." });
  assert.deepEqual(brief.ruleIds, ["PP-01"]);
  assert.match(brief.text, /PP-01: The price comes only from the server/);
  assert.ok(!brief.text.includes(SECRET));
});

test("integrity: any change to protected files is detected and restored", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate-int-"));
  fs.mkdirSync(path.join(root, "gate"), { recursive: true });
  fs.writeFileSync(path.join(root, "gate", "run.mjs"), "original");
  const before = snapshot(root, ["gate"]);
  const pristine = fs.mkdtempSync(path.join(os.tmpdir(), "gate-pristine-"));
  copyPaths(root, pristine, ["gate"]);

  fs.writeFileSync(path.join(root, "gate", "run.mjs"), "process.exit(0) // always READY");
  fs.writeFileSync(path.join(root, "gate", "extra.mjs"), "x");
  const diff = compare(root, before, ["gate"]);
  assert.deepEqual(diff.changed, ["gate/run.mjs"]);
  assert.deepEqual(diff.added, ["gate/extra.mjs"]);

  restore(pristine, root, ["gate"], diff);
  assert.equal(fs.readFileSync(path.join(root, "gate", "run.mjs"), "utf8"), "original");
  assert.equal(compare(root, before, ["gate"]).touched.length, 0);
});
