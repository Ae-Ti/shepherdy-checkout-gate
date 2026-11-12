import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { isSandbox, paypalBase } from "@/lib/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let store = "unavailable";
  try {
    store = getStore().kind;
  } catch {
    // reported below; the gate's doctor step turns this into INCONCLUSIVE
  }
  return NextResponse.json({
    ok: store !== "unavailable",
    store,
    paypalHost: new URL(paypalBase()).host,
    sandbox: isSandbox(),
    mockSwitch: Boolean(process.env.GATE_MOCK_TOKEN),
  });
}
