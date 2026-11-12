# PayPal checkout playbook for AI coding agents

This is what a coding agent (Claude Code, Cursor, Codex, or the built-in fix agent) must follow when it adds
PayPal one-time payments to a Next.js app. Every rule has an ID. The gate checks each rule against PayPal's own
records, and its report points back to these IDs, so the agent can read exactly which rule it broke.

The agent writes code. **The gate decides.** The agent never sees secrets and cannot edit this playbook or the gate.

## Shape of the integration

| Piece | Where | Rule |
|---|---|---|
| Server PayPal client (OAuth client credentials, Orders v2) | `lib/paypal.ts` with `import "server-only"` | PP-06, PP-08 |
| `POST /api/paypal/create-order { bookingId } → { orderId }` | price from the booking record, `reference_id = bookingId` | PP-01, PP-09 |
| `POST /api/paypal/capture-order { orderId, bookingId }` | verify → capture with fixed request id → re-read → mark paid | PP-02, PP-03, PP-04, PP-05 |
| `GET /api/paypal/booking-status?bookingId=` | `{ bookingId, status }` for the gate | PP-04 |
| Button | `@paypal/react-paypal-js/sdk-v6`: `PayPalProvider` + `PayPalOneTimePaymentButton`, `environment="sandbox"` | PP-08 |
| Success marker | `[data-testid="paypal-payment-success"][data-order-id]` | PP-04 |

<a id="pp-00"></a>
## PP-00 · The app builds
`npm run build` must succeed. A commit that does not build never ships.

<a id="pp-01"></a>
## PP-01 · The price comes only from the server
`create-order` reads the booking record and ignores any `amount`, `value`, `price` or `currency` the browser sends.
The PayPal order amount must equal the booking amount.
*Gate check A1 sends 0.01 for a 120.00 booking and asks PayPal what it recorded.*

<a id="pp-02"></a>
## PP-02 · Capture only the right, approved order
Before capturing, `GET /v2/checkout/orders/{id}` and check:
1. `purchase_units[0].reference_id` equals this booking id,
2. the amount equals the booking amount,
3. the status is `APPROVED`.

Reject anything else and leave the booking unpaid.
*Checks A2 (capture before approval), A3 (made-up order id), A4 (another buyer's approved order).*

<a id="pp-03"></a>
## PP-03 · Retries never charge twice
Capture with a fixed `PayPal-Request-Id` per booking and order, for example `capture-<bookingId>-<orderId>`.
If PayPal says the order is already captured, re-read it and reconcile instead of failing.
*Check A5 sends the capture again and counts PayPal's captures.*

<a id="pp-04"></a>
## PP-04 · Paid means PayPal says COMPLETED
Mark a booking paid only after reading the order from PayPal again and seeing status `COMPLETED` with a
`COMPLETED` capture for the booking amount. A `PENDING` capture is not paid. Do not rely on webhooks or on the
capture response alone.
*Check E1 makes a real sandbox payment and compares PayPal's record with the booking.*

<a id="pp-05"></a>
## PP-05 · A declined payment can be retried
If PayPal answers `INSTRUMENT_DECLINED`, keep the booking unpaid and return HTTP 402 with
`{ "error": "INSTRUMENT_DECLINED", "retry": true }` so the buyer can choose another way to pay.
*Check A6 uses PayPal's sandbox negative testing header (`PayPal-Mock-Response`) to make PayPal decline.*

<a id="pp-06"></a>
## PP-06 · The secret never reaches the browser
`PAYPAL_CLIENT_SECRET` lives only in server env. Never prefix it with `NEXT_PUBLIC_`, never put it in
`next.config` `env`, never read it in a `"use client"` file, and add `import "server-only"` to every module that
reads it. The public client ID may be passed down from a server component.
*Checks S1 (built browser files) and S2 (source).*

<a id="pp-07"></a>
## PP-07 · Secrets stay out of git, and leaked ones are rotated
Never commit `.env` files or secret values. A secret that ever reached git history must be rotated in the PayPal
Developer Dashboard. Deleting it from code is not enough, so the gate keeps blocking until the value changes.
*Check S3.*

<a id="pp-08"></a>
## PP-08 · Sandbox only
Development, the gate and the fix agent use `https://api-m.sandbox.paypal.com` and the JS SDK with
`environment="sandbox"`. The gate refuses to run against live PayPal.
*Checks D1–D4.*

<a id="pp-09"></a>
## PP-09 · USD
Charge in USD. PayPal does not support KRW.
