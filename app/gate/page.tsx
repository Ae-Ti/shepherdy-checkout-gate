import type { Metadata } from "next";
import ReleaseReport from "@/components/ReleaseReport";

export const metadata: Metadata = {
  title: "Release report — Shepherdy Checkout Gate",
  description: "How this site's PayPal checkout was attacked in the sandbox and verified against PayPal's own records.",
};

const STEPS = [
  {
    n: "1",
    title: "An AI agent writes the checkout",
    text: "Any coding agent adds or changes the PayPal integration, following a playbook of PayPal rules (PP-00 to PP-09).",
  },
  {
    n: "2",
    title: "The gate attacks it and asks PayPal",
    text: "It pays 0.01 for a $120 booking, captures unapproved, fake and borrowed orders, simulates a decline, makes a real sandbox payment, and reads every result from PayPal's records.",
  },
  {
    n: "3",
    title: "BLOCKED gets fixed, READY ships",
    text: "On BLOCKED, a fix agent receives the failed rule IDs and PayPal's evidence, edits only source files and never sees secrets. It cannot edit the gate, so it cannot pass itself.",
  },
];

const AUDIENCE = [
  {
    title: "Founders and small teams building with AI tools",
    text: "They can get a PayPal button working in minutes but cannot review payment code. The gate checks the parts that lose money.",
  },
  {
    title: "Agencies and freelancers shipping AI-built sites",
    text: "A READY report on the exact commit is proof for the client that the checkout was attacked and held before handover.",
  },
  {
    title: "PayPal and its developer ecosystem",
    text: "Fewer broken integrations reach production, and failure paths that are hard to reproduce in the sandbox get tested on every change.",
  },
];

const WHY = [
  {
    fact: "About 1 in 5 of ~130,000 sites published from vibe-coding platforms leaked at least one secret.",
    source: "RedHunt Labs, Project Resonance",
    href: "https://redhuntlabs.com/blog/echoes-of-ai-exposure-thousands-of-secrets-leaking-through-vibe-coded-sites-wave-15-project-resonance/",
  },
  {
    fact: "An AI tool put a payment secret key in client-side JavaScript; an attacker used it to charge 175 stored customers $500 each.",
    source: "Towards AI, 7 real incidents",
    href: "https://pub.towardsai.net/vibe-coding-didnt-break-these-startups-vibe-deploying-did-3bdd8d0428c4",
  },
  {
    fact: "AI-generated code shipped without sandbox testing broke a working payment system for about a month.",
    source: "GetDevDone case study",
    href: "https://getdevdone.com/blog/the-vibe-coding-tax-a-payment-integration-broken-by-ai-restored-by-engineering.html",
  },
  {
    fact: "An agent can make a payment flow run end to end, but it cannot know the business rules the money must obey unless someone tells it.",
    source: "Stripe developer blog",
    href: "https://stripe.dev/blog/helping-ai-built-payment-integration-understand-business-intent",
  },
  {
    fact: "PayPal's own engineers report developers and merchants dropping off during sandbox integration flows.",
    source: "PayPal Tech blog",
    href: "https://medium.com/paypal-tech/how-paypal-is-solving-merchant-dropout-issues-with-sandbox-integrations-bbde98f588fc",
  },
];

export default function GatePage() {
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Shepherdy Checkout Gate</p>
        <h1>The agent fixes. PayPal proves. The gate decides.</h1>
        <p>
          This site&apos;s checkout was written with an AI coding tool. Before it could ship, a release gate attacked it in
          the PayPal sandbox and compared every result with PayPal&apos;s own records. This is the latest report.
        </p>
      </section>

      <ReleaseReport />

      <section className="steps">
        {STEPS.map((s) => (
          <article key={s.n} className="card">
            <span className="step-n">{s.n}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </article>
        ))}
      </section>

      <section>
        <h2 className="section-title">Who it is for</h2>
        <div className="grid">
          {AUDIENCE.map((a) => (
            <article key={a.title} className="card">
              <h3>{a.title}</h3>
              <p>{a.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2 className="section-title">Why it matters</h2>
        <ul className="facts">
          {WHY.map((w) => (
            <li key={w.href}>
              <p>{w.fact}</p>
              <a href={w.href} target="_blank" rel="noreferrer">
                {w.source} ↗
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2 className="section-title" style={{ marginTop: 0 }}>
          Put it in front of your own checkout
        </h2>
        <pre className="code">{`npm run gate -- --manual      # 14 checks against the PayPal sandbox
npm run loop -- --manual      # BLOCKED → fix agent → gate again
npm run gate:static           # in CI on every pull request (see .github/workflows)`}</pre>
        <p className="muted">
          Exit code 0 means READY, 1 BLOCKED, 2 not proven. Open source under the MIT license.
        </p>
      </section>
    </>
  );
}
