import fs from "node:fs";
import path from "node:path";
import { readJsonFile, writeJsonFile } from "./util.mjs";

const RULES_URL = "../playbook/paypal-checkout.md";

export function appendHistory(outDir, entry) {
  const file = path.join(outDir, "history.json");
  const history = readJsonFile(file, []);
  history.push({ at: new Date().toISOString(), ...entry });
  writeJsonFile(file, history.slice(-50));
  return history;
}

export function writeReport(outDir, report) {
  writeJsonFile(path.join(outDir, "report.json"), report);
  const history = appendHistory(outDir, {
    kind: "gate",
    verdict: report.verdict,
    commit: report.commit,
    branch: report.branch,
    subject: report.subject,
    note: report.note,
    target: report.target,
    failed: report.checks.filter((c) => c.status === "blocked").map((c) => `${c.id} ${c.rule}`),
  });
  fs.writeFileSync(path.join(outDir, "report.html"), renderHtml(report, history));
}

// Re-render the page after the fix loop adds entries to the history.
export function rerender(outDir) {
  const report = readJsonFile(path.join(outDir, "report.json"), null);
  if (!report) return;
  fs.writeFileSync(path.join(outDir, "report.html"), renderHtml(report, readJsonFile(path.join(outDir, "history.json"), [])));
}

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const LABEL = { pass: "PASS", blocked: "BLOCKED", inconclusive: "NOT PROVEN", skipped: "SKIPPED" };
const VERDICT_TEXT = {
  READY: "Every check passed against PayPal's own records. This commit may ship.",
  BLOCKED: "At least one check failed. This commit must not ship.",
  INCONCLUSIVE: "Nothing failed, but not everything could be proven. Fix the setup and run again.",
};
const GROUPS = ["Setup", "Secrets", "Attacks", "End to end"];

