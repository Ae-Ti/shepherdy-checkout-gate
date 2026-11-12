import { notFound } from "next/navigation";
import PayPalCheckout from "@/components/PayPalCheckout";
import { formatUsd } from "@/lib/catalog";
import { isSandbox } from "@/lib/paypal";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const STATUS_TEXT = {
  awaiting_payment: "Waiting for payment",
  payment_pending: "Payment under review",
  paid: "Paid",
} as const;

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await getStore().get(id);
  if (!booking) notFound();
  const clientId = process.env.PAYPAL_CLIENT_ID ?? "";

  return (
    <div className="split">
      <section className="card">
        <h1 style={{ margin: 0 }}>{booking.title}</h1>
        <p>
          <span className={`pill ${booking.status}`} data-testid="booking-status" data-status={booking.status}>
            {STATUS_TEXT[booking.status]}
          </span>
        </p>
        <ul className="summary">
          <li>
            <span>Booking</span>
            <span>{booking.id}</span>
          </li>
          <li>
            <span>Guest</span>
            <span>{booking.guestName}</span>
          </li>
          <li>
            <span>Date</span>
            <span>{booking.date}</span>
          </li>
          <li>
            <span>Total</span>
            <strong>{formatUsd(booking.amount)}</strong>
          </li>
        </ul>
      </section>
      <section className="card">
        <h2>Pay with PayPal</h2>
        {booking.status === "paid" ? (
          <div className="notice success" data-testid="paypal-payment-success" data-order-id={booking.paypalOrderId ?? ""}>
            <strong>Paid.</strong> PayPal order {booking.paypalOrderId}. See you on {booking.date}!
          </div>
        ) : booking.status === "payment_pending" ? (
          <p className="notice warn" data-testid="paypal-payment-pending">
            PayPal is still reviewing this payment. We confirm your spot once the money clears.
          </p>
        ) : clientId ? (
          <PayPalCheckout bookingId={booking.id} clientId={clientId} environment={isSandbox() ? "sandbox" : "production"} />
        ) : (
          <p className="notice error">PayPal is not configured on this server yet.</p>
        )}
        <p className="muted">The amount is set by our server from your booking. Your browser never decides the price.</p>
      </section>
    </div>
  );
}
