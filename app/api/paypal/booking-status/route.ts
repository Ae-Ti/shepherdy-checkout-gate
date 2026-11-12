import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { errorJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?bookingId= -> { bookingId, status, amount, currency, paypalOrderId }
export async function GET(req: Request) {
  const bookingId = new URL(req.url).searchParams.get("bookingId") ?? "";
  const booking = await getStore().get(bookingId);
  if (!booking) return errorJson(404, "BOOKING_NOT_FOUND");
  return NextResponse.json({
    bookingId: booking.id,
    status: booking.status,
    amount: booking.amount,
    currency: booking.currency,
    paypalOrderId: booking.paypalOrderId,
  });
}
