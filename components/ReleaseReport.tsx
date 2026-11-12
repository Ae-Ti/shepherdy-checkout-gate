"use client";

import { useEffect, useState } from "react";

type Evidence = { label: string; expected?: string; actual?: string; ok?: boolean };
type Check = {
  id: string;
  rule: string;
  title: string;
  group: string;
  status: "pass" | "blocked" | "inconclusive" | "skipped";
  summary: string;
  evidence?: Evidence[];
  debugIds?: string[];
};
type Report = {
  verdict: "READY" | "BLOCKED" | "INCONCLUSIVE";
  commit?: string;
  branch?: string;
  subject?: string;
  finishedAt?: string;
  target?: string;
  mode?: string;
  checks: Check[];
};
type HistoryEntry = {
  at: string;
  kind: "gate" | "fix" | "tamper";
  verdict?: string;
  commit?: string;
  subject?: string;
  failed?: string[];
  agent?: string;
  files?: string[];
  summary?: string;
};

const LABEL: Record<Check["status"], string> = { pass: "PASS", blocked: "BLOCKED", inconclusive: "NOT PROVEN", skipped: "SKIPPED" };
const VERDICT_TEXT = {
  READY: "Every check passed against PayPal's own records.",
  BLOCKED: "At least one check failed. This commit must not ship.",
  INCONCLUSIVE: "Nothing failed, but not everything could be proven yet.",
};
const GROUPS = ["Setup", "Secrets", "Attacks", "End to end"];

type Loaded = { report: Report; history: HistoryEntry[] } | "missing" | null;

function useRelease(): Loaded {
  const [data, setData] = useState<Loaded>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([fetch("/release/report.json", { cache: "no-store" }), fetch("/release/history.json", { cache: "no-store" })])
      .then(async ([r, h]) => {
        if (!alive) return;
        if (!r.ok) return setData("missing");
        setData({ report: await r.json(), history: h.ok ? await h.json() : [] });
      })
      .catch(() => alive && setData("missing"));
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

function pick(c: Check | undefined, label: string) {
  return c?.evidence?.find((e) => e.label === label);
}

export function VerifiedBadge() {
  const data = useRelease();
  if (!data || data === "missing") return null;
  const { report } = data;
  const passed = report.checks.filter((c) => c.status === "pass").length;
  return (
    <a className={`verified ${report.verdict}`} href="/gate" title="See the release report">
      <span aria-hidden>{report.verdict === "READY" ? "✓" : report.verdict === "BLOCKED" ? "✕" : "?"}</span>
      Checkout {report.verdict === "READY" ? "verified" : report.verdict.toLowerCase()} · {passed}/{report.checks.length} checks
    </a>
  );
}

export default function ReleaseReport() {
  const data = useRelease();
  if (data === null) return <p className="muted">Loading the latest release report…</p>;
  if (data === "missing") {
    return (
      <div className="notice warn">
        No gate run has been published for this deployment yet. Run <code>npm run gate</code>, then{" "}
        <code>npm run gate:publish</code>.
      </div>
    );
  }
  const { report, history } = data;
  const a1 = report.checks.find((c) => c.id === "A1");
  const e1 = report.checks.find((c) => c.id === "E1");
  const sent = pick(a1, "Browser sent");
  const recorded = pick(a1, "PayPal recorded");
  const capture = pick(e1, "PayPal capture status");
  const passed = report.checks.filter((c) => c.status === "pass").length;

  return (
    <div className="release">
      <section className={`verdict ${report.verdict}`}>
        <h2>{report.verdict}</h2>
        <p>{VERDICT_TEXT[report.verdict]}</p>
        <p className="verdict-meta">
          Commit <code>{report.commit ?? "n/a"}</code> · {report.subject} · {report.finishedAt?.slice(0, 16).replace("T", " ")} UTC
        </p>
      </section>

      <section className="kpis">
        {sent && recorded && (
          <>
            <div className="kpi">
              <span>Browser asked to pay</span>
              <b>{sent.actual}</b>
            </div>
            <div className={`kpi ${recorded.ok ? "good" : "bad"}`}>
              <span>PayPal recorded</span>
              <b>{recorded.actual}</b>
              <small>expected {recorded.expected}</small>
            </div>
          </>
        )}
        {capture && (
          <div className={`kpi ${capture.ok ? "good" : "bad"}`}>
            <span>Sandbox payment, per PayPal</span>
            <b>{capture.actual}</b>
          </div>
        )}
        <div className="kpi">
          <span>Checks passed</span>
          <b>
            {passed}/{report.checks.length}
          </b>
        </div>
      </section>

      {GROUPS.map((g) => {
        const checks = report.checks.filter((c) => c.group === g);
        if (!checks.length) return null;
        return (
          <section key={g}>
            <h3 className="group">{g}</h3>
            {checks.map((c) => (
              <details key={c.id} className={`check ${c.status}`} open={c.status === "blocked"}>
                <summary>
                  <span className={`chip ${c.status}`}>{LABEL[c.status]}</span>
                  <strong>{c.id}</strong>
                  <span className="rule">{c.rule}</span>
                  <span>{c.title}</span>
                </summary>
                <p>{c.summary}</p>
                {!!c.evidence?.length && (
                  <table className="ev">
                    <thead>
                      <tr>
                        <th>Evidence</th>
                        <th>Expected</th>
                        <th>Actual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.evidence.map((e, i) => (
                        <tr key={i} className={e.ok === false ? "bad" : e.ok ? "good" : ""}>
                          <td>{e.label}</td>
                          <td>{e.expected ?? ""}</td>
                          <td>
                            <code>{e.actual}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {!!c.debugIds?.length && <p className="muted">PayPal-Debug-Id: {c.debugIds.join(", ")}</p>}
              </details>
            ))}
          </section>
        );
      })}

      {!!history.length && (
        <section>
          <h3 className="group">Run history</h3>
          <ol className="timeline">
            {[...history].reverse().map((h, i) => (
              <li key={i} className={h.kind === "fix" ? "fix" : h.kind === "tamper" ? "BLOCKED" : h.verdict}>
                {h.kind === "fix" ? (
                  <>
                    <span className="chip fix">AGENT FIX</span> {h.agent} changed {(h.files ?? []).join(", ")}
                    {h.summary && <div className="muted">{h.summary}</div>}
                  </>
                ) : h.kind === "tamper" ? (
                  <>
                    <span className="chip blocked">TAMPER</span> {h.summary}
                  </>
                ) : (
                  <>
                    <span className={`chip ${h.verdict === "READY" ? "pass" : h.verdict === "BLOCKED" ? "blocked" : "inconclusive"}`}>
                      {h.verdict}
                    </span>{" "}
                    <code>{h.commit}</code> {h.subject}
                    {!!h.failed?.length && <span className="muted"> · failed {h.failed.join(", ")}</span>}
                  </>
                )}
                <time>{h.at.slice(0, 16).replace("T", " ")} UTC</time>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
