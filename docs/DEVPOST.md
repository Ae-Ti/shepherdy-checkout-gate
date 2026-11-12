# Devpost submission text

**Project name:** Shepherdy Checkout Gate

**Tagline (max 200 chars):** A release gate for AI-written PayPal checkouts: it attacks your checkout in the PayPal sandbox and says READY only when PayPal's own records agree.

## Inspiration
AI coding tools can add "Pay with PayPal" to an app in minutes. The happy path works and the demo passes, but the
same code often lets the browser choose the price, leaks the secret key into the JavaScript bundle, or confirms a
booking for an order nobody paid. We build Shepherdy, an agent that takes AI-built apps from "works on screen" to
"actually used". Payments are where an AI-built app most often breaks, so we turned our launch-readiness gate into
an open tool focused on PayPal.

## Who it is for
- Founders and small teams who build with AI coding tools and take PayPal payments, but cannot review payment code.
- Agencies and freelancers who ship AI-built client sites and need proof the checkout held before handover.
- PayPal's developer ecosystem: fewer broken integrations in production, and failure paths tested on every change.

Why now: about 1 in 5 of ~130,000 sites published from vibe-coding platforms leaked at least one secret (RedHunt
Labs); an AI tool put a payment secret key in client-side JavaScript and an attacker charged 175 customers $500 each
(Towards AI); AI-generated code shipped without sandbox testing broke a payment system for a month (GetDevDone).
Links are in the README.

## What it does
Shepherdy Checkout Gate sits in front of a merge or deploy and runs 14 checks against a Next.js app with a PayPal
checkout. Instead of guessing from code, it asks PayPal:
- it sends `0.01` for a `120.00` booking and reads the order amount from PayPal (A1);
- it tries to capture an unapproved order, a made-up order, and another buyer's approved order (A2–A4);
- it makes a real sandbox payment and requires PayPal's record to say COMPLETED at the server price before the
  booking may be paid (E1);
- it makes PayPal decline the payment with sandbox negative testing and checks the buyer can retry (A6);
- it retries the capture and counts PayPal's captures (A5);
- it searches the built browser files for the secret's exact value, checks `NEXT_PUBLIC_` and `next.config` leaks,
  committed `.env` files and git history, and keeps blocking until a leaked key is rotated (S1–S3).

It comes as a complete loop: a playbook for coding agents, the gate CLI, a GitHub Actions workflow that blocks
risky pull requests, a fix agent, and a release report published on the site at `/gate` with a "Checkout
verified" badge on every page.

The verdict is READY, BLOCKED or NOT PROVEN, decided by rule code. When it is BLOCKED, a fix agent built on the
Claude Agent SDK gets a brief with the failed rule IDs and PayPal's evidence, edits only source files in a copy that
contains no secrets, and the gate runs again. The agent cannot edit the gate or the playbook; if it tries, the files
are restored and the round is blocked.

## How we built it
- Next.js 16 booking site with PayPal **Orders v2** (OAuth client credentials, server-only module) and the
  **JS SDK v6** (`@paypal/react-paypal-js/sdk-v6`, `PayPalOneTimePaymentButton`, sandbox).
- Capture flow: GET order (reference_id, amount, APPROVED) → capture with a fixed `PayPal-Request-Id` → GET again →
  paid only on COMPLETED.
- Gate in plain Node.js with its own read-only PayPal client; Playwright for the sandbox payment, with request
  interception for the A4/A6 attacks; sandbox negative testing via `PayPal-Mock-Response`.
- A playbook of PayPal rules (PP-00…PP-09) that coding agents follow and the report links back to.
- Fix loop on the Claude Agent SDK with file-only tools, a secret-free work copy and integrity hashes.
- Postgres or file storage for bookings, deployed on Vercel.
- The booking site's PayPal integration itself was written by an AI coding agent following the playbook, and then
  had to pass the gate.

## Challenges we ran into
- PayPal's sandbox rarely fails on its own, so failure paths are hard to test; negative testing headers solved it,
  but a simulated decline must never be replayed as the real capture, so it uses its own request id.
- Telling "PayPal sandbox is down / setup is wrong" apart from "your code is wrong", so the gate never gives a
  false READY or a false BLOCKED.
- Keeping secrets away from the AI end to end: work copies without `.env`, a filtered environment, masked reports.

## Accomplishments that we're proud of
- Verdicts grounded in PayPal's own records, not in pattern matching.
- An agent loop where the agent fixes but cannot grade itself.
- A rotation lock: deleting a leaked key from code is not enough to pass.

## What we learned
Most payment bugs written by AI are business-logic bugs that look fine in code review and only show up when you
attack the flow and read the payment provider's records.

## What's next
GitHub Action, more PayPal flows (subscriptions, refunds, webhooks with signature checks), and the same gate inside
Shepherdy for other payment providers.

## Built with
paypal-orders-v2, paypal-js-sdk-v6, react-paypal-js, next.js, react, typescript, node.js, playwright,
claude-agent-sdk, claude, postgres, vercel

## Testing instructions (for judges)
- Live site: <DEPLOYED_URL> (release report at <DEPLOYED_URL>/gate)
- PayPal sandbox buyer (fake money): email <SANDBOX_BUYER_EMAIL>, password <SANDBOX_BUYER_PASSWORD>
- Book any experience → "Continue to payment" → PayPal button → log in with the sandbox buyer → approve.
- To run the gate: see README → "Run it" (your own free PayPal sandbox app; no Anthropic key needed with `LLM_MODE=fake`).
- Video: <YOUTUBE_URL> · Code: <GITHUB_URL>
