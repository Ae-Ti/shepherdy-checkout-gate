import { NextResponse } from "next/server";
import { findExperience } from "@/lib/catalog";
import { getStore, newBookingId, type Booking } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Creates a booking. The price is copied from the server catalog; anything the browser sends is ignored.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const exp = findExperience(String(body.experienceId ?? ""));
  if (!exp) return NextResponse.json({ error: "UNKNOWN_EXPERIENCE" }, { status: 400 });

  const rawDate = String(body.date ?? "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate
    : new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const booking: Booking = {
    id: newBookingId(),
    experienceId: exp.id,
    title: exp.title,
    date,
    guestName: String(body.guestName ?? "").trim().slice(0, 80) || "Guest",
    email: String(body.email ?? "").trim().slice(0, 120),
    amount: exp.amount,
    currency: exp.currency,
    status: "awaiting_payment",
    paypalOrderId: null,
    captureId: null,
    createdAt: new Date().toISOString(),
    paidAt: null,
  };
  await getStore().insert(booking);
  return NextResponse.json({ bookingId: booking.id, url: `/book/${booking.id}` }, { status: 201 });
}
