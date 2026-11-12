import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import {
  ORDER_ID,
  PayPalError,
  captureOrder,
  captures,
  firstUnit,
  getOrder,
  sameMoney,
  type PayPalOrder,
} from "@/lib/paypal";
import { errorJson, fromPayPalError, gateMockCode } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { orderId, bookingId }
// 1) look the order up at PayPal: it must belong to this booking, carry the server price, and be APPROVED
// 2) capture with a fixed PayPal-Request-Id so a retry can never charge twice
// 3) look the order up again and mark the booking paid only when PayPal says COMPLETED with the right amount
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const orderId = String(body.orderId ?? "");
  const bookingId = String(body.bookingId ?? "");
  const store = getStore();

  const booking = await store.get(bookingId);
  if (!booking) return errorJson(404, "BOOKING_NOT_FOUND");
  if (!ORDER_ID.test(orderId)) return errorJson(400, "INVALID_ORDER_ID");

  let order: PayPalOrder;
  try {
    order = await getOrder(orderId);
  } catch (e) {
    return fromPayPalError(e);
  }

  // PP-02: the order must be the one created for this booking, at the server price.
  const unit = firstUnit(order);
  if (unit?.reference_id !== booking.id) return errorJson(409, "ORDER_BOOKING_MISMATCH");
  if (!sameMoney(unit?.amount, booking)) return errorJson(409, "AMOUNT_MISMATCH");

  if (booking.status === "paid") {
    if (booking.paypalOrderId === orderId) {
      return NextResponse.json({ status: "paid", orderId, captureId: booking.captureId });
    }
    return errorJson(409, "ALREADY_PAID");
  }

  if (order.status !== "COMPLETED") {
    if (order.status !== "APPROVED") return errorJson(409, "ORDER_NOT_APPROVED", { paypalStatus: order.status });
    const mock = gateMockCode(req);
    try {
      // PP-03: the same request id on every retry, so PayPal returns the first result instead of charging again.
      // A simulated decline (gate check A6) uses its own id so it can never be replayed as the real capture.
      const requestId = mock
        ? `capture-${booking.id}-${orderId}-mock-${Date.now()}`
        : `capture-${booking.id}-${orderId}`;
      await captureOrder(orderId, { requestId, mock });
    } catch (e) {
      if (e instanceof PayPalError && e.issue === "INSTRUMENT_DECLINED") {
        // PP-05: keep the booking unpaid and let the buyer choose another way to pay.
        return errorJson(402, "INSTRUMENT_DECLINED", { retry: true });
      }
      if (!(e instanceof PayPalError && e.issue === "ORDER_ALREADY_CAPTURED")) return fromPayPalError(e);
    }
  }

  // PP-04: trust PayPal's record, not the capture response.
  let after: PayPalOrder;
  try {
    after = await getOrder(orderId);
  } catch (e) {
    return fromPayPalError(e);
  }
  const cap = captures(after)[0];

  if (after.status === "COMPLETED" && cap?.status === "COMPLETED" && sameMoney(cap.amount, booking)) {
    await store.update(booking.id, {
      status: "paid",
      paypalOrderId: orderId,
      captureId: cap.id,
      paidAt: new Date().toISOString(),
    });
    return NextResponse.json({ status: "paid", orderId, captureId: cap.id });
  }
  if (cap?.status === "PENDING") {
    // Money is not settled yet. The booking stays unconfirmed.
    await store.update(booking.id, { status: "payment_pending", paypalOrderId: orderId, captureId: cap.id });
    return NextResponse.json({ status: "payment_pending", orderId }, { status: 202 });
  }
  return errorJson(502, "CAPTURE_NOT_COMPLETED", { paypalStatus: after.status, captureStatus: cap?.status ?? null });
}
