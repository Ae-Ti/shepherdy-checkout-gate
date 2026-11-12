// The gate's own read-only PayPal client. It asks PayPal directly instead of trusting the app.

export const SANDBOX = "https://api-m.sandbox.paypal.com";

export class PayPalHttpError extends Error {
  constructor(status, issue, debugId) {
    super(`PayPal answered ${status} ${issue}`);
    this.status = status;
    this.issue = issue;
    this.debugId = debugId;
  }
}

export function createPayPal(env) {
  const base = (env.PAYPAL_API_BASE || SANDBOX).replace(/\/+$/, "");
  let token = null;
  const debugIds = [];

  async function auth() {
    if (token) return token;
    const res = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(20_000),
    });
    const debugId = res.headers.get("paypal-debug-id");
    if (debugId) debugIds.push(debugId);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) throw new PayPalHttpError(res.status, json.error || "AUTH_FAILED", debugId);
    token = json.access_token;
    return token;
  }

  async function getOrder(orderId) {
    const res = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${await auth()}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    const debugId = res.headers.get("paypal-debug-id");
    if (debugId) debugIds.push(debugId);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new PayPalHttpError(res.status, json?.details?.[0]?.issue || json?.name || `HTTP_${res.status}`, debugId);
    return json;
  }

  return { base, isSandbox: base === SANDBOX, auth, getOrder, debugIds };
}

export function orderFacts(order) {
  const unit = order?.purchase_units?.[0] ?? {};
  const captures = unit?.payments?.captures ?? [];
  return {
    status: order?.status ?? null,
    referenceId: unit.reference_id ?? null,
    amount: unit.amount?.value ?? null,
    currency: unit.amount?.currency_code ?? null,
    captureCount: captures.length,
    captureStatus: captures[0]?.status ?? null,
    captureAmount: captures[0]?.amount?.value ?? null,
  };
}

export function sameAmount(a, b) {
  return a != null && b != null && Number(a).toFixed(2) === Number(b).toFixed(2);
}
