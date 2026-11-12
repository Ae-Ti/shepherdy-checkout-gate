"use client";

import { useState } from "react";
import { PayPalOneTimePaymentButton, PayPalProvider, usePayPal } from "@paypal/react-paypal-js/sdk-v6";

// Shows whether the PayPal SDK is still loading or failed, so buyers (and the gate) are never left guessing.
function SdkStatus() {
  const { loadingStatus, error } = usePayPal();
  const status = String(loadingStatus);
  if (error || status === "rejected") {
    return (
      <p className="notice error" data-testid="paypal-sdk-error">
        PayPal could not load: {error?.message ?? "unknown error"}
      </p>
    );
  }
  if (status === "pending") {
    return (
      <p className="muted" data-testid="paypal-sdk-loading">
        Loading PayPal…
      </p>
    );
  }
  return null;
}

type Props = {
  bookingId: string;
  clientId: string; // public PayPal client ID, passed down from the server. Never the secret.
  environment: "sandbox" | "production";
};

type State =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "paid"; orderId: string }
  | { kind: "pending"; orderId: string }
  | { kind: "error"; message: string };

function explain(code?: string): string {
  switch (code) {
    case "INSTRUMENT_DECLINED":
      return "PayPal declined that payment method. Please try again and pick another way to pay.";
    case "ALREADY_PAID":
      return "This booking is already paid.";
    case "ORDER_NOT_APPROVED":
      return "The payment was not approved in PayPal yet. Please try again.";
    default:
      return "We could not confirm the payment, and you were not charged twice. Please try again.";
  }
}

export default function PayPalCheckout({ bookingId, clientId, environment }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });

  if (state.kind === "paid") {
    return (
      <div className="notice success" data-testid="paypal-payment-success" data-order-id={state.orderId}>
        <strong>Payment confirmed by PayPal.</strong> Order {state.orderId}. A receipt is on its way.
      </div>
    );
  }

  return (
    <div className="paybox">
      <PayPalProvider clientId={clientId} environment={environment} components={["paypal-payments"]} pageType="checkout">
        <SdkStatus />
        <PayPalOneTimePaymentButton
          createOrder={async () => {
            setState({ kind: "working" });
            // Only the booking id goes to the server. The server decides the price.
            const res = await fetch("/api/paypal/create-order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ bookingId }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.orderId) {
              setState({ kind: "error", message: explain(json.error) });
              throw new Error(json.error || "CREATE_ORDER_FAILED");
            }
            return { orderId: json.orderId as string };
          }}
          onApprove={async ({ orderId }) => {
            const res = await fetch("/api/paypal/capture-order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orderId, bookingId }),
            });
            const json = await res.json().catch(() => ({}));
            if (res.ok && json.status === "paid") setState({ kind: "paid", orderId });
            else if (res.status === 202) setState({ kind: "pending", orderId });
            else setState({ kind: "error", message: explain(json.error) });
          }}
          onCancel={() => setState({ kind: "idle" })}
          onError={() => setState({ kind: "error", message: "PayPal could not start the payment. Please try again." })}
        />
      </PayPalProvider>
      {state.kind === "working" && <p className="muted">Waiting for PayPal…</p>}
      {state.kind === "pending" && (
        <p className="notice warn" data-testid="paypal-payment-pending">
          PayPal is still reviewing this payment. Your booking is confirmed once the money clears.
        </p>
      )}
      {state.kind === "error" && (
        <p className="notice error" data-testid="paypal-payment-error">
          {state.message}
        </p>
      )}
    </div>
  );
}