function evidenceRows(c) {
  if (!c.evidence?.length) return "";
  const rows = c.evidence
    .map(
      (e) => `<tr class="${e.ok === false ? "bad" : e.ok === true ? "good" : ""}">
        <td>${esc(e.label)}</td><td>${e.expected !== undefined ? esc(e.expected) : ""}</td><td><code>${esc(e.actual)}</code></td></tr>`,
    )
    .join("");
  return `<table class="ev"><thead><tr><th>Evidence</th><th>Expected</th><th>Actual</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function checkCard(c) {
  return `<article class="check ${c.status}">
    <header><span class="chip ${c.status}">${LABEL[c.status] ?? c.status}</span>
      <strong>${esc(c.id)}</strong> <a class="rule" href="${RULES_URL}#${esc(c.rule?.toLowerCase())}">${esc(c.rule)}</a>
      <span class="title">${esc(c.title)}</span></header>
    <p>${esc(c.summary)}</p>
    ${evidenceRows(c)}
    ${c.debugIds?.length ? `<p class="debug">PayPal-Debug-Id: ${c.debugIds.map((d) => `<code>${esc(d)}</code>`).join(" ")}</p>` : ""}
  </article>`;
}

function historyList(history) {
  const items = history
    .slice(-10)
    .reverse()
    .map((h) => {
      if (h.kind === "fix") {
        return `<li class="fix"><span class="chip fix">AGENT FIX</span> ${esc(h.agent)} changed ${esc((h.files ?? []).join(", ") || "nothing")}
          ${h.summary ? `<div class="muted">${esc(h.summary)}</div>` : ""}
          ${h.diff ? `<details><summary>Diff (secrets hidden)</summary><pre>${esc(h.diff)}</pre></details>` : ""}
          <time>${esc(h.at)}</time></li>`;
      }
      if (h.kind === "tamper") {
        return `<li><span class="chip blocked">TAMPER</span> ${esc(h.summary)} <time>${esc(h.at)}</time></li>`;
      }
      return `<li><span class="chip ${h.verdict === "READY" ? "pass" : h.verdict === "BLOCKED" ? "blocked" : "inconclusive"}">${esc(h.verdict)}</span>
        <code>${esc(h.commit ?? "")}</code> ${esc(h.subject ?? "")} ${h.failed?.length ? `<span class="muted">· failed ${esc(h.failed.join(", "))}</span>` : ""}
        <time>${esc(h.at)}</time></li>`;
    })
    .join("");
  return `<ol class="history">${items}</ol>`;
}

function highlight(report) {
  const a1 = report.checks.find((c) => c.id === "A1");
  const e1 = report.checks.find((c) => c.id === "E1");
  const pick = (c, label) => c?.evidence?.find((e) => e.label === label);
  const cells = [];
  const sent = pick(a1, "Browser sent");
  const recorded = pick(a1, "PayPal recorded");
  if (sent && recorded) {
    cells.push(`<div class="kpi ${recorded.ok ? "good" : "bad"}"><span>Browser asked to pay</span><b>${esc(sent.actual)}</b></div>`);
    cells.push(`<div class="kpi ${recorded.ok ? "good" : "bad"}"><span>PayPal recorded</span><b>${esc(recorded.actual)}</b><small>expected ${esc(recorded.expected)}</small></div>`);
  }
  const cap = pick(e1, "PayPal capture status");
  if (cap) cells.push(`<div class="kpi ${cap.ok ? "good" : "bad"}"><span>Sandbox payment</span><b>${esc(cap.actual)}</b><small>according to PayPal</small></div>`);
  return cells.length ? `<section class="kpis">${cells.join("")}</section>` : "";
}

export function renderHtml(report, history = []) {
  const groups = GROUPS.map((g) => {
    const cs = report.checks.filter((c) => c.group === g);
    return cs.length ? `<h2>${esc(g)}</h2>${cs.map(checkCard).join("")}` : "";
  }).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(report.verdict)} · Shepherdy Checkout Gate</title>
<style>
:root{--ink:#17202a;--muted:#5d6b78;--line:#e3e8ee;--ok:#11633b;--okbg:#e7f6ee;--bad:#9b1c1c;--badbg:#fdecec;--warn:#7a4b00;--warnbg:#fff5df}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:#f6f7f9}
main{max-width:1000px;margin:0 auto;padding:24px 20px 60px}
.banner{border-radius:16px;padding:22px 24px;color:#fff;display:flex;flex-wrap:wrap;gap:6px 18px;align-items:baseline}
.banner.READY{background:#13795b}.banner.BLOCKED{background:#b42318}.banner.INCONCLUSIVE{background:#9a6700}
.banner h1{margin:0;font-size:30px;letter-spacing:.02em}.banner p{margin:0;opacity:.95}
.meta{color:var(--muted);font-size:13px;margin:10px 2px 18px}.meta code{color:var(--ink)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:0 0 8px}
.kpi{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column}
.kpi span{color:var(--muted);font-size:13px}.kpi b{font-size:24px}.kpi small{color:var(--muted)}
.kpi.bad{border-color:#f1b5b5}.kpi.bad b{color:var(--bad)}.kpi.good b{color:var(--ok)}
h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:26px 0 10px}
.check{background:#fff;border:1px solid var(--line);border-left:5px solid var(--line);border-radius:12px;padding:12px 16px;margin:0 0 10px}
.check.pass{border-left-color:#2f9e6e}.check.blocked{border-left-color:#d92d20}.check.inconclusive,.check.skipped{border-left-color:#dca73a}
.check header{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.check p{margin:6px 0}
.title{font-weight:600}.rule{font-size:12px;color:#3b5bdb;text-decoration:none;border:1px solid #c5d0fa;border-radius:6px;padding:1px 6px}
.chip{font-size:11px;font-weight:800;letter-spacing:.05em;border-radius:999px;padding:2px 9px;background:var(--line)}
.chip.pass{background:var(--okbg);color:var(--ok)}.chip.blocked{background:var(--badbg);color:var(--bad)}.chip.inconclusive,.chip.skipped{background:var(--warnbg);color:var(--warn)}.chip.fix{background:#e8ecff;color:#3b5bdb}
table.ev{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}table.ev th{text-align:left;color:var(--muted);font-weight:600}
table.ev td,table.ev th{border-top:1px solid var(--line);padding:5px 8px;vertical-align:top}tr.bad td{background:var(--badbg)}tr.good td code{color:var(--ok)}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}.debug{font-size:12px;color:var(--muted)}
.history{list-style:none;padding:0;margin:0}.history li{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:0 0 8px}
.history time{display:block;color:var(--muted);font-size:12px}.muted{color:var(--muted);font-size:13px}
pre{background:#0f172a;color:#e2e8f0;border-radius:8px;padding:10px;overflow:auto;font-size:12px}
footer{color:var(--muted);font-size:13px;margin-top:30px}
</style></head><body><main>
<section class="banner ${esc(report.verdict)}"><h1>${esc(report.verdict)}</h1><p>${esc(VERDICT_TEXT[report.verdict])}</p></section>
<p class="meta">Commit <code>${esc(report.commit ?? "n/a")}</code> on <code>${esc(report.branch ?? "n/a")}</code> · ${esc(report.subject ?? "")}<br>
Target ${esc(report.target)} · ${esc(report.mode)} · ${esc(report.finishedAt)} · ${Math.round((report.durationMs ?? 0) / 1000)}s</p>
${highlight(report)}
${groups}
<h2>Run history</h2>${historyList(history)}
<footer>Shepherdy Checkout Gate · verdicts come from rule code and PayPal's own records; AI only proposes fixes and never sees secrets.</footer>
</main></body></html>`;
}
