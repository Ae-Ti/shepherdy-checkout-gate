# Shepherdy Checkout Gate

**A release gate for AI-written PayPal checkouts.** It attacks your checkout in the PayPal sandbox and says
`READY` only when PayPal's own records agree. When it says `BLOCKED`, a fix agent reads the evidence, patches the
code, and the gate runs again.

> The agent fixes. PayPal proves. The gate decides.

AI coding tools can add "Pay with PayPal" in minutes. The happy path works, the demo passes, and the site ships
with a checkout where the browser chooses the price, the secret key sits in the JavaScript bundle, or a booking is
confirmed for an order nobody paid. Scanners read code and guess. This gate asks PayPal.

![flow](https://img.shields.io/badge/PayPal-Orders%20v2%20%2B%20JS%20SDK%20v6-003087) ![license](https://img.shields.io/badge/license-MIT-green)

---

## Who it is for, and why it matters

- **Founders and small teams building with AI coding tools.** They can get a PayPal button working in minutes but
  cannot review payment code. The gate checks the parts that lose money.
- **Agencies and freelancers shipping AI-built sites.** A READY report on the exact commit is proof for the client
  that the checkout was attacked and held before handover.
- **PayPal's developer ecosystem.** Fewer broken integrations reach production, and failure paths that are hard to
  reproduce in the sandbox get tested on every change.

The problem is not hypothetical:

- About 1 in 5 of ~130,000 sites published from vibe-coding platforms leaked at least one secret
  ([RedHunt Labs](https://redhuntlabs.com/blog/echoes-of-ai-exposure-thousands-of-secrets-leaking-through-vibe-coded-sites-wave-15-project-resonance/)).
- An AI tool put a payment secret key in client-side JavaScript; an attacker charged 175 stored customers $500 each
  ([Towards AI](https://pub.towardsai.net/vibe-coding-didnt-break-these-startups-vibe-deploying-did-3bdd8d0428c4)).
- AI-generated code shipped without sandbox testing broke a working payment system for about a month
  ([GetDevDone](https://getdevdone.com/blog/the-vibe-coding-tax-a-payment-integration-broken-by-ai-restored-by-engineering.html)).
- An agent can make a payment flow run end to end, but cannot know the business rules the money must obey unless
  someone tells it ([Stripe developer blog](https://stripe.dev/blog/helping-ai-built-payment-integration-understand-business-intent)).
- PayPal's own engineers describe developers and merchants dropping off during sandbox integration flows
  ([PayPal Tech](https://medium.com/paypal-tech/how-paypal-is-solving-merchant-dropout-issues-with-sandbox-integrations-bbde98f588fc)).

## The product, end to end

1. **Playbook** for any coding agent (`playbook/paypal-checkout.md`, rules PP-00…PP-09).
2. **Gate** you run locally or before a deploy: `npm run gate` (14 checks, exit 0/1/2).
3. **CI**: `.github/workflows/checkout-gate.yml` runs the static checks on every pull request and blocks the merge.
4. **Fix loop**: `npm run loop` turns a BLOCKED report into a patch from the fix agent, then gates again.
5. **Release report on the site**: `npm run gate:publish` publishes the latest real run to `/gate`, and every page
   shows a "Checkout verified" badge that links to it.

## What it does

The repo contains two things:

1. **Lumen Trails**, a small Next.js booking site (an "AI-built app") with a PayPal one-time payment.
2. **The gate** (`gate/`), the **playbook** (`playbook/`) and the **fix loop** (`agent/`).

The gate runs 14 checks and turns them into one verdict with plain rule code:

| Check | Rule | What the gate actually does |
|---|---|---|
| D1–D4 | PP-08 | Credentials present, sandbox only (refuses live PayPal), PayPal answering, app up. Setup problems give `INCONCLUSIVE`, never a false `READY` or `BLOCKED`. |
| S1 | PP-06 | Searches the **built browser files** (`.next/static`, prerendered HTML/RSC) for the secret's exact value. |
| S2 | PP-06 | `NEXT_PUBLIC_*SECRET*`, secrets in `next.config` `env`, client components touching the secret, server modules without `import "server-only"`. |
| S3 | PP-07 | Committed `.env` files, the secret value anywhere in git history, and a **rotation lock**: a leaked secret keeps blocking until its value changes. |
| A1 | PP-01 | Sends `amount: 0.01` for a $120 booking, then **asks PayPal** what the order amount is. |
| A2 | PP-02 | Captures an order nobody approved. |
| A3 | PP-02 | Captures a made-up order ID. |
| E1 | PP-04 | A real sandbox buyer pays (Playwright, or `--manual` approval in the popup). PayPal's record must say `COMPLETED` at the server price, and only then may the booking be `paid`. |
| A4 | PP-02 | During E1, intercepts the page's capture request and first tries to attach the approved order to **another** booking. |
| A6 | PP-05 | During E1, makes PayPal decline the payment with sandbox negative testing (`PayPal-Mock-Response: INSTRUMENT_DECLINED`). The booking must stay unpaid and the buyer must be able to retry. |
| A5 | PP-03 | After E1, sends the capture again. PayPal must still hold exactly one capture. |

`BLOCKED` exits 1, `INCONCLUSIVE` exits 2, `READY` exits 0, so it can sit in front of any merge or deploy.
Every run writes `.gate/report.html`: each check with its evidence next to what PayPal recorded, PayPal-Debug-Ids
for support tickets, and a run history (`BLOCKED → agent fix → READY`).

## How PayPal is used

- **Orders v2 REST API** with OAuth client credentials, server-side only (`lib/paypal.ts`, `import "server-only"`).
- `POST /api/paypal/create-order {bookingId} → {orderId}`: the amount comes from the booking record; whatever the
  browser sends is ignored; `reference_id = bookingId` ties the order to one booking.
- `POST /api/paypal/capture-order {orderId, bookingId}`: GET the order (reference_id, amount, `APPROVED`) →
  capture with a fixed `PayPal-Request-Id` (retries never double-charge) → GET again → `paid` only on
  `COMPLETED` with the right amount; `PENDING` stays unconfirmed; `INSTRUMENT_DECLINED` returns 402 + retry.
- `GET /api/paypal/booking-status?bookingId=` for the gate.
- **JS SDK v6** through `@paypal/react-paypal-js/sdk-v6`: `PayPalProvider` + `PayPalOneTimePaymentButton`,
  `environment="sandbox"`. The public client ID is passed from a server component; the secret never leaves the server.
- **The gate talks to PayPal itself** with its own read-only client, so it never trusts the app's word.
- **Sandbox negative testing** (`PayPal-Mock-Response`) to prove failure handling, which developers often cannot
  reproduce in the sandbox.
- USD, because PayPal does not support KRW.

## How AI is used

- **The integration itself was written by an AI coding agent** (Claude, via Claude Code) following
  `playbook/paypal-checkout.md`, and then had to pass the gate like any other commit.
- **The fix agent** (`agent/fixer.mjs`) is built on the **Claude Agent SDK** (`claude-sonnet-5-5` by default).
  It gets a brief made from the gate report (check IDs, playbook rule IDs, PayPal evidence) and may only use
  file tools (`Read`, `Glob`, `Grep`, `Edit`, `Write`); no shell, no web.
- **The agent never sees secrets.** It works in a throwaway copy of `app/`, `components/`, `lib/` and
  `next.config.ts` with no `.env` files and an environment without PayPal keys. Reports and briefs are masked.
- **The agent cannot grade itself.** Verdicts come from rule code only. The gate and playbook run from a copy
  taken before the agent starts; if the agent changes them, the files are restored and the round is `BLOCKED`.
- Any other agent can plug in with `AGENT_CMD` (it receives the brief path in `$FIX_BRIEF`).
- `LLM_MODE=fake` restores the last `READY` version of the flagged files without AI, for offline tests and demos.

## Architecture

```mermaid
flowchart LR
  dev[AI coding agent / developer] -->|commit| repo[(git)]
  repo --> build[next build]
  build --> gate{Shepherdy Checkout Gate}
  gate -->|S1-S3 static| bundle[(browser bundle, source, git history)]
  gate -->|A1-A6 attacks| app[Booking site API]
  gate -->|E1 sandbox payment| pw[Playwright + sandbox buyer]
  app -->|Orders v2| paypal[(PayPal sandbox)]
  gate -->|reads orders directly| paypal
  gate -->|READY| ship[merge / deploy]
  gate -->|BLOCKED + evidence| brief[fix brief: rule IDs + PayPal evidence]
  brief --> fixer[Claude Agent SDK fix agent<br/>file tools only, no secrets]
  fixer -->|patch, integrity-checked| repo
```

```
app/                     booking site (Next.js App Router) and API routes
components/              PayPalCheckout (sdk-v6 button), BookForm
lib/                     paypal.ts (server-only REST client), store.ts (file or Postgres), catalog.ts (prices)
gate/run.mjs             the gate CLI; gate/lib/* checks, verdict, HTML report
agent/loop.mjs           build → start → gate → fix → integrity check → commit → gate again
playbook/                PayPal rules (PP-00…PP-09) for coding agents; rules.json feeds the fix brief
demo/risky-checkout.patch  the risky commit used in the demo video
tests/                   offline tests (npm test)
```

## Run it

Requirements: Node 20.9+, a free PayPal Developer account, and Chromium for Playwright (installed below).

**1. Install.**

```bash
git clone https://github.com/Ae-Ti/shepherdy-checkout-gate.git
cd shepherdy-checkout-gate
npm ci
npx playwright install chromium
cp .env.example .env.local
```

**2. Fill `.env.local`.** In the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/):

- Apps & Credentials → Sandbox → Create App, then copy `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
- Testing Tools → Sandbox Accounts, then open the **Personal** account PayPal created for you and copy its email
  and password into `PAYPAL_SANDBOX_BUYER_EMAIL` and `PAYPAL_SANDBOX_BUYER_PASSWORD`.
- Set `GATE_MOCK_TOKEN` to any long random string.
- Keep `LLM_MODE=fake` unless you want the live Claude fix agent (then set `ANTHROPIC_API_KEY`).

**3. Check that it works offline** (10 tests, no network):

```bash
npm test
```

**4. Start the booking site** on http://127.0.0.1:3000:

```bash
npm run build
npm run start
```

**5. Run the gate** in a second terminal. `--manual` opens a browser so you approve the sandbox payment yourself;
without it the gate tries to log in as the sandbox buyer on its own.

```bash
npm run gate -- --manual
open .gate/report.html
```

**6. Publish the run** to the site's `/gate` page (secrets masked), then open http://127.0.0.1:3000/gate after
the next build:

```bash
npm run gate:publish
```

### The demo: risky commit → BLOCKED → agent fix → READY

Start on `main` with a READY run (step 5 above), which records the last READY commit. Stop the site on :3000
first, because the loop builds and starts its own copy on :3100. Then apply the risky commit and start the loop:

```bash
git switch -c demo/risky-checkout
git apply demo/risky-checkout.patch
git commit -am "feat: faster checkout (send price from the button, debug PayPal key)"
npm run loop -- --manual
```

Round 1 is BLOCKED (S1, S2, A1). The fix agent patches the source, the loop commits `fix(agent): …`, and round 2
is READY after one sandbox approval. If port 3100 is taken, add `--port 3200`. With `LLM_MODE=fake` the same loop
runs without an Anthropic API key: instead of calling Claude, it restores the flagged files from the last READY
commit.

## For judges

- **Live demo, no setup:** https://shepherdy-checkout-gate.vercel.app (Vercel, Neon Postgres, PayPal sandbox). Book any experience and pay with
  the sandbox buyer account from the Devpost testing instructions; all money is fake. `https://shepherdy-checkout-gate.vercel.app/gate` shows the
  release report.
- **The report file:** `public/release/report.json` in this repo is the masked report of the real run shown in
  the video: every check, what PayPal recorded, and the BLOCKED → agent fix → READY history. The site renders it
  at `/gate`.
- **Run everything, about 10 minutes:** follow *Run it* with your own free PayPal sandbox app. PayPal creates the
  sandbox buyer account for you, and all money is fake. You do not need any of my keys.
- **See it block a bad commit:** follow *The demo* above. Judges do not need an Anthropic key: `LLM_MODE=fake`
  runs the whole loop.

## Use it on your own app

The gate runs against any app folder with `--app`. It reads that app's `gate.config.json` and `.env.local`, and
writes the report to `<app>/.gate/` unless you pass `--out`.

### Static checks on any Next.js app (S1–S3)

S1–S3 read the app's build output, its source folders and its git history, so they do not depend on this demo
store. In your app:

1. Put `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_API_BASE=https://api-m.sandbox.paypal.com` in
   `.env.local`. S1 searches the built files for the exact secret value, so it needs the real sandbox secret.
2. Add a `gate.config.json` that lists your source folders, for example `{ "sourceDirs": ["app", "components"] }`.
3. Run `next build`, then run the gate from a clone of this repo:

```bash
node gate/run.mjs --static-only --app /path/to/your-app
```

A leak makes the run BLOCKED and exits 1. A clean run exits 0 with the verdict INCONCLUSIVE, because READY also
needs the attacks and the sandbox payment.

This was checked on a second, separate Next.js app: with a `next.config` that copied the secret into
`NEXT_PUBLIC_PAYPAL_CLIENT_SECRET` and a client component that rendered it, S1 found the secret in 2 browser files,
S2 found 4 places that expose it, and the run was BLOCKED. After the leak was removed and the app rebuilt, S1–S3
passed.

### Attacks and the sandbox payment (A1–A6, E1)

These need the app to follow a small HTTP contract: a pending booking (or order) record that the server prices,
and two PayPal routes keyed by its ID.

| Route key | Default | What the gate sends and expects |
|---|---|---|
| `health` | `/api/health` | `GET` → `{ok: true, sandbox: true}` when the app can store bookings and points at the PayPal sandbox |
| `createBooking` | `/api/bookings` | `POST {experienceId, guestName, email}` → `201 {bookingId}` |
| `createOrder` | `/api/paypal/create-order` | `POST {bookingId}` → `{orderId}` |
| `captureOrder` | `/api/paypal/capture-order` | `POST {orderId, bookingId}` |
| `bookingStatus` | `/api/paypal/booking-status` | `GET ?bookingId=` → `{status}`, where a paid booking says `paid` |
| `bookPage` | `/book/{bookingId}` | the page that renders the PayPal button |

If your routes have other paths, map them in `gate.config.json`; any key you leave out keeps its default:

```json
{
  "experienceId": "your-test-item",
  "expectedAmount": "49.00",
  "routes": { "createOrder": "/api/checkout/order", "bookPage": "/orders/{bookingId}/pay" }
}
```

The request and response shapes still follow the table above. Adapters for apps with other shapes, and for
frameworks other than Next.js, are next.

### Other parts

- **Playbook PP-00…PP-09:** plain Markdown that any coding agent can follow while it writes the integration.
- **Fix loop:** the fixer edits only the folders listed in `agent/fixer.mjs`; any other agent plugs in with
  `AGENT_CMD`.

## Deploy (Vercel)

The live demo at https://shepherdy-checkout-gate.vercel.app runs this way. `vercel.json` selects the Next.js preset. Serverless hosts do not keep local files, so set `DATABASE_URL` to any Postgres (Neon, Supabase pooler, …);
the `bookings` table is created on first use. Environment variables: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
`PAYPAL_API_BASE=https://api-m.sandbox.paypal.com`, `DATABASE_URL`, and optionally `GATE_MOCK_TOKEN` to run the
gate against the deployment: `npm run gate -- --base-url https://<your-app>.vercel.app --manual`.

## Related work

| Tool | What it covers | What this adds |
|---|---|---|
| Gitleaks, TruffleHog | secrets in git | the secret in the **built bundle**, plus a rotation lock |
| @snytch/nextjs | Next.js bundle and `NEXT_PUBLIC_` scanning | PayPal-specific attacks verified against PayPal records |
| Vibe-coding scanners (vibe-shield, Vibeship, …) | static scans + AI fix prompts | fix prompts grounded in PayPal's actual responses; deterministic verdicts the agent cannot edit |
| PayPal Agent Toolkit / MCP server | agents **running** PayPal operations | verifying the checkout an agent **wrote** |
| PayPal Context Plugin, PayPal agent skills | helping agents **write** correct SDK calls | proving the result before release; works with them |

## Built during the submission period

Everything in this repository was written on Nov 12–13, 2026, inside the hackathon window. It is a new, open
module derived from **Shepherdy**, my private launch-agent prototype, which itself was started on Nov 4, 2026
(24 commits, Nov 4–10). The private prototype covers other integrations and services and is not part of this
submission; nothing here depends on it. See `git log` for the day-by-day history of this repository.

## License

[MIT](LICENSE)
