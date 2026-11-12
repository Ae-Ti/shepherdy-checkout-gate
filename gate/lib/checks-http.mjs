import crypto from "node:crypto";
import { Inconclusive, STATUS, httpJson, runCheck } from "./util.mjs";
import { orderFacts, sameAmount } from "./paypal.mjs";
import { routeUrl } from "./routes.mjs";

export const META = {
  A1: { id: "A1", rule: "PP-01", group: "Attacks", title: "Paying $0.01 for a $120 booking is impossible" },
  A2: { id: "A2", rule: "PP-02", group: "Attacks", title: "A booking cannot be confirmed without the buyer approving the payment" },
  A3: { id: "A3", rule: "PP-02", group: "Attacks", title: "A made-up PayPal order ID cannot confirm a booking" },
};

export async function createBooking(ctx, label) {
  const res = await httpJson(routeUrl(ctx, "createBooking"), {
    method: "POST",
    // The amount here is a trap: a correct app ignores it.
    body: { experienceId: ctx.config.experienceId, guestName: `Gate ${label}`, email: "gate-check@example.com", amount: ctx.config.tamperedAmount },
  });
  if (res.status !== 201 || !res.json.bookingId) throw new Inconclusive(`Could not create a test booking (HTTP ${res.status}).`);
  return res.json.bookingId;
}

export async function bookingStatus(ctx, bookingId) {
  const res = await httpJson(`${routeUrl(ctx, "bookingStatus")}?bookingId=${encodeURIComponent(bookingId)}`);
  return res.ok ? String(res.json.status) : `HTTP_${res.status}`;
}

export function capture(ctx, body, headers = {}) {
  return httpJson(routeUrl(ctx, "captureOrder"), { method: "POST", body, headers, timeoutMs: 60_000 });
}

function madeUpOrderId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let s = "";
  for (const b of crypto.randomBytes(17)) s += chars[b % chars.length];
  return s;
}

export async function httpChecks(ctx, paypal) {
  const results = [];
  let order = null;
  let booking = null;

  results.push(
    await runCheck(META.A1, async () => {
      booking = await createBooking(ctx, "A1");
      const sent = ctx.config.tamperedAmount;
      const res = await httpJson(routeUrl(ctx, "createOrder"), {
        method: "POST",
        body: { bookingId: booking, amount: sent, value: sent, price: Number(sent), total: sent, currency: ctx.config.currency },
      });
      if (!res.ok || !res.json.orderId) throw new Inconclusive(`create-order did not return an order (HTTP ${res.status}).`);
      order = res.json.orderId;
      const facts = orderFacts(await paypal.getOrder(order));
      const amountOk = sameAmount(facts.amount, ctx.config.expectedAmount) && facts.currency === ctx.config.currency;
      const refOk = facts.referenceId === booking;
      const evidence = [
        { label: "Browser sent", actual: `${sent} ${ctx.config.currency}` },
        { label: "PayPal recorded", expected: `${ctx.config.expectedAmount} ${ctx.config.currency}`, actual: `${facts.amount} ${facts.currency}`, ok: amountOk },
        { label: "PayPal reference_id", expected: booking, actual: String(facts.referenceId), ok: refOk },
        { label: "PayPal order", actual: order },
      ];
      const debugIds = paypal.debugIds.slice(-1);
      if (!amountOk) {
        return {
          status: STATUS.blocked,
          summary: `PayPal recorded ${facts.amount} ${facts.currency} for a ${ctx.config.expectedAmount} booking: the browser chose the price.`,
          evidence,
          debugIds,
        };
      }
      if (!refOk) return { status: STATUS.blocked, summary: "The PayPal order is not tied to its booking (reference_id).", evidence, debugIds };
      return { status: STATUS.pass, summary: `The browser asked for ${sent}; PayPal recorded the server price ${facts.amount}.`, evidence, debugIds };
    }),
  );

  results.push(
    await runCheck(META.A2, async () => {
      if (!order || !booking) throw new Inconclusive("Needs the PayPal order from A1.");
      const res = await capture(ctx, { orderId: order, bookingId: booking });
      const status = await bookingStatus(ctx, booking);
      const facts = orderFacts(await paypal.getOrder(order));
      const evidence = [
        { label: "Capture before approval", expected: "refused", actual: `HTTP ${res.status} ${res.json.error ?? res.json.status ?? ""}`.trim(), ok: !res.ok },
        { label: "Booking status", expected: "not paid", actual: status, ok: status !== "paid" },
        { label: "PayPal order status", expected: "not COMPLETED", actual: String(facts.status), ok: facts.status !== "COMPLETED" },
      ];
      const ok = evidence.every((e) => e.ok);
      return {
        status: ok ? STATUS.pass : STATUS.blocked,
        summary: ok ? "Capturing an order nobody approved was refused; the booking stayed unpaid." : "An order the buyer never approved confirmed the booking.",
        evidence,
      };
    }),
  );

  results.push(
    await runCheck(META.A3, async () => {
      const b = await createBooking(ctx, "A3");
      const fake = madeUpOrderId();
      const res = await capture(ctx, { orderId: fake, bookingId: b });
      const status = await bookingStatus(ctx, b);
      const evidence = [
        { label: "Made-up order ID", actual: fake },
        { label: "App answer", expected: "refused", actual: `HTTP ${res.status} ${res.json.error ?? ""}`.trim(), ok: !res.ok },
        { label: "Booking status", expected: "not paid", actual: status, ok: status !== "paid" },
      ];
      const ok = evidence.every((e) => e.ok !== false);
      return {
        status: ok ? STATUS.pass : STATUS.blocked,
        summary: ok ? "A made-up order ID was refused." : "A made-up order ID confirmed a booking.",
        evidence,
      };
    }),
  );
  return results;
}
