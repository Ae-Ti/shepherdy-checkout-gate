import "server-only";
import crypto from "node:crypto";

// Server-only PayPal REST client (Orders v2, OAuth client credentials).
// PAYPAL_CLIENT_SECRET is read here and nowhere else (playbook PP-06).

const SANDBOX = "https://api-m.sandbox.paypal.com";

export function paypalBase(): string {
  return (process.env.PAYPAL_API_BASE || SANDBOX).replace(/\/+$/, "");
}

export function isSandbox(): boolean {
  return paypalBase() === SANDBOX;
}

export class PayPalError extends Error {
  constructor(
    public status: number,
    public issue: string,
    message: string,
    public debugId?: string,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

type Money = { currency_code: string; value: string };
export type PayPalCapture = { id: string; status: string; amount?: Money };
export type PayPalOrder = {
  id: string;
  status: string;
  purchase_units?: {
    reference_id?: string;
    amount?: Money;
    payments?: { captures?: PayPalCapture[] };
  }[];
};

// PayPal order IDs are short uppercase alphanumeric strings (17 characters today).
export const ORDER_ID = /^[A-Z0-9]{8,30}$/;

function credentials() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) {
    throw new PayPalError(500, "MISSING_CREDENTIALS", "PayPal credentials are not configured on the server.");
  }
  return { id, secret };
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 200) };
  }
}

async function oauth(body: string): Promise<{ access_token: string; expires_in?: number }> {
  const { id, secret } = credentials();
  const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  const json = await readJson(res);
  if (!res.ok || !json.access_token) {
    throw new PayPalError(
      res.status,
      json.error || "AUTH_FAILED",
      "PayPal rejected the server credentials.",
      res.headers.get("paypal-debug-id") ?? undefined,
    );
  }
  return json;
}

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const json = await oauth("grant_type=client_credentials");
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 300) * 1000 };
  return cached.token;
}

// Browser-safe token for the JS SDK v6. It cannot move money on its own.
export async function browserClientToken(): Promise<string> {
  const json = await oauth("grant_type=client_credentials&response_type=client_token&intent=sdk_init");
  return json.access_token;
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; requestId?: string; mock?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
  if (opts.mock) headers["PayPal-Mock-Response"] = JSON.stringify({ mock_application_codes: opts.mock });
  const res = await fetch(`${paypalBase()}${path}`, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
    cache: "no-store",
  });
  const json = await readJson(res);
  if (!res.ok) {
    const issue = json?.details?.[0]?.issue || json?.name || `HTTP_${res.status}`;
    throw new PayPalError(
      res.status,
      issue,
      json?.message || "PayPal request failed.",
      json?.debug_id || res.headers.get("paypal-debug-id") || undefined,
    );
  }
  return json as T;
}

export function createOrder(input: { bookingId: string; amount: string; currency: string; description: string }) {
  return call<PayPalOrder>("POST", "/v2/checkout/orders", {
    requestId: `create-${input.bookingId}-${crypto.randomUUID()}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.bookingId, // ties the PayPal order to exactly one booking (PP-02)
          custom_id: input.bookingId,
          description: input.description.slice(0, 127),
          amount: { currency_code: input.currency, value: input.amount },
        },
      ],
    },
  });
}

export function getOrder(orderId: string) {
  return call<PayPalOrder>("GET", `/v2/checkout/orders/${orderId}`);
}

export function captureOrder(orderId: string, opts: { requestId: string; mock?: string }) {
  return call<PayPalOrder>("POST", `/v2/checkout/orders/${orderId}/capture`, opts);
}

export function firstUnit(order: PayPalOrder) {
  return order.purchase_units?.[0];
}

export function captures(order: PayPalOrder): PayPalCapture[] {
  return firstUnit(order)?.payments?.captures ?? [];
}

export function sameMoney(m: Money | undefined, expected: { amount: string; currency: string }): boolean {
  if (!m) return false;
  return m.currency_code === expected.currency && Number(m.value).toFixed(2) === Number(expected.amount).toFixed(2);
}
