import "server-only";
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { PayPalError, isSandbox } from "./paypal";

export function errorJson(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

export function fromPayPalError(e: unknown) {
  if (e instanceof PayPalError) {
    const status = e.status === 404 ? 404 : e.status >= 500 ? 502 : e.status === 401 ? 502 : 422;
    return errorJson(status, e.issue, { debugId: e.debugId ?? null });
  }
  console.error("checkout error", e instanceof Error ? e.message : "unknown");
  return errorJson(500, "INTERNAL_ERROR");
}

// The gate can ask the server to simulate a declined funding source (A6), but only in the sandbox
// and only with the shared GATE_MOCK_TOKEN. Without the token this always returns undefined.
const ALLOWED_MOCKS = new Set(["INSTRUMENT_DECLINED"]);

export function gateMockCode(req: Request): string | undefined {
  const token = process.env.GATE_MOCK_TOKEN;
  if (!token || !isSandbox()) return undefined;
  const given = Buffer.from(req.headers.get("x-gate-mock-token") ?? "");
  const want = Buffer.from(token);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return undefined;
  const code = req.headers.get("x-gate-mock") ?? "";
  return ALLOWED_MOCKS.has(code) ? code : undefined;
}
