import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { createOrder } from "@/lib/paypal";
import { errorJson, fromPayPalError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { bookingId } -> { orderId }
// Only the booking id is read from the browser. The amount comes from the booking record (PP-01).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const store = getStore();
  const booking = await store.get(String(body.bookingId ?? ""));
  if (!booking) return errorJson(404, "BOOKING_NOT_FOUND");
  if (booking.status === "paid") return errorJson(409, "ALREADY_PAID");

  const amount = booking.amount;
  try {
    const order = await createOrder({
      bookingId: booking.id,
      amount,
      currency: booking.currency,
      description: `${booking.title} on ${booking.date}`,
    });
    await store.update(booking.id, { paypalOrderId: order.id });
    return NextResponse.json({ orderId: order.id });
  } catch (e) {
    return fromPayPalError(e);
  }
}
